/**
 * 采购模块演示种子数据。
 *
 * 与前端 src/mock/procurement.ts 同源（同一批任务/物料/报价），差别在于：
 * 日期一律用「相对今天的偏移天数」表达，落库时换算成真实日期——
 * mock 里是相对固定 DEMO_TODAY 的绝对日期，直接搬会全部变成逾期。
 *
 * 只在空库时通过 POST /api/procurement/seed 手动灌入，不参与任何自动流程。
 */

export interface SeedQuotation {
  supplierName: string;
  unitPrice: number;
  leadTimeDays: number;
  /** 相对今天的偏移天数，负数为过去 */
  quoteDay: number;
  isSelected?: boolean;
}

export interface SeedMaterial {
  name: string;
  spec: string;
  unit: string;
  category: string;
  productLine: string;
  erpCode: string;
  isSpecial?: boolean;
  isConsumable?: boolean;
  reviewStatus: 'pending' | 'approved';
  reviewSource?: 'import' | 'auto';
  /** 库存镜像（正式接 T+ 后由同步覆盖） */
  stockQty: number;
  safeStock: number;
  latestPrice?: number;
  latestSupplier?: string;
  latestQuoteDay?: number;
}

export interface SeedTask {
  materialName: string;
  spec: string;
  unit: string;
  quantity: number;
  method: 'inquiry' | 'direct';
  purchaseLink?: string;
  source: 'rd' | 'self';
  businessLine: 'rd' | 'production';
  status: string;
  priority: 'high' | 'medium' | 'low';
  needSample: boolean;
  needDay?: number;
  deadlineDay?: number;
  etaDay?: number;
  paymentDay?: number;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  paymentNote?: string;
  arrivedQty: number;
  rdTaskTitle?: string;
  buyer: string;
  rdContact?: string;
  requester: string;
  requesterDept: string;
  consumableNote?: string;
  attachmentCount: number;
  logs: { day: number; text: string }[];
}

export const SEED_BUYER = '周敏';

