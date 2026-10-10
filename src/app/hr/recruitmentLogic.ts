import type { HrRecord } from '../../mocks/hrPreview';
import { interviewDimensions, interviewRoles, interviewSummaryFields, type InterviewDraft, type InterviewRole } from './recruitmentSchema';

export function canAdvanceApproval(moduleId: string, status: string, role: string) {
  const hr = role === '人力负责人' || role === '员工关系岗';
  if (status === '草稿') return hr || (moduleId === 'req01' && role === '部门负责人');
  if (status === '业务确认' || status === '部门负责人') return role === '部门负责人';
  if (status === '人力审核' || status === '人力负责人') return hr;
  if (status === '总经理终审' || status === '总经理') return role === '总经理';
  return false;
}

export function offerApprovalError(row: HrRecord) {
  const required = ['拟录用岗位', '预计到岗时间', '有效期', '试用期月薪', '标准月薪', '每周工作天数'];
  const missing = required.filter(key => !row.fields[key]?.trim());
  if (missing.length) return `请由 HR 补全录用条件：${missing.join('、')}`;
  for (const key of ['试用期月薪', '标准月薪', '每周工作天数']) {
    const value = Number(row.fields[key]);
    if (!Number.isFinite(value) || value < 0 || (key !== '试用期月薪' && value <= 0) || (key === '每周工作天数' && value > 7)) return `${key}须为有效的${key === '试用期月薪' ? '非负数' : key === '每周工作天数' ? '1–7 天' : '正数'}，请由 HR 核对。`;
  }
  for (const key of ['预计到岗时间', '有效期']) {
    const value = row.fields[key];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) return `${key}日期无效。`;
  }
  return '';
}

export function approvedPublication(row: HrRecord, channel: string): string {
  if (row.status !== '已批准' || !row.fields['已审批 JD 初稿']?.trim()) return '';
  const footer = channel === '小红书' ? '#招聘 #职业机会' : channel === '微信朋友圈' ? '欢迎推荐合适的伙伴，详情请联系招聘负责人。' : '有意向请联系招聘负责人。';
  return `${channel} · 招聘文案\n${row.title} | ${row.dept} | 招聘 ${row.fields['招聘人数']} 人\n\n${row.fields['已审批 JD 初稿']}\n\n${footer}\n（根据终审通过的 JD 生成，复制不代表已发布）`;
}

export function interviewReviewPatch(row: HrRecord, role: InterviewRole, draft: InterviewDraft): Partial<HrRecord> {
  if (draft.scores.length !== 5 || draft.weights.length !== 5 || [...draft.scores, ...draft.weights].some(value => !value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) throw new Error('分数和权重必须为 0–100。');
  if (Math.abs(draft.weights.reduce((sum, value) => sum + Number(value), 0) - 100) > 0.00001) throw new Error('权重合计必须为 100%。');
  if (draft.evidence.length !== 5 || draft.evidence.some(value => !value.trim())) throw new Error('请补全每个评分维度的事实依据。');
  if (interviewSummaryFields.some(key => !draft.summary[key]?.trim())) throw new Error('请补全结构化总结的每一项；未沟通事项请明确写明。');
  const fields = { ...row.fields };
  interviewDimensions.forEach((dimension, index) => {
    fields[`${role}:${dimension}:分数`] = draft.scores[index];
    fields[`${role}:${dimension}:权重`] = draft.weights[index];
    fields[`${role}:${dimension}:依据`] = draft.evidence[index].trim();
  });
  interviewSummaryFields.forEach(key => { fields[`${role}:总结:${key}`] = draft.summary[key].trim(); });
  fields[`${role}综合分`] = draft.scores.reduce((sum, value, index) => sum + Number(value) * Number(draft.weights[index]) / 100, 0).toFixed(1);
  fields[`${role}评价`] = draft.summary['综合评语'];
  fields[`${role}进度`] = '已完成';
  const complete = interviewRoles.every(perspective => fields[`${perspective}进度`] === '已完成');
  fields['录用建议'] = complete ? interviewRoles.map(perspective => `${perspective}：${fields[`${perspective}:总结:录用建议`]}`).join('；') : '待双方评价完成';
  return { fields, status: complete ? '已评价' : '评价中' };
}

export function intakeErrors(fields: Record<string, string>, mode: 'apply' | 'collect'): string[] {
  const required = ['联系电话','学历','毕业学校','所学专业'];
  if (mode === 'collect') required.push('个人邮箱','身份证号码','现居住地址','紧急联系人','紧急联系人电话','预计报到日期','教育培训经历','工作经历','信息真实性声明','填表人签名');
  const errors = required.filter(key => !fields[key]?.trim()).map(key => `待补充：${key}`);
  for (const key of ['联系电话','紧急联系人电话','企微绑定手机']) {
    if (fields[key] && !/^(?:1\d{10}|\+?[0-9][0-9 -]{6,19}|1\d{2}\*{4}\d{4})$/.test(fields[key].trim())) errors.push(`${key}格式不正确`);
  }
  if (fields['个人邮箱'] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields['个人邮箱'])) errors.push('个人邮箱格式不正确');
  if (fields['身份证号码'] && !/^(?:\d{17}[\dXx]|\d{15})$/.test(fields['身份证号码'])) errors.push('身份证号码须为 15 或 18 位；演示请使用虚构数据');
  if (fields['入学日期'] && fields['毕业日期'] && fields['入学日期'] > fields['毕业日期']) errors.push('毕业日期不能早于入学日期');
  if (fields['出生日期'] && fields['毕业日期'] && fields['出生日期'] >= fields['毕业日期']) errors.push('毕业日期应晚于出生日期');
  if (fields['身高（cm）'] && (!Number.isFinite(Number(fields['身高（cm）'])) || Number(fields['身高（cm）']) <= 0)) errors.push('身高须为正数');
  return errors;
}

