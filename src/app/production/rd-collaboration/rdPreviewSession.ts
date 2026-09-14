import { getDefectPreviewGeneration } from '../defects/defectPreviewSession';
import { createRdState } from './rdModel';
import type { RdState } from './rdTypes';
let generation = -1;
let snapshot = createRdState();
export function getRdPreviewState(): RdState {
  const current = getDefectPreviewGeneration();
  if (current !== generation) { snapshot = createRdState(); generation = current; }
  return snapshot;
}
export function setRdPreviewState(next: RdState): void { generation = getDefectPreviewGeneration(); snapshot = next; }
