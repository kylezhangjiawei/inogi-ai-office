export const MOCK_EXPENSE_VOUCHERS = [
{
  id: 'EV-001',
  vendor: '蜀大侠火锅店',
  amount: 568.0,
  date: '2026-05-20',
  category: '餐饮',
  type: '小票',
  matched: true,
  matchedTo: 'IV-001',
  thumbColor: 'bg-orange-100'
},
{
  id: 'EV-002',
  vendor: '滴滴出行',
  amount: 86.5,
  date: '2026-05-21',
  category: '交通',
  type: '电子凭证',
  matched: true,
  matchedTo: 'IV-002',
  thumbColor: 'bg-blue-100'
},
{
  id: 'EV-003',
  vendor: '京东商城',
  amount: 1280.0,
  date: '2026-05-22',
  category: '办公',
  type: '订单截图',
  matched: false,
  thumbColor: 'bg-rose-100'
},
{
  id: 'EV-004',
  vendor: '锦江之星',
  amount: 459.0,
  date: '2026-05-23',
  category: '差旅',
  type: '酒店账单',
  matched: true,
  matchedTo: 'IV-003',
  thumbColor: 'bg-purple-100'
},
{
  id: 'EV-005',
  vendor: '高铁12306',
  amount: 553.5,
  date: '2026-05-23',
  category: '交通',
  type: '行程单',
  matched: true,
  matchedTo: 'IV-004',
  thumbColor: 'bg-blue-100'
},
{
  id: 'EV-006',
  vendor: '星巴克',
  amount: 156.0,
  date: '2026-05-24',
  category: '餐饮',
  type: '小票',
  matched: false,
  thumbColor: 'bg-orange-100'
},
{
  id: 'EV-007',
  vendor: '天猫超市',
  amount: 328.0,
  date: '2026-05-25',
  category: '办公',
  type: '订单截图',
  matched: false,
  thumbColor: 'bg-rose-100'
},
{
  id: 'EV-008',
  vendor: '出租车',
  amount: 45.0,
  date: '2026-05-26',
  category: '交通',
  type: '发票',
  matched: false,
  thumbColor: 'bg-blue-100'
}];


export const MOCK_INVOICE_VOUCHERS = [
{
  id: 'IV-001',
  issuer: '成都蜀大侠餐饮管理有限公司',
  invoiceNumber: '044002600312',
  amount: 568.0,
  taxAmount: 33.21,
  date: '2026-05-20',
  type: '增值税普通发票',
  matched: true,
  matchedTo: 'EV-001'
},
{
  id: 'IV-002',
  issuer: '滴滴出行科技有限公司',
  invoiceNumber: '044002600425',
  amount: 86.5,
  taxAmount: 5.06,
  date: '2026-05-21',
  type: '增值税电子发票',
  matched: true,
  matchedTo: 'EV-002'
},
{
  id: 'IV-003',
  issuer: '上海锦江国际酒店集团',
  invoiceNumber: '044002600583',
  amount: 459.0,
  taxAmount: 26.83,
  date: '2026-05-23',
  type: '增值税专用发票',
  matched: true,
  matchedTo: 'EV-004'
},
{
  id: 'IV-004',
  issuer: '中国铁路上海局集团有限公司',
  invoiceNumber: '044002600691',
  amount: 553.5,
  taxAmount: 50.32,
  date: '2026-05-23',
  type: '增值税电子发票',
  matched: true,
  matchedTo: 'EV-005'
},
{
  id: 'IV-005',
  issuer: '北京京东世纪信息技术有限公司',
  invoiceNumber: '044002600788',
  amount: 1280.0,
  taxAmount: 74.83,
  date: '2026-05-22',
  type: '增值税专用发票',
  matched: false
},
{
  id: 'IV-006',
  issuer: '上海星巴克咖啡有限公司',
  invoiceNumber: '044002600852',
  amount: 156.0,
  taxAmount: 9.12,
  date: '2026-05-24',
  type: '增值税普通发票',
  matched: false
}];