export function intakeArchive(source: HrRecord, archives: HrRecord[], reserved: HrRecord[] = []): { existingId?: string; record: Omit<HrRecord, 'id' | 'history'> } {
  const candidateId = source.fields['候选人编号']?.trim() || `C-${source.id}`;
  const existing = archives.find(row => row.fields['来源采集编号'] === source.id || row.fields['候选人编号'] === candidateId);
  const requestedId = source.fields['人员编号']?.trim();
  if (requestedId && archives.some(row => row.fields['人员编号'] === requestedId && row.id !== existing?.id)) throw new Error('人员编号已属于其他档案，请核对候选人关联。');
  if (requestedId && existing?.fields['人员编号'] && requestedId !== existing.fields['人员编号']) throw new Error('已归档人员编号不可更换。');
  const related = [...archives, ...reserved].filter(row => row.id !== source.id);
  const linkedPersonId = existing?.fields['人员编号'] || requestedId;
  const candidateRecords = related.filter(row => row.fields['候选人编号']?.trim() === candidateId);
  if (candidateRecords.length && !linkedPersonId) throw new Error('候选人编号已存在，请先核对对应人员编号，不能重新分配人员。');
  if (candidateRecords.some(row => row.fields['人员编号']?.trim() && row.fields['人员编号'].trim() !== linkedPersonId)) throw new Error('候选人编号已关联其他人员，不能覆盖原招聘资料的人员关联。');
  if (linkedPersonId && related.some(row => row.fields['人员编号']?.trim() === linkedPersonId && row.fields['候选人编号']?.trim() && row.fields['候选人编号'].trim() !== candidateId)) throw new Error('人员编号已关联其他候选人，请核对候选人关联。');
  const max = [...archives, ...reserved].reduce((value, row) => Math.max(value, Number(row.fields['人员编号']?.match(/^E-(\d+)$/)?.[1] || 0)), 0);
  const employeeId = existing?.fields['人员编号'] || requestedId || `E-${String(max + 1).padStart(3, '0')}`;
  const selectedSafety = source.fields['安全教育部门'];
  const safety = ['研发', '运营', '供应链', '生产', '质量'].includes(selectedSafety) ? selectedSafety : (/研发/.test(source.dept) ? '研发' : /质量/.test(source.dept) ? '质量' : /生产|制造/.test(source.dept) ? '生产' : /供应链|采购|仓储/.test(source.dept) ? '供应链' : '运营');
  return {
    existingId: existing?.id,
    record: {
      title: source.fields['姓名'] || source.title, dept: source.dept, owner: source.owner, date: source.fields['预计报到日期'] || source.date,
      status: existing?.status || '待补齐', detail: existing?.detail || `由采集记录 ${source.id} 生成`,
      fields: { ...existing?.fields, ...source.fields, '候选人编号': candidateId, '人员编号': employeeId, '来源采集编号': source.id, '岗位': source.fields['拟入职岗位'] || source.fields['应聘岗位'] || '', '入职日期': source.fields['预计报到日期'] || source.date, '预计转正日期': existing?.fields['预计转正日期'] || '', '合同到期日': existing?.fields['合同到期日'] || '', '缺失字段': existing?.fields['缺失字段'] ?? '劳动合同、培训记录', '安全教育部门': safety },
    },
  };
}

export function assessmentLinkError(value: string): string {
  try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) && parsed.hostname ? '' : '测评链接须为完整的 HTTP / HTTPS 地址。'; }
  catch { return '测评链接须为完整的 HTTP / HTTPS 地址。'; }
}

export function assessmentReturnPatch(row: HrRecord, value: { report: string; conclusion: string; advice: string }): Partial<HrRecord> {
  if (!value.report.trim()) throw new Error('请先上传回传报告。');
  if (!value.conclusion.trim() || !value.advice.trim()) throw new Error('请填写报告结论及人工岗位适配建议。');
  return { status: '已完成', fields: { ...row.fields, '报告文件': value.report, '报告回传状态': '已人工核对', '测评结论': value.conclusion.trim(), '岗位适配建议': value.advice.trim() } };
}
