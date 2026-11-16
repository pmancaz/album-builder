/*
  These small geometry helpers keep artwork cropping predictable and testable.
  A position of 0 shows the top/left edge, 50 centres the image, and 100 shows
  the bottom/right edge of any part that extends beyond the square canvas.
*/

export function clampPercentage(value) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

export function coverPlacement(canvasWidth, canvasHeight, imageWidth, imageHeight, positionX = 50, positionY = 50) {
  const scale = Math.max(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const overflowX = Math.max(0, width - canvasWidth);
  const overflowY = Math.max(0, height - canvasHeight);

  const x = overflowX ? -overflowX * clampPercentage(positionX) / 100 : (canvasWidth - width) / 2;
  const y = overflowY ? -overflowY * clampPercentage(positionY) / 100 : (canvasHeight - height) / 2;

  return {
    width,
    height,
    overflowX,
    overflowY,
    x: x || 0,
    y: y || 0,
  };
}

export function movedBackgroundPosition(startPercentage, draggedCanvasPixels, overflowPixels) {
  if (!overflowPixels) return clampPercentage(startPercentage);
  return clampPercentage(startPercentage - draggedCanvasPixels / overflowPixels * 100);
}
