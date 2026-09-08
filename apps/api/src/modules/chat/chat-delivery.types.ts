import type { FileRef, publicFile } from './chat-file-catalog.service';

export type DeliveryStatus = 'candidate' | 'missing' | 'confirmed' | 'not_required';
export type DeliveryRequirement = { id: string; title: string; keywords: string[]; required: boolean };
export type StoredDeliveryRow = DeliveryRequirement & {
  status: DeliveryStatus;
  candidates: FileRef[];
  candidateCount: number;
  evidenceFileIds: string[];
  confirmedAt: string | null;
  notice?: string;
};
export type DeliveryChecklist = {
  schemaVersion: 1;
  rows: StoredDeliveryRow[];
  warnings: string[];
  scannedFileCount: number;
};
export type DeliveryCheckView = {
  id: string; conversationId: string; taskId: string; taskTitle: string; workspace: 'rd';
  revision: number; checkedAt: string; createdAt: string; updatedAt: string;
  scopeNote: string; templateLabel: string; warnings: string[]; scannedFileCount: number;
  rows: Array<Omit<StoredDeliveryRow, 'candidates'> & { candidates: ReturnType<typeof publicFile>[] }>;
  summary: { total: number; required: number; confirmed: number; candidate: number; missing: number; notRequired: number; unresolvedRequired: number };
};

export const DELIVERY_TEMPLATE_LABEL = '研发结项参考清单（可编辑，非公司正式交付标准）';
export const DELIVERY_SCOPE_NOTE = '仅检查当前任务及子任务中你有权查看的附件，并按文件名及元数据寻找候选；未检索正文，不判断内容合规或是否为最新版本。未匹配不代表其他位置不存在资料。';
export const DEFAULT_DELIVERY_REQUIREMENTS: DeliveryRequirement[] = [
  { id: 'requirements', title: '需求与规格说明', keywords: ['需求', '规格', 'specification'], required: true },
  { id: 'design', title: '设计方案与图纸', keywords: ['设计', '图纸', '方案', 'drawing'], required: true },
  { id: 'bom', title: '物料清单（BOM）', keywords: ['bom', '物料清单'], required: true },
  { id: 'testing', title: '测试与验证报告', keywords: ['测试', '验证', '检测', 'test'], required: true },
  { id: 'manual', title: '使用说明与交接资料', keywords: ['说明书', '使用说明', '操作手册', '交接', 'manual'], required: true },
  { id: 'acceptance', title: '验收与结项记录', keywords: ['验收', '结项', '签收'], required: true },
];
