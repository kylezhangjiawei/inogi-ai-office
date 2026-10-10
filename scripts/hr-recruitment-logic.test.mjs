import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(name) {
  const path = new URL(`../src/app/hr/${name}.ts`, import.meta.url);
  if (!existsSync(path)) return {};
  const out = {};
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', code)(out, name => load(name.replace('./', '')));
  return out;
}
const logic = load('recruitmentLogic');
const row = (fields = {}, extra = {}) => ({ id: 'CL-001', title: '候选人甲', dept: '质量部', owner: 'HR', status: '待核对', date: '2026-11-02', detail: '', history: [], fields, ...extra });
const review = () => ({ scores: ['80','70','90','80','80'], weights: ['20','20','30','15','15'], evidence: ['确认问题边界','拆解质量问题','独立完成验证','主动协作','复盘后改进'], summary: { '个人基本信息': '三年质量经验', '候选人优点': '验证方案完整', '不足与待提升': '管理经验有限', '稳定性': '待背调核实', '薪酬敏感度': '未沟通', '综合评语': '可承担岗位基础职责', '录用建议': '推荐录用', '建议依据': '验证案例可核查' } });

test('发布稿只取终审快照，未批准或没有审批正文不能发布', () => {
  const jd = row({ 'JD 初稿': '未经审批的新内容', '已审批 JD 初稿': '终审批准的职责与任职要求', '招聘人数': '2' }, { status: '已批准' });
  assert.match(logic.approvedPublication(jd, '小红书'), /终审批准的职责与任职要求/);
  assert.doesNotMatch(logic.approvedPublication(jd, '小红书'), /未经审批的新内容/);
  assert.equal(logic.approvedPublication({ ...jd, status: '草稿' }, 'BOSS直聘'), '');
  assert.equal(logic.approvedPublication(row({ 'JD 初稿': '未审批' }, { status: '已批准' }), 'BOSS直聘'), '');
});

test('人事单方完成保留评价中，业务完成后才整单已评价且保留双方依据', () => {
  const first = logic.interviewReviewPatch(row(), '人事面试官', review());
  assert.equal(first.status, '评价中');
  assert.equal(first.fields['人事面试官综合分'], '81.0');
  assert.equal(first.fields['人事面试官:专业技术:依据'], '独立完成验证');
  const next = logic.interviewReviewPatch(row(first.fields), '业务面试官', review());
  assert.equal(next.status, '已评价');
  assert.equal(next.fields['人事面试官:专业技术:依据'], '独立完成验证');
  assert.equal(next.fields['业务面试官:总结:稳定性'], '待背调核实');
});

test('面试缺逐维依据、不完整总结、负数或权重不合计100时不能完成', () => {
  const noEvidence = review(); noEvidence.evidence[2] = '';
  assert.throws(() => logic.interviewReviewPatch(row(), '人事面试官', noEvidence), /依据/);
  const noSummary = review(); noSummary.summary['建议依据'] = '';
  assert.throws(() => logic.interviewReviewPatch(row(), '人事面试官', noSummary), /总结/);
  const negative = review(); negative.scores[0] = '-1';
  assert.throws(() => logic.interviewReviewPatch(row(), '人事面试官', negative), /0–100/);
  const badWeights = review(); badWeights.weights[0] = '19';
  assert.throws(() => logic.interviewReviewPatch(row(), '人事面试官', badWeights), /100/);
});

test('归档保留采集全部字段、候选人关联与部门，重复归档更新同一稳定人员', () => {
  const source = row({ '候选人编号': 'C-001', '拟入职岗位': '质量工程师', '联系电话': '13800000000', '个人邮箱': 'candidate@example.com', '学历': '本科', '毕业学校': '某大学', '所学专业': '质量管理', '教育培训经历': '完整教育经历', '工资卡开户行': '示例银行', '自定义补充': '不得丢失' });
  const existing = row({ '人员编号': 'E-002', '候选人编号': 'C-099', '合同到期日': '2029-01-01' }, { id: 'EA-002' });
  const created = logic.intakeArchive(source, [existing]);
  assert.equal(created.record.fields['人员编号'], 'E-003');
  assert.equal(created.record.fields['个人邮箱'], 'candidate@example.com');
  assert.equal(created.record.fields['自定义补充'], '不得丢失');
  assert.equal(created.record.fields['安全教育部门'], '质量');
  assert.equal(created.record.fields['来源采集编号'], 'CL-001');
  const persisted = { ...created.record, id: 'EA-003', history: [], fields: { ...created.record.fields, '合同到期日': '2028-01-01' } };
  const repeated = logic.intakeArchive({ ...source, fields: { ...source.fields, '联系电话': '13900000000' } }, [existing, persisted]);
  assert.equal(repeated.existingId, 'EA-003');
  assert.equal(repeated.record.fields['人员编号'], 'E-003');
  assert.equal(repeated.record.fields['合同到期日'], '2028-01-01');
  assert.equal(repeated.record.fields['联系电话'], '13900000000');
});

test('归档不按同名合并，也不覆盖其他候选人的人员编号', () => {
  const sameName = row({ '人员编号': 'E-005', '候选人编号': 'C-009' }, { id: 'EA-5' });
  assert.equal(logic.intakeArchive(row({ '候选人编号': 'C-001' }), [sameName]).existingId, undefined);
  assert.throws(() => logic.intakeArchive(row({ '候选人编号': 'C-001', '人员编号': 'E-005' }), [sameName]), /人员编号/);
});

