export const TASK_IMAGE_MIN_SCALE = 1;
export const TASK_IMAGE_MAX_SCALE = 4;
export const TASK_IMAGE_DOUBLE_TAP_SCALE = 2;
export const TASK_IMAGE_ZOOM_STEP = 0.5;

export type PointerPosition = { x: number; y: number };
export type TaskImageTransform = { scale: number; x: number; y: number };
export type TaskImageViewport = {
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
};

export function clampTaskImageScale(scale: number): number {
  return Math.min(TASK_IMAGE_MAX_SCALE, Math.max(TASK_IMAGE_MIN_SCALE, scale));
}

export function distanceBetweenPointers(first: PointerPosition, second: PointerPosition): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function midpointBetweenPointers(first: PointerPosition, second: PointerPosition): PointerPosition {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export function clampTaskImageTransform(
  transform: TaskImageTransform,
  viewport: TaskImageViewport,
): TaskImageTransform {
  const scale = clampTaskImageScale(transform.scale);
  if (scale === TASK_IMAGE_MIN_SCALE) {
    return { scale, x: 0, y: 0 };
  }
  const scaledImageWidth = viewport.imageWidth * scale;
  const scaledImageHeight = viewport.imageHeight * scale;
  const maxX = Math.max(0, (scaledImageWidth - viewport.width) / 2);
  const maxY = Math.max(0, (scaledImageHeight - viewport.height) / 2);
  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, transform.x)),
    y: Math.min(maxY, Math.max(-maxY, transform.y)),
  };
}

export function zoomTaskImageTransform(
  current: TaskImageTransform,
  requestedScale: number,
  focus: PointerPosition,
  viewportCenter: PointerPosition,
): TaskImageTransform {
  const scale = clampTaskImageScale(requestedScale);
  if (current.scale === scale) return { ...current, scale };
  const localX = (focus.x - viewportCenter.x - current.x) / current.scale;
  const localY = (focus.y - viewportCenter.y - current.y) / current.scale;
  return {
    scale,
    x: focus.x - viewportCenter.x - localX * scale,
    y: focus.y - viewportCenter.y - localY * scale,
  };
}

export function pinchTaskImageTransform({
  startTransform,
  startDistance,
  currentDistance,
  startMidpoint,
  currentMidpoint,
  viewportCenter,
}: {
  startTransform: TaskImageTransform;
  startDistance: number;
  currentDistance: number;
  startMidpoint: PointerPosition;
  currentMidpoint: PointerPosition;
  viewportCenter: PointerPosition;
}): TaskImageTransform {
  const scale = clampTaskImageScale(startTransform.scale * currentDistance / Math.max(1, startDistance));
  const localX = (startMidpoint.x - viewportCenter.x - startTransform.x) / startTransform.scale;
  const localY = (startMidpoint.y - viewportCenter.y - startTransform.y) / startTransform.scale;
  return {
    scale,
    x: currentMidpoint.x - viewportCenter.x - localX * scale,
    y: currentMidpoint.y - viewportCenter.y - localY * scale,
  };
}
