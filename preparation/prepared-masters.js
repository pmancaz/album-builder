/*
  After an export, Release Preparer should work from the prepared master copies
  inside the release folder. Keeping this as a small, pure helper makes that
  relinking predictable and lets us test it without opening the desktop app.
*/

const RESCANNED_FILE_DETAILS = [
  'fileName',
  'extension',
  'durationSeconds',
  'formatName',
];

// Empty tags are common when a WAV file is rescanned. They should never erase
// useful metadata that the user has already typed into a master card.
function hasUsefulValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function fileDetailsFromPath(path) {
  const fileName = String(path || '').split(/[\\/]/).pop() || '';
  const finalDot = fileName.lastIndexOf('.');
  const extension = finalDot > 0 ? fileName.slice(finalDot + 1).toLowerCase() : '';
  return { fileName, extension };
}

function mergeMetadata(existingMetadata, rescannedMetadata) {
  const merged = { ...(existingMetadata || {}) };

  Object.entries(rescannedMetadata || {}).forEach(([key, value]) => {
    if (hasUsefulValue(value)) merged[key] = value;
  });

  return merged;
}

/**
 * Point exported masters at their prepared copies and apply fresh file details.
 *
 * Tracks are matched to exported files by ID. The audio inspection results do
 * not contain IDs, so those are matched by their new paths. Tracks that did not
 * export successfully are returned untouched.
 */
export function relinkPreparedMasters(masters, preparedTracks, inspectedTracks = []) {
  const preparedById = new Map(
    (Array.isArray(preparedTracks) ? preparedTracks : [])
      .filter((track) => hasUsefulValue(track?.id) && hasUsefulValue(track?.path))
      .map((track) => [String(track.id), track]),
  );
  const inspectedByPath = new Map(
    (Array.isArray(inspectedTracks) ? inspectedTracks : [])
      .filter((track) => hasUsefulValue(track?.path))
      .map((track) => [String(track.path), track]),
  );

  return (Array.isArray(masters) ? masters : []).map((master) => {
    const prepared = preparedById.get(String(master?.id));
    if (!prepared) return master;

    const preparedPath = String(prepared.path);
    const inspected = inspectedByPath.get(preparedPath) || {};
    const pathDetails = fileDetailsFromPath(preparedPath);
    const updated = {
      ...master,
      path: preparedPath,
      fileName: pathDetails.fileName || master.fileName,
      extension: pathDetails.extension || master.extension,
      metadata: mergeMetadata(master.metadata, inspected.metadata),
    };

    // A valid rescan is more accurate than details inferred from the pathname.
    // Empty values are skipped so a partial scan cannot make the card less useful.
    RESCANNED_FILE_DETAILS.forEach((key) => {
      if (hasUsefulValue(inspected[key])) updated[key] = inspected[key];
    });

    // Neither the export response nor ffprobe is allowed to replace the stable
    // card ID. That ID is what preserves ordering and editing continuity.
    updated.id = master.id;
    return updated;
  });
}