test('测评链接仅允许HTTPS或HTTP地址且回传缺报告或结论不能完成', () => {
  assert.equal(logic.assessmentLinkError('https://assessment.example.com/start?candidate=C-001'), '');
  for (const value of ['', 'javascript:alert(1)', 'file:///tmp/report', '/local']) assert.ok(logic.assessmentLinkError(value));
  assert.throws(() => logic.assessmentReturnPatch(row(), { report: '', conclusion: '报告已审核', advice: '综合考察' }), /报告/);
  const result = logic.assessmentReturnPatch(row({ '候选人编号': 'C-001' }), { report: '职业测评.pdf', conclusion: '报告原文摘要', advice: '结合面试核实' });
  assert.equal(result.status, '已完成');
  assert.equal(result.fields['报告回传状态'], '已人工核对');
  assert.equal(result.fields['候选人编号'], 'C-001');
});

test('候选人提交校验核心身份联系信息，阻止错误邮箱电话和毕业日期倒置', () => {
  assert.ok(logic.intakeErrors({}, 'collect').some(value => value.includes('联系电话')));
  const errors = logic.intakeErrors({ '联系电话': 'bad', '个人邮箱': 'x', '入学日期': '2025-09-01', '毕业日期': '2024-07-01' }, 'collect');
  assert.ok(errors.some(value => value.includes('联系电话格式')));
  assert.ok(errors.some(value => value.includes('邮箱格式')));
  assert.ok(errors.some(value => value.includes('毕业日期')));
});

test('招聘审批由当前步骤对应角色推进，员工本人及非当前审批人不能通过', () => {
  assert.equal(logic.canAdvanceApproval('req01', '业务确认', '员工本人'), false);
  assert.equal(logic.canAdvanceApproval('req01', '业务确认', '人力负责人'), false);
  assert.equal(logic.canAdvanceApproval('req01', '业务确认', '部门负责人'), true);
  assert.equal(logic.canAdvanceApproval('req01', '人力审核', '人力负责人'), true);
  assert.equal(logic.canAdvanceApproval('req01', '总经理终审', '总经理'), true);
  assert.equal(logic.canAdvanceApproval('offer', '总经理', '人力负责人'), false);
  assert.equal(logic.canAdvanceApproval('offer', '总经理', '总经理'), true);
  assert.equal(logic.canAdvanceApproval('offer', '已批准', '总经理'), false);
});

test('归档安全教育模板限定五个已配置部门，供应链与职能人员可正常打开卡片', () => {
 assert.equal(logic.intakeArchive(row({}, {dept:'供应链部'}),[]).record.fields['安全教育部门'],'供应链');
 assert.equal(logic.intakeArchive(row({}, {dept:'销售部'}),[]).record.fields['安全教育部门'],'运营');
 assert.equal(logic.intakeArchive(row({'安全教育部门':'未知旧模板'}, {dept:'职能部'}),[]).record.fields['安全教育部门'],'运营');
});

test('录用审批前需完整且有效的条件；空工资或负工资不进入下一步',()=>{
 const complete=row({'拟录用岗位':'工程师','预计到岗时间':'2026-11-02','有效期':'2026-10-30','试用期月薪':'9000','标准月薪':'10000','每周工作天数':'5'});
 assert.equal(logic.offerApprovalError(complete),'');
 assert.match(logic.offerApprovalError(row({...complete.fields,'试用期月薪':''})),/试用期月薪/);
 assert.match(logic.offerApprovalError(row({...complete.fields,'标准月薪':'-1'})),/标准月薪/);
 assert.match(logic.offerApprovalError(row({...complete.fields,'预计到岗时间':'2026-02-30'})),/日期/);
});

test('归档阻止复用已有关联的候选人编号，无人员编号也不能重新分配', () => {
  const recruitment = row({ '候选人编号': 'C-001', '人员编号': 'E-003' }, { id: 'RESUME-001' });
  assert.throws(() => logic.intakeArchive(row({ '候选人编号': 'C-001', '人员编号': 'E-099' }), [], [recruitment]), /候选人编号已关联其他人员/);
  assert.throws(() => logic.intakeArchive(row({ '候选人编号': 'C-001' }), [], [recruitment]), /对应人员编号/);
});

test('归档允许同一人员的多模块招聘资料，阻止该人员改挂另一个候选人', () => {
  const reserved = ['RESUME-001', 'APPLY-001', 'OFFER-001'].map(id => row({ '候选人编号': 'C-001', '人员编号': 'E-003' }, { id }));
  const result = logic.intakeArchive(row({ '候选人编号': 'C-001', '人员编号': 'E-003' }), [], reserved);
  assert.equal(result.record.fields['人员编号'], 'E-003');
  assert.equal(result.record.fields['候选人编号'], 'C-001');
  assert.throws(() => logic.intakeArchive(row({ '候选人编号': 'C-099', '人员编号': 'E-003' }), [], reserved), /人员编号已关联其他候选人/);
});

test('同一来源采集再次归档保留身份，篡改候选人编号不能覆盖现有档案', () => {
  const source = row({ '候选人编号': 'C-001', '人员编号': 'E-003' });
  const existing = row({ ...source.fields, '来源采集编号': source.id }, { id: 'ARCHIVE-003' });
  assert.equal(logic.intakeArchive(row({ '候选人编号': 'C-001' }), [existing]).record.fields['人员编号'], 'E-003');
  assert.throws(() => logic.intakeArchive(row({ ...source.fields, '候选人编号': 'C-099' }), [existing]), /候选人/);
});
