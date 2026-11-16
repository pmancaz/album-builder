/* Compatibility boundary between album sequencing and the preparation stage.
   The UI edits one release; legacy metadata/copy fields are derived views for
   existing albums and audio export, never a second editable form. */
const releaseFields = {
  title: 'releaseTitleInput', artist: 'artistInput', albumArtist: 'albumArtistInput',
  year: 'yearInput', genre: 'genreInput', label: 'labelInput', catalogue: 'catalogueInput',
  composer: 'composerInput', discNumber: 'discNumberInput', comment: 'commentInput',
};
const linkFields = {
  website: 'websiteUrlInput', instagram: 'instagramUrlInput', bandcamp: 'bandcampUrlInput',
  soundcloud: 'soundcloudUrlInput', youtube: 'youtubeUrlInput', spotify: 'spotifyUrlInput', appleMusic: 'appleMusicUrlInput',
};
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export function validatePreparation(value) {
  if (value == null) return null;
  if (!isRecord(value) || !isRecord(value.fields)) throw Error('The saved release preparation is damaged. The album was left unchanged.');
  if (value.version != null && (!Number.isInteger(value.version) || value.version < 0 || value.version > 10)) throw Error('This release preparation needs a newer version of Album Builder.');
  for (const field of Object.values(value.fields)) if (typeof field !== 'string') throw Error('A saved release field is not text.');
  for (const key of ['masters', 'socialPosts', 'albumTrackIds']) if (value[key] != null && !Array.isArray(value[key])) throw Error(`The saved preparation ${key} list is damaged.`);
  const masterIds = new Set();
  const sourceIds = new Set();
  for (const track of value.masters || []) {
    if (!isRecord(track) || typeof track.path !== 'string' || !isRecord(track.metadata)) throw Error('A saved preparation master is damaged.');
    for (const field of Object.values(track.metadata)) if (typeof field !== 'string') throw Error('Saved preparation master metadata must be text.');
    for (const key of ['id', 'sourceTrackId', 'albumSourcePath', 'fileName', 'extension']) if (track[key] != null && typeof track[key] !== 'string') throw Error('A saved preparation master is damaged.');
    if (track.durationSeconds != null && (!Number.isFinite(track.durationSeconds) || track.durationSeconds < 0)) throw Error('A saved preparation master duration is damaged.');
    for (const [key, ids] of [['id', masterIds], ['sourceTrackId', sourceIds]]) {
      if (track[key] && ids.has(track[key])) throw Error('Saved preparation masters have duplicate identifiers.');
      if (track[key]) ids.add(track[key]);
    }
  }
  for (const id of value.albumTrackIds || []) if (typeof id !== 'string') throw Error('The saved preparation album track list is damaged.');
  for (const post of value.socialPosts || []) {
    if (!isRecord(post) || ['id', 'title', 'content'].some(key => post[key] != null && typeof post[key] !== 'string')) throw Error('A saved preparation social post is damaged.');
  }
  for (const key of ['artwork', 'video', 'canvases', 'exportState']) if (value[key] != null && !isRecord(value[key])) throw Error(`The saved preparation ${key} settings are damaged.`);
  if (value.artwork?.settings != null && !isRecord(value.artwork.settings)) throw Error('The saved preparation artwork settings are damaged.');
  for (const key of ['outputDir', 'folderName']) if (value.exportState?.[key] != null && typeof value.exportState[key] !== 'string') throw Error('The saved preparation export location is damaged.');
  for (const key of ['backgroundDataUrl', 'logoDataUrl']) {
    const image = value.artwork?.[key];
    if (image && (typeof image !== 'string' || !/^data:image\/(?:png|jpe?g|webp|gif|bmp|svg\+xml)[;,]/i.test(image))) throw Error('Saved preparation artwork must be an embedded image.');
  }
  const preparation = structuredClone(value);
  // Older records may only have a path and tags. Supply presentation details
  // before the preparation UI replaces its current master list.
  for (const track of preparation.masters || []) {
    track.fileName ||= track.path.split(/[\\/]/).pop() || 'Untitled master';
    track.extension ||= track.fileName.includes('.') ? track.fileName.split('.').pop().toLowerCase() : 'wav';
    track.durationSeconds ??= 0;
  }
  return preparation;
}

