/*
  Very large Gaussian blurs are safer and faster when they are calculated on
  a smaller working image, then enlarged to the final frame. This is the same
  basic idea used by image editors for large-radius blur effects: the visible
  blur stays strong, while the filter itself never receives an unstable value.
*/

export const MAX_VIDEO_BLUR = 200;

export function videoBlurPlan(blurControl, canvasWidth = 1280, canvasHeight = 720) {
  const strength = Math.min(MAX_VIDEO_BLUR, Math.max(0, Number(blurControl) || 0));
  const sigmaAtCanvasSize = strength * 2 * canvasWidth / 3840;

  return {
    strength,
    // The preview stays at its full 1280 × 720 backing resolution. Earlier
    // versions dropped to 320 × 180, which made smooth colour fields blotchy.
    workingWidth: Math.max(1, Math.round(canvasWidth)),
    workingHeight: Math.max(1, Math.round(canvasHeight)),
    sigma: sigmaAtCanvasSize,
    workingScale: 1,
  };
}

export function videoPreviewStyle(blurControl, canvasWidth = 1280, displayedWidth = canvasWidth) {
  const plan = videoBlurPlan(blurControl, canvasWidth, Math.round(canvasWidth * 9 / 16));
  const displayedSigma = plan.sigma * displayedWidth / canvasWidth;
  return {
    filter: displayedSigma > 0 ? `blur(${displayedSigma.toFixed(2)}px)` : 'none',
    scale: 1 + Math.min(0.35, displayedSigma * 4 / Math.max(1, displayedWidth)),
  };
}
