// 会议核对目录，不是 ERP 物料；映射必须由授权人员确认。
export const KEY_MATERIAL_CLUES = [
  {
    "id": "K01",
    "name": "210阀",
    "group": "阀与气路",
    "check": "核对正式料号、规格版本及适用产品",
    "sourceTime": "11:55／14:11／18:04",
    "kind": "key"
  },
  {
    "id": "K02",
    "name": "310阀",
    "group": "阀与气路",
    "check": "核对正式料号、规格版本及适用产品",
    "sourceTime": "11:55／14:11／18:04",
    "kind": "key"
  },
  {
    "id": "K03",
    "name": "左三通塑料件",
    "group": "阀与气路",
    "check": "核对是否与口述左三通阀座为同一料号",
    "sourceTime": "14:11／18:04",
    "kind": "key"
  },
  {
    "id": "K04",
    "name": "右三通塑料件",
    "group": "阀与气路",
    "check": "核对是否与口述右三通阀座为同一料号",
    "sourceTime": "14:11／18:04",
    "kind": "key"
  },
  {
    "id": "K05",
    "name": "两通塑料件",
    "group": "阀与气路",
    "check": "按不同规格展开正式料号",
    "sourceTime": "14:11／18:04",
    "kind": "key"
  },
  {
    "id": "K06",
    "name": "方阀（单阀）",
    "group": "阀与气路",
    "check": "转写为“方法／单法”，名称及结构待核",
    "sourceTime": "18:04—18:38",
    "kind": "key"
  },
  {
    "id": "K07",
    "name": "方阀（双阀）",
    "group": "阀与气路",
    "check": "转写为“方法／双法”，名称及结构待核",
    "sourceTime": "18:04—18:38",
    "kind": "key"
  },
  {
    "id": "K08",
    "name": "机加进气阀（单阀）",
    "group": "阀与气路",
    "check": "按机加工相关口述暂列，名称与单／双阀对应待核",
    "sourceTime": "18:38",
    "kind": "key"
  },
  {
    "id": "K09",
    "name": "机加出气阀（单阀）",
    "group": "阀与气路",
    "check": "按机加工相关口述暂列，名称与单／双阀对应待核",
    "sourceTime": "18:38",
    "kind": "key"
  },
  {
    "id": "K10",
    "name": "机加进气阀（双阀）",
    "group": "阀与气路",
    "check": "按机加工相关口述暂列，不额外推断出气阀双阀",
    "sourceTime": "18:38",
    "kind": "key"
  },
  {
    "id": "K11",
    "name": "压缩机",
    "group": "动力供电与耗材",
    "check": "按产品型号、规格及合格供应关系展开",
    "sourceTime": "12:21／18:38",
    "kind": "key"
  },
  {
    "id": "K12",
    "name": "分子筛",
    "group": "动力供电与耗材",
    "check": "区分原料分子筛与筛筒组件，单位及用量按BOM确认",
    "sourceTime": "12:21",
    "kind": "key"
  },
  {
    "id": "K13",
    "name": "主PCB",
    "group": "电控传感与交互",
    "check": "核对板号、版本及适用产品",
    "sourceTime": "18:38",
    "kind": "key"
  },
  {
    "id": "K14",
    "name": "“矿板PCB”",
    "group": "电控传感与交互",
    "check": "保留转写原词，名称待核；不自行改成副板或扩展板",
    "sourceTime": "18:38",
    "kind": "key"
  },
  {
    "id": "K15",
    "name": "“第二版PCB”",
    "group": "电控传感与交互",
    "check": "名称与版本待核，不能默认是独立物料",
    "sourceTime": "18:38",
    "kind": "key"
  },
  {
    "id": "K16",
    "name": "连接板",
    "group": "电控传感与交互",
    "check": "核对是否PCB、具体板号及版本",
    "sourceTime": "19:23",
    "kind": "key"
  },
  {
    "id": "K17",
    "name": "传感器",
    "group": "电控传感与交互",
    "check": "具体类型及料号待核；25:21转写“无压传感器”保留核对",
    "sourceTime": "12:21／25:21",
    "kind": "key"
  },
  {
    "id": "K18",
    "name": "风扇",
    "group": "动力供电与耗材",
    "check": "按电压、尺寸等实际规格展开料号",
    "sourceTime": "18:38",
    "kind": "key"
  },
  {
    "id": "K19",
    "name": "车充",
    "group": "动力供电与耗材",
    "check": "按适用产品与电气规格展开料号",
    "sourceTime": "18:38",
    "kind": "key"
  },
  {
    "id": "K20",
    "name": "适配器",
    "group": "动力供电与耗材",
    "check": "核对规格、插头版本及适用产品",
    "sourceTime": "18:38",
    "kind": "key"
  },
  {
    "id": "K21",
    "name": "“704”电池",
    "group": "动力供电与耗材",
    "check": "口述型号待核，不能作为正式型号直接入主数据",
    "sourceTime": "18:38",
    "kind": "key"
  },
  {
    "id": "K22",
    "name": "“408”电池",
    "group": "动力供电与耗材",
    "check": "口述型号待核，不能作为正式型号直接入主数据",
    "sourceTime": "18:38",
    "kind": "key"
  },
  {
    "id": "K23",
    "name": "显示屏",
    "group": "电控传感与交互",
    "check": "按尺寸、接口与版本展开料号",
    "sourceTime": "19:23",
    "kind": "key"
  },
  {
    "id": "K24",
    "name": "屏保玻璃组件",
    "group": "电控传感与交互",
    "check": "核对正式名称、规格及组件边界",
    "sourceTime": "19:23",
    "kind": "key"
  },
  {
    "id": "K25",
    "name": "按键",
    "group": "电控传感与交互",
    "check": "按形态、材质、颜色及版本展开料号",
    "sourceTime": "19:23",
    "kind": "key"
  },
  {
    "id": "K26",
    "name": "“金色包”",
    "group": "包材与附件",
    "check": "名称待核；不自行改为其他包类名称",
    "sourceTime": "18:38",
    "kind": "key"
  },
  {
    "id": "K27",
    "name": "拼色皮包",
    "group": "包材与附件",
    "check": "核对正式名称与颜色、规格版本",
    "sourceTime": "18:38",
    "kind": "key"
  },
  {
    "id": "K28",
    "name": "背带",
    "group": "包材与附件",
    "check": "核对配套包型、规格及正式料号",
    "sourceTime": "19:23",
    "kind": "key"
  },
  {
    "id": "K29",
    "name": "网格包",
    "group": "包材与附件",
    "check": "原话“网格包不需要？”；保留候选，是否纳入由业务确认",
    "sourceTime": "18:38",
    "kind": "candidate"
  },
  {
    "id": "K30",
    "name": "其他塑料件",
    "group": "ERP明细补全",
    "check": "导入ERP全部在管塑料件明细并关联适用BOM；去除与K03—K05重复的正式料号",
    "sourceTime": "19:23",
    "kind": "range"
  },
  {
    "id": "K31",
    "name": "其他硅胶件",
    "group": "ERP明细补全",
    "check": "导入ERP全部在管硅胶件明细并关联适用BOM；不得以一个分类标签代替明细",
    "sourceTime": "19:23",
    "kind": "range"
  }
] as const;
