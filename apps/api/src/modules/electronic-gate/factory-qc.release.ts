import type { FactoryProtocolCatalog } from './factory-qc.contract';
import { buildFactoryQcR5Draft, buildHistoricalFactoryQcCandidate, R5_SOURCE } from './factory-qc.r5';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function contentKey(catalog: FactoryProtocolCatalog) {
  const { version: _, ...content } = catalog;
  return canonical(content);
}
const historicalCandidateKey = contentKey(buildHistoricalFactoryQcCandidate());
const reviewTemplateKey = contentKey(buildFactoryQcR5Draft());

/** Management-side source guard. This does not certify firmware compatibility or measurement validity. */
export function protocolPublicationIssues(catalog: FactoryProtocolCatalog): string[] {
  const issues: string[] = [];
  const key = contentKey(catalog);
  if (catalog.version === R5_SOURCE.historicalCandidateVersion || key === historicalCandidateKey) {
    issues.push('r4 历史候选未吸收 r5 修正，只能保存草稿；请更新字段与固件适用范围，不能直接发布或仅修改版本号发布');
  }
  if (catalog.version === R5_SOURCE.reviewVersion || key === reviewTemplateKey) {
    issues.push('r5 审核模板含待核实的固件匹配、7D 字节序及样本，只能保存草稿；核对并修订正式内容后使用新的正式版本号');
  }
  return issues;
}