export function preparationForAlbum(album) {
  const existing = validatePreparation(album.releasePreparation);
  const release = existing || { version: 10, fields: {}, masters: [], socialPosts: [] };
  release.id = album.id || null; release.name = album.metadata?.title || album.name || 'Untitled album';
  const fields = release.fields;
  for (const [key, field] of Object.entries(releaseFields)) fields[field] = album.metadata?.[key] || '';
  fields.compilationInput = String(Boolean(album.metadata?.compilation));
  const legacy = album.releaseCopy || {};
  for (const [key, field] of Object.entries({ releaseDate: 'releaseDateInput', description: 'longDescriptionInput', credits: 'creditsInput', downloadUrl: 'downloadUrlInput' })) fields[field] = legacy[key] || '';
  for (const [key, field] of Object.entries(linkFields)) fields[field] = legacy.links?.[key] || fields[field] || '';
  fields.filenamePatternInput ||= '{track} - {artist} - {title}';
  const previous = new Map((release.masters || []).filter(track => track.sourceTrackId).map(track => [track.sourceTrackId, track]));
  // Sequence order is inherited. Explicitly added preparation-only masters stay
  // available; a linked track removed from the sequence leaves preparation too.
  const linked = (album.tracks || []).filter(track => track.nativePath && (!release.albumTrackIds?.includes(track.id) || previous.has(track.id))).map((track, index) => {
    const old = previous.get(track.id);
    const sameSource = old && old.albumSourcePath === track.nativePath;
    return {
      ...old, id: track.id, sourceTrackId: track.id, albumSourcePath: track.nativePath,
      path: sameSource ? old.path : track.nativePath,
      fileName: sameSource ? old.fileName : track.nativePath.split(/[\\/]/).pop(),
      extension: (sameSource ? old.extension : track.nativePath.split('.').pop()) || 'wav',
      durationSeconds: sameSource ? old.durationSeconds : (track.duration || 0),
      metadata: { ...old?.metadata, title: track.name || '', artist: old?.metadata?.artist ?? fields.artistInput,
        album: fields.releaseTitleInput, albumArtist: fields.albumArtistInput || fields.artistInput,
        composer: old?.metadata?.composer ?? fields.composerInput, genre: old?.metadata?.genre ?? fields.genreInput,
        comment: old?.metadata?.comment ?? fields.commentInput, trackNumber: String(index + 1), discNumber: fields.discNumberInput || '1', year: fields.yearInput },
    };
  });
  release.albumTrackIds = (album.tracks || []).map(track => track.id);
  // Keep preparation-only additions beside the next surviving album track.
  // Reopening preparation must not silently move a bonus master to the end.
  const linkedIds = new Set(linked.map(track => track.sourceTrackId));
  const additionsBefore = new Map();
  let additions = [];
  for (const track of release.masters || []) {
    if (!track.sourceTrackId) additions.push(track);
    else if (linkedIds.has(track.sourceTrackId)) {
      additionsBefore.set(track.sourceTrackId, additions);
      additions = [];
    }
  }
  release.masters = [...linked.flatMap(track => [...(additionsBefore.get(track.sourceTrackId) || []), track]), ...additions];
  release.masters.forEach((track, index) => { track.metadata.trackNumber = String(index + 1); });
  if (!release.artwork?.backgroundDataUrl && album.artworkDataUrl) release.artwork = { ...release.artwork, backgroundDataUrl: album.artworkDataUrl, backgroundName: 'Album artwork' };
  return release;
}

export function sharedFieldsFromPreparation(release) {
  validatePreparation(release);
  const fields = release.fields;
  const metadata = Object.fromEntries(Object.entries(releaseFields).map(([key, field]) => [key, fields[field] || '']));
  metadata.title ||= 'Untitled album'; metadata.compilation = fields.compilationInput === 'true';
  return { metadata, releaseCopy: {
    releaseDate: fields.releaseDateInput || '', description: fields.longDescriptionInput || '',
    credits: fields.creditsInput || '', downloadUrl: fields.downloadUrlInput || '',
    links: Object.fromEntries(Object.entries(linkFields).map(([key, field]) => [key, fields[field] || ''])),
  } };
}

export function albumFromPreparation(source) {
  const preparation = validatePreparation(source);
  const shared = sharedFieldsFromPreparation(preparation);
  const id = crypto.randomUUID();
  const tracks = (preparation.masters || []).map(master => {
    const trackId = crypto.randomUUID();
    master.id = trackId; master.sourceTrackId = trackId; master.albumSourcePath = master.path;
    return { id: trackId, nativePath: master.path, name: master.metadata.title || master.fileName || 'Untitled track', status: 'master', notes: '', trackedNotes: [] };
  });
  preparation.exportState = {};
  preparation.id = id; preparation.name = shared.metadata.title; preparation.albumTrackIds = tracks.map(track => track.id);
  return { schemaVersion: 2, id, name: shared.metadata.title, updatedAt: new Date().toISOString(), ...shared,
    releasePreparation: preparation, tracks, materials: [], references: [], archived: false,
    artworkDataUrl: preparation.artwork?.backgroundDataUrl || null, artworkNativePath: null, albumNotes: '', albumNoteEntries: [], transitionLayout: { placements: [] },
  };
}
