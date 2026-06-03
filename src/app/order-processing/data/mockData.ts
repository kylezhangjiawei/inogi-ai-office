export const MOCK_ORDERS = [
{
  id: 'PO-20260524-01',
  customer: '上海星辉贸易有限公司',
  date: '05-30',
  status: '发货临近',
  type: 'warning'
},
{
  id: 'PO-20260523-08',
  customer: '杭州优品电子有限公司',
  date: '06-02',
  status: '价格差异',
  type: 'error'
},
{
  id: 'PO-20260523-07',
  customer: '广东宏达科技有限公司',
  date: '06-05',
  status: '正常',
  type: 'success'
},
{
  id: 'PO-20260522-15',
  customer: '深圳市捷通实业有限公司',
  date: '05-28',
  status: '库存不足',
  type: 'error'
},
{
  id: 'PO-20260522-11',
  customer: '南京华信商贸有限公司',
  date: '06-01',
  status: '已生成',
  type: 'info'
},
{
  id: 'PO-20260521-03',
  customer: '苏州创联科技有限公司',
  date: '05-29',
  status: '价格差异',
  type: 'error'
}];


export const MOCK_ORDER_DETAILS: Record<string, any> = {
  'PO-20260524-01': {
    customer: '上海星辉贸易有限公司',
    orderId: 'PO-20260524-01',
    date: '2026-05-30',
    amount: '¥28,650.00',
    source: 'Gmail',
    products: [
    {
      id: 'BT-001',
      name: '无线蓝牙耳机',
      category: '数码配件',
      spec: '黑色',
      unit: '个',
      orderQty: 10,
      stockQty: 25,
      orderPrice: '180.00',
      sysPrice: '180.00',
      subtotal: '1,800.00',
      status: '通过',
      remark: '无'
    },
    {
      id: 'TC-002',
      name: 'Type-C 数据线',
      category: '线材',
      spec: '1m 白色',
      unit: '条',
      orderQty: 20,
      stockQty: 80,
      orderPrice: '12.00',
      sysPrice: '15.00',
      subtotal: '240.00',
      status: '价格差异',
      remark: '系统单价高于订单单价 ¥3.00'
    },
    {
      id: 'PB-100',
      name: '移动电源 10000mAh',
      category: '数码配件',
      spec: '黑色',
      unit: '个',
      orderQty: 30,
      stockQty: 12,
      orderPrice: '65.00',
      sysPrice: '65.00',
      subtotal: '1,950.00',
      status: '库存不足',
      remark: '缺少 18 个'
    },
    {
      id: 'CH-018',
      name: 'USB充电器 18W',
      category: '充电器',
      spec: '白色',
      unit: '个',
      orderQty: 50,
      stockQty: 120,
      orderPrice: '19.00',
      sysPrice: '19.00',
      subtotal: '950.00',
      status: '通过',
      remark: '无'
    },
    {
      id: 'SP-002',
      name: '蓝牙音箱',
      category: '音频设备',
      spec: '灰色',
      unit: '台',
      orderQty: 5,
      stockQty: 18,
      orderPrice: '120.00',
      sysPrice: '120.00',
      subtotal: '600.00',
      status: '通过',
      remark: '无'
    },
    {
      id: 'HS-005',
      name: '手机支架',
      category: '手机配件',
      spec: '铝合金',
      unit: '个',
      orderQty: 15,
      stockQty: 33,
      orderPrice: '25.00',
      sysPrice: '25.00',
      subtotal: '375.00',
      status: '通过',
      remark: '无'
    },
    {
      id: 'HD-010',
      name: 'HDMI高清线',
      category: '线材',
      spec: '2m',
      unit: '条',
      orderQty: 20,
      stockQty: 40,
      orderPrice: '28.00',
      sysPrice: '28.00',
      subtotal: '560.00',
      status: '通过',
      remark: '无'
    },
    {
      id: 'BOX-022',
      name: '包装纸箱',
      category: '包装耗材',
      spec: '中号',
      unit: '个',
      orderQty: 60,
      stockQty: 200,
      orderPrice: '5.00',
      sysPrice: '5.00',
      subtotal: '300.00',
      status: '通过',
      remark: '无'
    }]

  }
};

export const MOCK_INVENTORY = [
{
  id: 'BT-001',
  name: '无线蓝牙耳机',
  category: '数码配件',
  spec: '黑色',
  stock: 25,
  safe: 20,
  in: 0,
  out: 10,
  status: '正常'
},
{
  id: 'TC-002',
  name: 'Type-C 数据线',
  category: '线材',
  spec: '1m 白色',
  stock: 80,
  safe: 100,
  in: 50,
  out: 20,
  status: '偏低'
},
{
  id: 'PB-100',
  name: '移动电源 10000mAh',
  category: '数码配件',
  spec: '黑色',
  stock: 12,
  safe: 50,
  in: 100,
  out: 30,
  status: '缺货'
},
{
  id: 'CH-018',
  name: 'USB充电器 18W',
  category: '充电器',
  spec: '白色',
  stock: 120,
  safe: 50,
  in: 0,
  out: 50,
  status: '正常'
},
{
  id: 'SP-002',
  name: '蓝牙音箱',
  category: '音频设备',
  spec: '灰色',
  stock: 18,
  safe: 15,
  in: 0,
  out: 5,
  status: '正常'
},
{
  id: 'HS-005',
  name: '手机支架',
  category: '手机配件',
  spec: '铝合金',
  stock: 33,
  safe: 30,
  in: 0,
  out: 15,
  status: '正常'
},
{
  id: 'HD-010',
  name: 'HDMI高清线',
  category: '线材',
  spec: '2m',
  stock: 40,
  safe: 50,
  in: 20,
  out: 20,
  status: '偏低'
},
{
  id: 'BOX-022',
  name: '包装纸箱',
  category: '包装耗材',
  spec: '中号',
  stock: 200,
  safe: 100,
  in: 0,
  out: 60,
  status: '正常'
},
{
  id: 'KB-200',
  name: '机械键盘',
  category: '外设',
  spec: '青轴',
  stock: 5,
  safe: 20,
  in: 30,
  out: 2,
  status: '缺货'
},
{
  id: 'MS-015',
  name: '无线鼠标',
  category: '外设',
  spec: '黑色',
  stock: 45,
  safe: 30,
  in: 0,
  out: 10,
  status: '正常'
},
{
  id: 'CB-050',
  name: '千兆网线',
  category: '线材',
  spec: '5m',
  stock: 150,
  safe: 100,
  in: 0,
  out: 20,
  status: '正常'
},
{
  id: 'DP-101',
  name: 'DP高清线',
  category: '线材',
  spec: '1.5m',
  stock: 18,
  safe: 30,
  in: 50,
  out: 5,
  status: '偏低'
}];


export const MOCK_MOVEMENTS = [
{ id: 1, type: 'in', desc: '入库 +50 USB充电器 18W', time: '2小时前' },
{ id: 2, type: 'out', desc: '出库 -10 无线蓝牙耳机', time: '5小时前' },
{ id: 3, type: 'in', desc: '入库 +200 包装纸箱', time: '昨天 14:30' },
{ id: 4, type: 'out', desc: '出库 -5 蓝牙音箱', time: '昨天 10:15' },
{ id: 5, type: 'out', desc: '出库 -20 Type-C 数据线', time: '前天 16:45' }];