export const SEED_MATERIALS: SeedMaterial[] = [
  { name: '减震垫 DZC-950', spec: '50×20mm 橡胶', unit: '件', category: '压缩系统', productLine: '便携式制氧机', erpCode: 'ERP-CY-0950', reviewStatus: 'approved', stockQty: 1240, safeStock: 500, latestPrice: 3.5, latestSupplier: '苏州澎润', latestQuoteDay: -13 },
  { name: '分子筛筛筒 MS-30', spec: 'Φ30×120mm 不锈钢', unit: '件', category: '分子筛系统', productLine: '便携式制氧机', erpCode: 'ERP-FZS-0030', reviewStatus: 'approved', stockQty: 0, safeStock: 100, latestPrice: 11.8, latestSupplier: '宁波恒力', latestQuoteDay: -1 },
  { name: '压缩机阀片', spec: '0.15mm 弹簧钢', unit: '件', category: '310阀系统', productLine: '便携式制氧机', erpCode: 'ERP-310-0015', reviewStatus: 'approved', stockQty: 320, safeStock: 400, latestPrice: 0.6, latestSupplier: '宁波恒力', latestQuoteDay: -11 },
  { name: '无油活塞环', spec: 'Φ42 · 石墨填充', unit: '件', category: '压缩系统', productLine: '5L直流式制氧机', erpCode: 'ERP-CY-0042', reviewStatus: 'approved', stockQty: 150, safeStock: 200, latestPrice: 5.6, latestSupplier: '宁波恒力', latestQuoteDay: -9 },
  { name: '散热风扇 9225', spec: '92×92×25mm 12V', unit: '个', category: '风冷系统', productLine: '5L直流式制氧机', erpCode: 'ERP-FL-9225', reviewStatus: 'approved', stockQty: 200, safeStock: 150, latestPrice: 8.2, latestSupplier: '深圳风华', latestQuoteDay: -11 },
  { name: '电池 PD 电源板', spec: '定制 · 65W', unit: '块', category: '电源部分', productLine: '便携式制氧机', erpCode: 'ERP-DY-0065', reviewStatus: 'approved', stockQty: 88, safeStock: 60, latestPrice: 42.0, latestSupplier: '深圳风华', latestQuoteDay: -18 },
  { name: 'TOP板 PCB', spec: '4 层 · 沉金', unit: '件', category: 'Top结构', productLine: '便携式制氧机', erpCode: 'ERP-TOP-0004', reviewStatus: 'approved', stockQty: 60, safeStock: 50, latestPrice: 18.5, latestSupplier: '昆山塑胶', latestQuoteDay: -15 },
  { name: '底盖模具镶件', spec: 'SKD11 精加工', unit: '件', category: '底部结构', productLine: '通用', erpCode: 'ERP-DB-0011', reviewStatus: 'approved', stockQty: 12, safeStock: 10, latestPrice: 260.0, latestSupplier: '东莞精密', latestQuoteDay: -34 },
  { name: '湿化瓶接头', spec: 'PC 透明 · 快插', unit: '件', category: '配件系统', productLine: '正压式呼吸器', erpCode: 'ERP-PJ-0001', reviewStatus: 'approved', stockQty: 500, safeStock: 300, latestPrice: 1.2, latestSupplier: '苏州澎润', latestQuoteDay: -23 },
  { name: 'PU管 φ8', spec: 'φ8×5 蓝色', unit: '米', category: '气管系统', productLine: '通用', erpCode: 'ERP-QG-0008', isSpecial: true, isConsumable: true, reviewStatus: 'approved', stockQty: 800, safeStock: 500, latestPrice: 1.8, latestSupplier: '华东橡塑', latestQuoteDay: -21 },
  { name: '主线束', spec: '定制 · UL1007', unit: '套', category: '线束系统', productLine: '5L直流式制氧机', erpCode: 'ERP-XS-0001', isSpecial: true, reviewStatus: 'pending', reviewSource: 'import', stockQty: 40, safeStock: 50, latestPrice: 12.0, latestSupplier: '常州线缆', latestQuoteDay: -13 },
  { name: '硅胶管 φ6', spec: 'φ6×2 医用级', unit: '米', category: '气管系统', productLine: '通用', erpCode: 'ERP-QG-0006', isConsumable: true, reviewStatus: 'approved', stockQty: 5000, safeStock: 2000, latestPrice: 2.1, latestSupplier: '华东橡塑', latestQuoteDay: -21 },
  { name: '电池盒上盖硅胶密封圈', spec: '定制 · 邵氏50A', unit: '件', category: '密封系统', productLine: '便携式制氧机', erpCode: 'ERP-MF-0001', reviewStatus: 'pending', reviewSource: 'auto', stockQty: 0, safeStock: 200, latestPrice: 0.85, latestSupplier: '华东橡塑', latestQuoteDay: -3 },
];

