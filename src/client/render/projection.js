export const DESIGN_WIDTH = 1000;
export const DESIGN_HEIGHT = 1360;
export const DEFAULT_CAMERA = Object.freeze({
  centerX: 0.5,
  centerY: 0.5,
  zoom: 1
});

export function createProjection(width, height, camera = DEFAULT_CAMERA) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const clampedCamera = clampCamera(camera);
  const visibleWidth = DESIGN_WIDTH / clampedCamera.zoom;
  const visibleHeight = DESIGN_HEIGHT / clampedCamera.zoom;
  const left = clampedCamera.centerX * DESIGN_WIDTH - visibleWidth / 2;
  const top = clampedCamera.centerY * DESIGN_HEIGHT - visibleHeight / 2;
  const fitScale = Math.min(safeWidth / visibleWidth, safeHeight / visibleHeight);
  const offsetX = Math.round((safeWidth - visibleWidth * fitScale) / 2);
  const offsetY = Math.round((safeHeight - visibleHeight * fitScale) / 2);

  return {
    camera: clampedCamera,
    project(normalizedX, normalizedY) {
      const designX = normalizedX * DESIGN_WIDTH;
      const designY = normalizedY * DESIGN_HEIGHT;

      return {
        canvasX: Math.round(offsetX + (designX - left) * fitScale),
        canvasY: Math.round(offsetY + (designY - top) * fitScale)
      };
    }
  };
}

export function clampCamera(camera = DEFAULT_CAMERA) {
  const zoom = Math.max(1, Number(camera.zoom) || DEFAULT_CAMERA.zoom);
  const visibleWidth = 1 / zoom;
  const visibleHeight = 1 / zoom;
  const halfWidth = visibleWidth / 2;
  const halfHeight = visibleHeight / 2;

  return {
    centerX: clamp(Number(camera.centerX), halfWidth, 1 - halfWidth, DEFAULT_CAMERA.centerX),
    centerY: clamp(Number(camera.centerY), halfHeight, 1 - halfHeight, DEFAULT_CAMERA.centerY),
    zoom
  };
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  if (min > max) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}