export const MOCK_ARCHIVED_GROUPS = [
{ category: '餐饮', icon: '🍜', count: 2, total: 724.0, color: 'orange' },
{ category: '交通', icon: '🚗', count: 4, total: 685.0, color: 'blue' },
{ category: '办公', icon: '📦', count: 2, total: 1608.0, color: 'rose' },
{ category: '差旅', icon: '🏨', count: 1, total: 459.0, color: 'purple' },
{ category: '其他', icon: '📄', count: 0, total: 0, color: 'slate' }];


export const MOCK_APPROVALS = [
{
  id: 'BX-20260525-01',
  title: '2026年5月差旅费报销',
  applicant: '李华',
  department: '销售部',
  amount: 2872.5,
  submitDate: '2026-05-26 14:30',
  currentStep: 2,
  totalSteps: 4,
  status: 'pending',
  items: 5,
  weComSpNo: '202605260012',
  weComTemplate: '差旅费报销',
  weComSyncStatus: '审批中',
  weComApprovalMethod: '或签',
  currentNode: '财务审核',
  carbonCopy: [
  { name: '赵敏', department: '财务部' },
  { name: '孙莉', department: '人事行政部' }],

  flow: [
  {
    name: '李华',
    role: '申请人',
    status: 'done',
    time: '2026-05-26 14:30'
  },
  {
    name: '王芳',
    role: '部门主管',
    status: 'done',
    time: '2026-05-26 16:45',
    remark: '差旅必要，同意'
  },
  { name: '张伟', role: '财务审核', status: 'current', time: '' },
  { name: '陈总', role: '总经理审批', status: 'pending', time: '' }]

},
{
  id: 'BX-20260524-03',
  title: '5月餐饮接待费报销',
  applicant: '李华',
  department: '销售部',
  amount: 1156.0,
  submitDate: '2026-05-24 09:15',
  currentStep: 4,
  totalSteps: 4,
  status: 'approved',
  items: 3,
  weComSpNo: '202605240008',
  weComTemplate: '日常费用报销',
  weComSyncStatus: '已回调',
  weComApprovalMethod: '或签',
  currentNode: '审批完成',
  carbonCopy: [
  { name: '赵敏', department: '财务部' }],

  flow: [
  {
    name: '李华',
    role: '申请人',
    status: 'done',
    time: '2026-05-24 09:15'
  },
  {
    name: '王芳',
    role: '部门主管',
    status: 'done',
    time: '2026-05-24 11:20'
  },
  {
    name: '张伟',
    role: '财务审核',
    status: 'done',
    time: '2026-05-25 10:08'
  },
  {
    name: '陈总',
    role: '总经理审批',
    status: 'done',
    time: '2026-05-25 15:42',
    remark: '已核准打款'
  }]

},
{
  id: 'BX-20260522-08',
  title: '办公用品采购报销',
  applicant: '王芳',
  department: '行政部',
  amount: 1608.0,
  submitDate: '2026-05-22 16:20',
  currentStep: 3,
  totalSteps: 4,
  status: 'rejected',
  items: 2,
  weComSpNo: '202605220015',
  weComTemplate: '办公采购报销',
  weComSyncStatus: '已回调',
  weComApprovalMethod: '或签',
  currentNode: '已驳回',
  carbonCopy: [
  { name: '李娜', department: '采购部' }],

  flow: [
  {
    name: '王芳',
    role: '申请人',
    status: 'done',
    time: '2026-05-22 16:20'
  },
  {
    name: '赵明',
    role: '部门主管',
    status: 'done',
    time: '2026-05-23 09:30'
  },
  {
    name: '张伟',
    role: '财务审核',
    status: 'rejected',
    time: '2026-05-23 14:15',
    remark: '京东订单缺少正式发票，请补齐后重新提交'
  },
  { name: '陈总', role: '总经理审批', status: 'pending', time: '' }]

}];