export const SEED_TASKS: SeedTask[] = [
  { materialName: '底盖模具镶件', spec: 'SKD11 精加工', unit: '件', quantity: 4, method: 'inquiry', source: 'rd', businessLine: 'rd', status: 'pending_confirm', priority: 'high', needSample: false, needDay: 13, deadlineDay: 11, paymentStatus: 'unpaid', arrivedQty: 0, rdTaskTitle: '底盖模具图完善', buyer: SEED_BUYER, rdContact: '刘至远', requester: '刘至远', requesterDept: '研发部', attachmentCount: 2, logs: [{ day: -1, text: '由研发任务「底盖模具图完善」流转生成，待采购确认提交' }] },
  { materialName: 'PU管 φ8', spec: 'φ8×5 蓝色', unit: '米', quantity: 100, method: 'inquiry', source: 'self', businessLine: 'production', status: 'pending_inquiry', priority: 'low', needSample: false, needDay: 19, deadlineDay: 17, paymentStatus: 'unpaid', arrivedQty: 0, buyer: SEED_BUYER, requester: '王建军', requesterDept: '生产部', consumableNote: '低值易耗品，按年用量备货', attachmentCount: 0, logs: [{ day: -1, text: '采购自建，待向供应商询价' }] },
  { materialName: '分子筛筛筒 MS-30', spec: 'Φ30×120mm 不锈钢', unit: '件', quantity: 200, method: 'inquiry', source: 'rd', businessLine: 'rd', status: 'inquiring', priority: 'high', needSample: false, needDay: 9, deadlineDay: 7, paymentStatus: 'unpaid', arrivedQty: 0, rdTaskTitle: '分子筛筛筒装配间隙核查', buyer: SEED_BUYER, rdContact: '李松', requester: '李松', requesterDept: '研发部', attachmentCount: 1, logs: [{ day: -2, text: '研发流转生成' }, { day: -1, text: '已录入 3 条供应商报价' }] },
  { materialName: '电池盒上盖硅胶密封圈', spec: '定制 · 邵氏50A', unit: '件', quantity: 500, method: 'inquiry', source: 'rd', businessLine: 'rd', status: 'pending_sample', priority: 'medium', needSample: true, needDay: 15, deadlineDay: 14, paymentStatus: 'unpaid', arrivedQty: 0, rdTaskTitle: '电池盒样件问题反馈', buyer: SEED_BUYER, rdContact: '包毓飞', requester: '包毓飞', requesterDept: '研发部', attachmentCount: 2, logs: [{ day: -3, text: '选定华东橡塑并发起打样，待到样' }] },
  { materialName: 'TOP板 PCB', spec: '4 层 · 沉金', unit: '件', quantity: 50, method: 'inquiry', source: 'rd', businessLine: 'rd', status: 'testing', priority: 'medium', needSample: true, needDay: 16, deadlineDay: 15, paymentStatus: 'unpaid', arrivedQty: 0, rdTaskTitle: 'TOP板控制逻辑验证', buyer: SEED_BUYER, rdContact: '李松', requester: '李松', requesterDept: '研发部', attachmentCount: 1, logs: [{ day: -5, text: '样品已到，研发测试中' }] },
  { materialName: '无油活塞环', spec: 'Φ42 · 石墨填充', unit: '件', quantity: 1000, method: 'inquiry', source: 'self', businessLine: 'rd', status: 'priced', priority: 'medium', needSample: true, needDay: 21, deadlineDay: 22, paymentStatus: 'unpaid', arrivedQty: 0, buyer: SEED_BUYER, requester: SEED_BUYER, requesterDept: '采购部', attachmentCount: 0, logs: [{ day: -7, text: '测试通过，已定价，待下单' }] },
  { materialName: '湿化瓶接头', spec: 'PC 透明 · 快插', unit: '件', quantity: 300, method: 'direct', purchaseLink: 'https://mall.example.com/item/humidifier-joint', source: 'self', businessLine: 'production', status: 'pending_purchase', priority: 'high', needSample: false, needDay: 3, deadlineDay: 2, paymentStatus: 'unpaid', arrivedQty: 0, buyer: SEED_BUYER, requester: '王建军', requesterDept: '生产部', consumableNote: '低值易耗品', attachmentCount: 0, logs: [{ day: -1, text: '电商直购，待下单购买' }] },
  { materialName: '散热风扇 9225', spec: '92×92×25mm 12V', unit: '个', quantity: 1000, method: 'direct', purchaseLink: 'https://mall.example.com/item/fan-9225', source: 'self', businessLine: 'production', status: 'in_transit', priority: 'medium', needSample: false, needDay: 7, etaDay: 5, paymentDay: 1, paymentStatus: 'paid', arrivedQty: 0, buyer: SEED_BUYER, requester: '赵天成', requesterDept: '生产部', attachmentCount: 0, logs: [{ day: 0, text: '已下单，在途' }] },
  { materialName: '压缩机阀片', spec: '0.15mm 弹簧钢', unit: '件', quantity: 500, method: 'inquiry', source: 'self', businessLine: 'production', status: 'in_transit', priority: 'high', needSample: false, needDay: -5, etaDay: -3, paymentDay: -8, paymentStatus: 'paid', arrivedQty: 0, buyer: SEED_BUYER, requester: '王建军', requesterDept: '生产部', attachmentCount: 0, logs: [{ day: -8, text: '已下单，在途（预计到货已逾期）' }] },
  { materialName: '减震垫 DZC-950', spec: '50×20mm 橡胶', unit: '件', quantity: 2000, method: 'inquiry', source: 'rd', businessLine: 'rd', status: 'partial_arrival', priority: 'high', needSample: true, needDay: 13, etaDay: 12, paymentDay: -2, paymentStatus: 'partial', paymentNote: '首付 30% 已付', arrivedQty: 800, rdTaskTitle: '新压缩机950减震垫选型', buyer: SEED_BUYER, rdContact: '包毓飞', requester: '包毓飞', requesterDept: '研发部', attachmentCount: 2, logs: [{ day: -13, text: '选定苏州澎润并签约' }, { day: -5, text: '第1批到货 +800' }] },
  { materialName: '硅胶管 φ6', spec: 'φ6×2 医用级', unit: '米', quantity: 5000, method: 'inquiry', source: 'self', businessLine: 'production', status: 'completed', priority: 'low', needSample: false, needDay: -23, etaDay: -9, paymentDay: -9, paymentStatus: 'paid', arrivedQty: 5000, buyer: SEED_BUYER, requester: '赵天成', requesterDept: '生产部', attachmentCount: 0, logs: [{ day: -9, text: '全部到货，已完成' }] },
];

