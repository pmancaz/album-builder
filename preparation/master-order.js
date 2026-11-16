/*
  These small helpers keep track-order changes predictable and easy to test.
  Every reorder also updates the editable track numbers, so filenames, metadata,
  the release summary, and the final export all follow the visible card order.
*/

function renumberMasters(masters) {
  return masters.map((master, index) => ({
    ...master,
    metadata: { ...master.metadata, trackNumber: String(index + 1) },
  }));
}

export function moveMasterToIndex(masters, masterId, requestedIndex) {
  const currentIndex = masters.findIndex((master) => master.id === masterId);
  if (currentIndex < 0 || masters.length < 2) return masters;

  const next = [...masters];
  const [movingMaster] = next.splice(currentIndex, 1);
  const safeIndex = Math.max(0, Math.min(Number(requestedIndex), next.length));
  next.splice(safeIndex, 0, movingMaster);
  return renumberMasters(next);
}

export function moveMasterAroundTarget(masters, movingId, targetId, placeAfter = false) {
  if (movingId === targetId) return masters;
  const target = masters.find((master) => master.id === targetId);
  if (!target) return masters;

  const withoutMoving = masters.filter((master) => master.id !== movingId);
  const targetIndex = withoutMoving.findIndex((master) => master.id === targetId);
  return moveMasterToIndex(masters, movingId, targetIndex + (placeAfter ? 1 : 0));
}
