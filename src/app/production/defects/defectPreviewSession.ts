import { createDefectState } from './defectModel';
import type { DefectState } from './defectTypes';

// Browser-only demo session shared by P08 and P04. Reloading discards all edits.
let snapshot = createDefectState();
let generation = 0;
export const getDefectPreviewState = (): DefectState => snapshot;
export const getDefectPreviewGeneration = (): number => generation;
export function setDefectPreviewState(next: DefectState): void { snapshot = next; }
export function resetDefectPreviewState(): DefectState {
  snapshot = createDefectState(); generation += 1; return snapshot;
}