/** 历史报价：按物料名归集，供价格趋势对比。 */
export const SEED_QUOTATIONS: Record<string, SeedQuotation[]> = {
  '硅胶管 φ6': [
    { supplierName: '华东橡塑', unitPrice: 2.6, leadTimeDays: 12, quoteDay: -322 },
    { supplierName: '宁波恒力', unitPrice: 2.45, leadTimeDays: 15, quoteDay: -225 },
    { supplierName: '华东橡塑', unitPrice: 2.35, leadTimeDays: 12, quoteDay: -143 },
    { supplierName: '苏州澎润', unitPrice: 2.28, leadTimeDays: 10, quoteDay: -76 },
    { supplierName: '华东橡塑', unitPrice: 2.1, leadTimeDays: 12, quoteDay: -21 },
  ],
  '减震垫 DZC-950': [
    { supplierName: '华东橡塑', unitPrice: 3.8, leadTimeDays: 10, quoteDay: -15 },
    { supplierName: '宁波恒力', unitPrice: 4.2, leadTimeDays: 7, quoteDay: -15 },
    { supplierName: '苏州澎润', unitPrice: 3.5, leadTimeDays: 12, quoteDay: -15, isSelected: true },
  ],
  '分子筛筛筒 MS-30': [
    { supplierName: '华东橡塑', unitPrice: 12.5, leadTimeDays: 12, quoteDay: -1 },
    { supplierName: '宁波恒力', unitPrice: 11.8, leadTimeDays: 15, quoteDay: -1 },
    { supplierName: '苏州澎润', unitPrice: 13.0, leadTimeDays: 8, quoteDay: -1 },
  ],
};

export const SEED_SUPPLIERS = [
  { name: '华东橡塑', contact: '陈工', phone: '021-6600xxxx' },
  { name: '宁波恒力', contact: '刘经理', phone: '0574-8800xxxx' },
  { name: '苏州澎润', contact: '吴经理', phone: '0512-6500xxxx' },
  { name: '深圳风华', contact: '黄工', phone: '0755-8300xxxx' },
  { name: '昆山塑胶', contact: '孙经理', phone: '0512-5700xxxx' },
  { name: '东莞精密', contact: '梁工', phone: '0769-2200xxxx' },
  { name: '常州线缆', contact: '周经理', phone: '0519-8500xxxx' },
];
