export const registrationGroups = [
  { title: '身份与联系方式', fields: ['姓名','性别','出生日期','婚姻状况','身份证号码','政治面貌','身高（cm）','联系电话','个人邮箱','现居住地址','户籍地址','紧急联系人','紧急联系人关系','紧急联系人电话'] },
  { title: '教育、经历与证书', fields: ['学历','毕业学校','所学专业','入学日期','毕业日期','教育培训经历','工作经历','前任公司离职原因','证书与技能','家庭成员'] },
  { title: '求职与到岗信息', fields: ['当前薪资','期望薪资','可接受最低薪资','预计报到日期','招聘信息来源','本公司亲友关系','竞业限制情况'] },
  { title: '声明与签名', fields: ['健康情况声明','信息真实性声明','填表人签名','签署日期'] },
] as const;
export const onboardingGroups = [
  ...registrationGroups.slice(0, 3),
  { title: '入职办理', fields: ['社保公积金转出地','工资卡开户行','工资卡号','企微绑定手机','体检报告','其他入职材料'] },
  registrationGroups[3],
] as const;
export const registrationFields = registrationGroups.flatMap(group => [...group.fields]);
export const onboardingFields = onboardingGroups.flatMap(group => [...group.fields]);
export const interviewDimensions = ['沟通能力','逻辑思维','专业技术','价值观','成长潜力'] as const;
export const interviewSummaryFields = ['个人基本信息','候选人优点','不足与待提升','稳定性','薪酬敏感度','综合评语','录用建议','建议依据'] as const;
export const interviewRoles = ['人事面试官','业务面试官'] as const;
export type InterviewRole = typeof interviewRoles[number];
export type InterviewDraft = { scores: string[]; weights: string[]; evidence: string[]; summary: Record<string, string> };

export const recruitmentExtraFields: Record<string, string[]> = {
  apply: ['候选人编号', ...registrationFields],
  collect: ['候选人编号','人员编号', ...onboardingFields],
  resume: ['候选人编号'],
  interview: ['候选人编号'],
  assess: ['候选人编号','人员编号','测评链接','报告回传状态','关联档案编号'],
  offer: ['候选人编号','收件邮箱','邮件主题','邮件正文'],
};
