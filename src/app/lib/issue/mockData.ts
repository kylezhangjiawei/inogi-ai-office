/**
 * 问题记录与 AI 定位模块 — 种子数据（便携制氧机 受监管 研发/生产场景）。
 *
 * 覆盖目标（供 UI 演示用）：
 *  - 5 种状态齐全：≥2 pending（无分析、无采纳）、1 analyzing、1 adjusting、若干 adopted、若干 archived；
 *  - 全部严重度、两种来源（rd/production）、≥4 个不同 product；
 *  - 每条 issue 都有 keywords（中文，用于相似度检索）；
 *  - 已分析问题的 causes 跨越 6M 全维度（人/机/料/法/环/测），且部分维度具体根因 ≥6 个，
 *    以便 DimensionStat 下钻能展示 Top-N + 低频长尾；
 *  - adopted 问题指向真实 cause/solution，且对应 AnalysisVersion.isAdopted=true；
 *  - ≥1 archived 问题以 { kind:'reuse', reusedFrom } 复用历史方案；
 *  - 部分问题带 attachments.extractedText（让 AI 输入有意义）。
 *
 * 注意：脚本不能调用 Date.now()/new Date()，时间戳一律使用字面量 ISO 字符串。
 */
import type { Issue } from "./types";

export const SEED_ISSUES: Issue[] = [
  // ── 1. pending（无分析、无采纳）──────────────────────────────────────────────
  {
    id: "NCR-2406-001",
    title: "氧立得 P1 制氧浓度不达标，出口浓度跌至 78%",
    description:
      "整机老化测试 30 分钟后，出口氧浓度由 93% 逐步下滑至 78%，低于 ≥90% 的放行标准。流量设定 3L/min，环境温度 26℃。怀疑分子筛或气路存在问题。",
    source: "rd",
    product: "氧立得 P1",
    batch: "P1-2406-A",
    station: "整机老化工位",
    severity: "fatal",
    defectRate: "12%",
    status: "pending",
    keywords: ["制氧浓度", "浓度不达标", "氧浓度", "分子筛", "气路", "老化测试", "流量"],
    createdBy: "李建国",
    createdAt: "2026-06-18T09:12:00+08:00",
    updatedAt: "2026-06-18T09:12:00+08:00",
    attachments: [
      {
        id: "att-001-1",
        fileName: "P1老化浓度曲线.xlsx",
        fileUrl: "/mock/files/P1-oxygen-curve.xlsx",
        fileType: "xlsx",
        extractedText:
          "时间(min),出口氧浓度(%)\n0,93.2\n5,91.8\n10,89.5\n15,86.1\n20,82.7\n25,80.0\n30,78.4\n备注：环境温度26℃，流量3L/min，第18分钟起浓度加速下滑。",
        uploadedBy: "李建国",
        uploadedAt: "2026-06-18T09:12:00+08:00",
      },
    ],
    analyses: [],
    messages: [],
  },

  // ── 2. pending（无分析）─────────────────────────────────────────────────────
  {
    id: "NCR-2406-002",
    title: "氧立得 Pro 运行噪音超标，1 米处达 52dB(A)",
    description:
      "样机运行噪音在 1 米处实测 52dB(A)，超过 ≤45dB(A) 的设计目标。主观听感为低频嗡鸣，疑似压缩机减振或风道共振。",
    source: "rd",
    product: "氧立得 Pro",
    batch: "PRO-2405-EVT",
    station: "声学暗室",
    severity: "major",
    defectRate: "—",
    status: "pending",
    keywords: ["噪音", "噪音超标", "分贝", "压缩机", "减振", "共振", "风道", "嗡鸣"],
    createdBy: "王敏",
    createdAt: "2026-06-15T14:30:00+08:00",
    updatedAt: "2026-06-15T14:30:00+08:00",
    attachments: [],
    analyses: [],
    messages: [],
  },

  // ── 3. analyzing（有一版分析，未采纳）────────────────────────────────────────
  {
    id: "NCR-2406-003",
    title: "电磁阀漏气导致氧立得 P1 富氧无法切换",
    description:
      "PSA 切换阀在换向瞬间出现漏气声，富氧产气流量波动大。气密测试发现 2 号电磁阀阀口存在 8kPa/min 的泄漏。",
    source: "production",
    product: "氧立得 P1",
    batch: "P1-2406-B",
    station: "气密检测工位",
    severity: "major",
    defectRate: "5.6%",
    status: "analyzing",
    keywords: ["电磁阀", "漏气", "气密", "泄漏", "PSA", "切换阀", "换向", "密封"],
    createdBy: "赵强",
    createdAt: "2026-06-12T10:05:00+08:00",
    updatedAt: "2026-06-12T11:20:00+08:00",
    attachments: [
      {
        id: "att-003-1",
        fileName: "气密测试报告.pdf",
        fileUrl: "/mock/files/airtight-report.pdf",
        fileType: "pdf",
        extractedText:
          "气密测试报告：测试压力 200kPa，保压 60s。2号电磁阀阀口泄漏率 8.0kPa/min，超过 ≤2kPa/min 限值。1号、3号阀正常。密封圈批次 SEAL-2405。",
        uploadedBy: "赵强",
        uploadedAt: "2026-06-12T10:05:00+08:00",
      },
    ],
    analyses: [
      {
        id: "av-003-1",
        version: 1,
        triggerType: "initial",
        model: "gpt-4o-mock",
        createdBy: "system",
        createdAt: "2026-06-12T11:20:00+08:00",
        isAdopted: false,
        summary: "最可能为电磁阀密封圈批次不良（料），其次为阀体装配扭矩偏差（法）；建议先复测密封圈硬度再核对装配扭矩。",
        content: {
          summary: "最可能为电磁阀密封圈批次不良（料），其次为阀体装配扭矩偏差（法）；建议先复测密封圈硬度再核对装配扭矩。",
          referencedCases: [],
          possibleCauses: [
            {
              id: "pc-003-1-1",
              cause: "电磁阀密封圈批次不良",
              dimension: "料",
              likelihood: "high",
              evidence: "泄漏集中在 SEAL-2405 批次密封圈，硬度抽检偏低，疑供应商混料。",
              solutions: [
                { id: "sol-003-1-1-1", action: "隔离 SEAL-2405 批次密封圈并全检硬度", type: "contain", owner: "质量工程师" },
                { id: "sol-003-1-1-2", action: "更换合格批次密封圈并要求供应商提供材质证明", type: "correct", owner: "采购/SQE" },
              ],
            },
            {
              id: "pc-003-1-2",
              cause: "阀体装配扭矩偏差",
              dimension: "法",
              likelihood: "medium",
              evidence: "气密不良工位与扭矩枪标定到期时间重叠，扭矩一致性存疑。",
              solutions: [
                { id: "sol-003-1-2-1", action: "重新标定扭矩枪并复测装配扭矩", type: "correct", owner: "工艺工程师" },
              ],
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "msg-003-1",
        seq: 1,
        role: "assistant",
        content: "已生成初版根因分析，最可能方向为密封圈批次不良（料）。",
        analysisVersionId: "av-003-1",
        createdAt: "2026-06-12T11:20:00+08:00",
      },
    ],
  },

  // ── 4. adjusting（两版分析，对话调整过）─────────────────────────────────────
  {
    id: "NCR-2406-004",
    title: "压缩机 CP-200 连续运行 2 小时后过热停机",
    description:
      "压缩机 CP-200 在 35℃ 环境连续运行约 120 分钟后触发过温保护停机，缸体表面温度超 95℃。怀疑散热或润滑问题。",
    source: "rd",
    product: "压缩机 CP-200",
    batch: "CP200-2405-T",
    station: "可靠性测试台",
    severity: "fatal",
    defectRate: "—",
    status: "adjusting",
    keywords: ["压缩机", "过热", "过温", "停机", "散热", "润滑", "高温", "可靠性"],
    createdBy: "陈伟",
    createdAt: "2026-06-08T08:40:00+08:00",
    updatedAt: "2026-06-09T16:00:00+08:00",
    attachments: [],
    analyses: [
      {
        id: "av-004-1",
        version: 1,
        triggerType: "initial",
        model: "gpt-4o-mock",
        createdBy: "system",
        createdAt: "2026-06-08T09:10:00+08:00",
        isAdopted: false,
        summary: "最可能为散热风道设计风量不足（法），其次为高温环境叠加（环）；建议先核风量再做高低温对照。",
        content: {
          summary: "最可能为散热风道设计风量不足（法），其次为高温环境叠加（环）；建议先核风量再做高低温对照。",
          referencedCases: [],
          possibleCauses: [
            {
              id: "pc-004-1-1",
              cause: "散热风道风量不足",
              dimension: "法",
              likelihood: "high",
              evidence: "风道截面较紧，热成像显示缸体背风侧热积聚明显。",
              solutions: [
                { id: "sol-004-1-1-1", action: "临时加装外置导流罩观察温降", type: "contain", owner: "结构工程师" },
                { id: "sol-004-1-1-2", action: "优化风道截面并提升风扇转速曲线", type: "correct", owner: "结构工程师" },
              ],
            },
            {
              id: "pc-004-1-2",
              cause: "高温环境叠加散热裕量不足",
              dimension: "环",
              likelihood: "medium",
              evidence: "35℃ 环境下停机，常温 25℃ 未复现。",
              solutions: [
                { id: "sol-004-1-2-1", action: "做 25/35/40℃ 高低温对照测试确认裕量", type: "correct", owner: "可靠性工程师" },
              ],
            },
          ],
        },
      },
      {
        id: "av-004-2",
        version: 2,
        triggerType: "adjustment",
        basedOnVersion: 1,
        model: "gpt-4o-mock",
        createdBy: "system",
        createdAt: "2026-06-09T16:00:00+08:00",
        isAdopted: false,
        summary: "补充润滑脂耐温不足（料）的怀疑方向；综合判断先核风道风量，再排查润滑脂规格与高温裕量。",
        content: {
          summary: "补充润滑脂耐温不足（料）的怀疑方向；综合判断先核风道风量，再排查润滑脂规格与高温裕量。",
          referencedCases: [],
          possibleCauses: [
            {
              id: "pc-004-2-1",
              cause: "散热风道风量不足",
              dimension: "法",
              likelihood: "high",
              evidence: "风道截面较紧，热成像显示缸体背风侧热积聚明显，加导流罩后温降约 6℃。",
              solutions: [
                { id: "sol-004-2-1-1", action: "临时加装外置导流罩观察温降", type: "contain", owner: "结构工程师" },
                { id: "sol-004-2-1-2", action: "优化风道截面并提升风扇转速曲线", type: "correct", owner: "结构工程师" },
              ],
            },
            {
              id: "pc-004-2-2",
              cause: "润滑脂耐温等级不足",
              dimension: "料",
              likelihood: "medium",
              evidence: "依据现场反馈，停机后缸体润滑脂出现轻微碳化，疑选用了耐温偏低的脂。",
              solutions: [
                { id: "sol-004-2-2-1", action: "改用高温润滑脂并复测连续运行温升", type: "correct", owner: "工艺工程师" },
                { id: "sol-004-2-2-2", action: "在 BOM 与采购规格中锁定耐温等级要求", type: "prevent", owner: "研发/采购" },
              ],
            },
            {
              id: "pc-004-2-3",
              cause: "高温环境叠加散热裕量不足",
              dimension: "环",
              likelihood: "medium",
              evidence: "35℃ 环境下停机，常温 25℃ 未复现。",
              solutions: [
                { id: "sol-004-2-3-1", action: "做 25/35/40℃ 高低温对照测试确认裕量", type: "correct", owner: "可靠性工程师" },
              ],
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "msg-004-1",
        seq: 1,
        role: "assistant",
        content: "已生成初版根因分析，最可能方向为散热风道风量不足（法）。",
        analysisVersionId: "av-004-1",
        createdAt: "2026-06-08T09:10:00+08:00",
      },
      {
        id: "msg-004-2",
        seq: 2,
        role: "user",
        content: "现场拆机发现润滑脂有碳化迹象，请把润滑脂耐温的方向也考虑进去。",
        operator: "陈伟",
        createdAt: "2026-06-09T15:50:00+08:00",
      },
      {
        id: "msg-004-3",
        seq: 3,
        role: "assistant",
        content: "已补充「润滑脂耐温等级不足（料）」方向并更新分析版本。",
        analysisVersionId: "av-004-2",
        createdAt: "2026-06-09T16:00:00+08:00",
      },
    ],
  },

  // ── 5. adopted（采纳 analysis 里的方案）─────────────────────────────────────
  {
    id: "NCR-2406-005",
    title: "分子筛模块 MS-3 寿命衰减，2000 小时后浓度骤降",
    description:
      "分子筛模块 MS-3 在加速寿命试验 2000 小时后，出口浓度由 94% 降至 85%。拆解发现分子筛粉化、吸附能力下降。",
    source: "rd",
    product: "molecular sieve module MS-3",
    batch: "MS3-2403-LF",
    station: "寿命试验台",
    severity: "fatal",
    defectRate: "—",
    status: "adopted",
    keywords: ["分子筛", "分子筛失效", "寿命", "衰减", "粉化", "吸附", "浓度", "干燥"],
    createdBy: "孙磊",
    createdAt: "2026-04-10T09:00:00+08:00",
    updatedAt: "2026-04-22T17:30:00+08:00",
    adopted: { kind: "analysis", causeId: "pc-005-1-1", solutionId: "sol-005-1-1-2" },
    attachments: [
      {
        id: "att-005-1",
        fileName: "MS-3寿命试验报告.pdf",
        fileUrl: "/mock/files/ms3-life-report.pdf",
        fileType: "pdf",
        extractedText:
          "MS-3 加速寿命试验：0h 浓度94.1%，500h 93.6%，1000h 92.0%，1500h 89.3%，2000h 85.2%。拆解：分子筛球出现粉化，进气含水量偏高，疑干燥不充分。",
        uploadedBy: "孙磊",
        uploadedAt: "2026-04-10T09:00:00+08:00",
      },
    ],
    analyses: [
      {
        id: "av-005-1",
        version: 1,
        triggerType: "initial",
        model: "gpt-4o-mock",
        createdBy: "system",
        createdAt: "2026-04-11T10:00:00+08:00",
        isAdopted: true,
        summary: "最可能为进气干燥不充分导致分子筛受潮粉化（法），其次为分子筛物料吸附等级偏低（料）；建议先核干燥流程。",
        content: {
          summary: "最可能为进气干燥不充分导致分子筛受潮粉化（法），其次为分子筛物料吸附等级偏低（料）；建议先核干燥流程。",
          referencedCases: [],
          possibleCauses: [
            {
              id: "pc-005-1-1",
              cause: "进气干燥不充分导致分子筛受潮粉化",
              dimension: "法",
              likelihood: "high",
              evidence: "拆解发现含水量偏高，粉化集中在进气端，与干燥工艺直接相关。",
              solutions: [
                { id: "sol-005-1-1-1", action: "隔离受潮批次并复测当前在制品浓度", type: "contain", owner: "质量工程师" },
                { id: "sol-005-1-1-2", action: "前置增设干燥过滤并固化干燥工艺参数", type: "correct", owner: "工艺工程师" },
                { id: "sol-005-1-1-3", action: "在工艺文件中增加进气露点点检项", type: "prevent", owner: "工艺工程师" },
              ],
            },
            {
              id: "pc-005-1-2",
              cause: "分子筛吸附等级偏低",
              dimension: "料",
              likelihood: "medium",
              evidence: "MS3-2403-LF 批次吸附指标处于规格下限。",
              solutions: [
                { id: "sol-005-1-2-1", action: "提高分子筛进料吸附指标验收标准", type: "prevent", owner: "SQE" },
              ],
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "msg-005-1",
        seq: 1,
        role: "assistant",
        content: "已生成根因分析，最可能为进气干燥不充分（法）。",
        analysisVersionId: "av-005-1",
        createdAt: "2026-04-11T10:00:00+08:00",
      },
      {
        id: "msg-005-2",
        seq: 2,
        role: "user",
        content: "工艺侧已验证增设干燥过滤后 2000h 浓度保持 92% 以上，采纳此方案。",
        operator: "孙磊",
        createdAt: "2026-04-22T17:30:00+08:00",
      },
      {
        id: "msg-005-3",
        seq: 3,
        role: "assistant",
        content: "已采纳方案：前置增设干燥过滤并固化干燥工艺参数（长期纠正）。",
        analysisVersionId: "av-005-1",
        createdAt: "2026-04-22T17:30:00+08:00",
      },
    ],
  },

  // ── 6. adopted（生产侧，人因为主）───────────────────────────────────────────
  {
    id: "NCR-2406-006",
    title: "PCBA 焊点虚焊导致氧立得 Pro 间歇性死机",
    description:
      "氧立得 Pro 主控板出现间歇性死机，振动复测后死机率上升。X-Ray 显示主控芯片旁电源滤波焊点存在虚焊。",
    source: "production",
    product: "氧立得 Pro",
    batch: "PRO-2404-M2",
    station: "SMT 回流焊后 AOI",
    severity: "major",
    defectRate: "2.8%",
    status: "adopted",
    keywords: ["PCBA", "虚焊", "焊点", "死机", "回流焊", "AOI", "SMT", "锡膏", "X-Ray"],
    createdBy: "周婷",
    createdAt: "2026-05-02T13:20:00+08:00",
    updatedAt: "2026-05-09T11:00:00+08:00",
    adopted: { kind: "analysis", causeId: "pc-006-1-1", solutionId: "sol-006-1-1-2" },
    attachments: [],
    analyses: [
      {
        id: "av-006-1",
        version: 1,
        triggerType: "initial",
        model: "gpt-4o-mock",
        createdBy: "system",
        createdAt: "2026-05-02T14:00:00+08:00",
        isAdopted: true,
        summary: "最可能为回流焊温度曲线偏离致虚焊（机），其次为锡膏印刷量不足（法）；建议先核温度曲线与 SPI 数据。",
        content: {
          summary: "最可能为回流焊温度曲线偏离致虚焊（机），其次为锡膏印刷量不足（法）；建议先核温度曲线与 SPI 数据。",
          referencedCases: [],
          possibleCauses: [
            {
              id: "pc-006-1-1",
              cause: "回流焊温度曲线偏离",
              dimension: "机",
              likelihood: "high",
              evidence: "虚焊集中在大热容电源区，疑回流峰值温度不足、热量不够。",
              solutions: [
                { id: "sol-006-1-1-1", action: "停线复核并重打回流炉温曲线", type: "contain", owner: "SMT 工程师" },
                { id: "sol-006-1-1-2", action: "针对大热容区优化回流温区设定并固化炉温档案", type: "correct", owner: "SMT 工程师" },
                { id: "sol-006-1-1-3", action: "建立每班炉温曲线点检与 SPC 监控", type: "prevent", owner: "工艺工程师" },
              ],
            },
            {
              id: "pc-006-1-2",
              cause: "锡膏印刷量不足",
              dimension: "法",
              likelihood: "medium",
              evidence: "SPI 数据显示对应焊盘锡量处于下限。",
              solutions: [
                { id: "sol-006-1-2-1", action: "调整钢网开孔并复核 SPI 锡量", type: "correct", owner: "工艺工程师" },
              ],
            },
            {
              id: "pc-006-1-3",
              cause: "操作员手工补焊不规范",
              dimension: "人",
              likelihood: "low",
              evidence: "部分返修板由不同操作员手补，工艺一致性不足。",
              solutions: [
                { id: "sol-006-1-3-1", action: "开展焊接作业再培训并增加首件确认", type: "prevent", owner: "产线班长" },
              ],
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "msg-006-1",
        seq: 1,
        role: "assistant",
        content: "已生成根因分析，最可能为回流焊温度曲线偏离（机）。",
        analysisVersionId: "av-006-1",
        createdAt: "2026-05-02T14:00:00+08:00",
      },
      {
        id: "msg-006-2",
        seq: 2,
        role: "user",
        content: "重打炉温曲线后连续 3 批 AOI 无虚焊，采纳优化温区方案。",
        operator: "周婷",
        createdAt: "2026-05-09T11:00:00+08:00",
      },
      {
        id: "msg-006-3",
        seq: 3,
        role: "assistant",
        content: "已采纳方案：针对大热容区优化回流温区设定并固化炉温档案（长期纠正）。",
        analysisVersionId: "av-006-1",
        createdAt: "2026-05-09T11:00:00+08:00",
      },
    ],
  },

  // ── 7. adopted（流量传感器漂移，测维度为主）─────────────────────────────────
  {
    id: "NCR-2406-007",
    title: "氧立得 P1 流量传感器读数漂移，显示与实测偏差 0.6L/min",
    description:
      "整机显示流量与标准流量计实测偏差达 0.6L/min，超过 ±0.2L/min 容差。多台样机方向一致偏高，疑传感器或标定问题。",
    source: "production",
    product: "氧立得 P1",
    batch: "P1-2405-C",
    station: "流量标定工位",
    severity: "normal",
    defectRate: "7.1%",
    status: "adopted",
    keywords: ["流量传感器", "漂移", "标定", "流量", "偏差", "校准", "传感器", "测量"],
    createdBy: "吴芳",
    createdAt: "2026-05-15T10:30:00+08:00",
    updatedAt: "2026-05-20T15:00:00+08:00",
    adopted: { kind: "analysis", causeId: "pc-007-1-1", solutionId: "sol-007-1-1-2" },
    attachments: [],
    analyses: [
      {
        id: "av-007-1",
        version: 1,
        triggerType: "initial",
        model: "gpt-4o-mock",
        createdBy: "system",
        createdAt: "2026-05-15T11:00:00+08:00",
        isAdopted: true,
        summary: "最可能为标定基准流量计漂移未及时校准（测），其次为传感器批次零点偏移（料）；建议先校准基准设备再复测。",
        content: {
          summary: "最可能为标定基准流量计漂移未及时校准（测），其次为传感器批次零点偏移（料）；建议先校准基准设备再复测。",
          referencedCases: [],
          possibleCauses: [
            {
              id: "pc-007-1-1",
              cause: "标定基准流量计漂移未及时校准",
              dimension: "测",
              likelihood: "high",
              evidence: "多台样机方向一致偏高，强烈指向标定基准本身偏移。",
              solutions: [
                { id: "sol-007-1-1-1", action: "暂停流量标定并送检基准流量计", type: "contain", owner: "计量员" },
                { id: "sol-007-1-1-2", action: "校准基准流量计并重做受影响批次标定", type: "correct", owner: "计量/工艺" },
                { id: "sol-007-1-1-3", action: "建立基准设备周期校准与到期提醒", type: "prevent", owner: "计量室" },
              ],
            },
            {
              id: "pc-007-1-2",
              cause: "流量传感器批次零点偏移",
              dimension: "料",
              likelihood: "low",
              evidence: "新批次传感器零点抽检略偏，但偏差量不足以解释 0.6L/min。",
              solutions: [
                { id: "sol-007-1-2-1", action: "对新批次传感器增加零点抽检", type: "prevent", owner: "SQE" },
              ],
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "msg-007-1",
        seq: 1,
        role: "assistant",
        content: "已生成根因分析，最可能为标定基准流量计漂移（测）。",
        analysisVersionId: "av-007-1",
        createdAt: "2026-05-15T11:00:00+08:00",
      },
      {
        id: "msg-007-2",
        seq: 2,
        role: "user",
        content: "送检确认基准流量计偏移，校准后重标已合格，采纳此方案。",
        operator: "吴芳",
        createdAt: "2026-05-20T15:00:00+08:00",
      },
      {
        id: "msg-007-3",
        seq: 3,
        role: "assistant",
        content: "已采纳方案：校准基准流量计并重做受影响批次标定（长期纠正）。",
        analysisVersionId: "av-007-1",
        createdAt: "2026-05-20T15:00:00+08:00",
      },
    ],
  },

  // ── 8. adopted（外壳缩水，料/法）────────────────────────────────────────────
  {
    id: "NCR-2406-008",
    title: "氧立得 Pro 外壳注塑缩水，装配面出现明显凹陷",
    description:
      "上盖外壳厚壁区出现缩水凹陷，影响装配平整度与外观。缩水位置稳定，疑保压不足或壁厚设计不均。",
    source: "production",
    product: "氧立得 Pro",
    batch: "PRO-2404-INJ",
    station: "注塑成型",
    severity: "minor",
    defectRate: "9.4%",
    status: "adopted",
    keywords: ["外壳", "缩水", "注塑", "凹陷", "保压", "壁厚", "成型", "模具"],
    createdBy: "郑浩",
    createdAt: "2026-05-25T09:40:00+08:00",
    updatedAt: "2026-05-30T16:20:00+08:00",
    adopted: { kind: "analysis", causeId: "pc-008-1-1", solutionId: "sol-008-1-1-1" },
    attachments: [],
    analyses: [
      {
        id: "av-008-1",
        version: 1,
        triggerType: "initial",
        model: "gpt-4o-mock",
        createdBy: "system",
        createdAt: "2026-05-25T10:10:00+08:00",
        isAdopted: true,
        summary: "最可能为注塑保压压力/时间不足（法），其次为厚壁区设计壁厚不均（法）；建议先调保压工艺再评估壁厚优化。",
        content: {
          summary: "最可能为注塑保压压力/时间不足（法），其次为厚壁区设计壁厚不均（法）；建议先调保压工艺再评估壁厚优化。",
          referencedCases: [],
          possibleCauses: [
            {
              id: "pc-008-1-1",
              cause: "注塑保压压力与保压时间不足",
              dimension: "法",
              likelihood: "high",
              evidence: "缩水位置固定于厚壁区，典型保压不足特征。",
              solutions: [
                { id: "sol-008-1-1-1", action: "优化保压曲线（提高保压压力并延长保压时间）", type: "correct", owner: "注塑工程师" },
                { id: "sol-008-1-1-2", action: "建立注塑工艺参数档案与首件确认", type: "prevent", owner: "工艺工程师" },
              ],
            },
            {
              id: "pc-008-1-2",
              cause: "厚壁区设计壁厚不均",
              dimension: "法",
              likelihood: "medium",
              evidence: "厚壁区与相邻薄壁差异较大，易产生收缩差。",
              solutions: [
                { id: "sol-008-1-2-1", action: "结构侧评估减薄/掏胶以均化壁厚", type: "correct", owner: "结构工程师" },
              ],
            },
            {
              id: "pc-008-1-3",
              cause: "原料干燥不足含水偏高",
              dimension: "料",
              likelihood: "low",
              evidence: "塑料粒干燥记录偶有缺失，但缩水位置规律性更像工艺问题。",
              solutions: [
                { id: "sol-008-1-3-1", action: "规范原料干燥并记录露点", type: "prevent", owner: "注塑班长" },
              ],
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "msg-008-1",
        seq: 1,
        role: "assistant",
        content: "已生成根因分析，最可能为保压不足（法）。",
        analysisVersionId: "av-008-1",
        createdAt: "2026-05-25T10:10:00+08:00",
      },
      {
        id: "msg-008-2",
        seq: 2,
        role: "user",
        content: "调整保压曲线后缩水消失，采纳优化保压方案。",
        operator: "郑浩",
        createdAt: "2026-05-30T16:20:00+08:00",
      },
      {
        id: "msg-008-3",
        seq: 3,
        role: "assistant",
        content: "已采纳方案：优化保压曲线（提高保压压力并延长保压时间）（长期纠正）。",
        analysisVersionId: "av-008-1",
        createdAt: "2026-05-30T16:20:00+08:00",
      },
    ],
  },

  // ── 9. archived（kind: analysis，已归档沉淀）─────────────────────────────────
  {
    id: "NCR-2406-009",
    title: "氧立得 P1 锂电续航不达标，满电运行不足 3 小时",
    description:
      "便携模式满电续航实测 2.6 小时，低于 ≥4 小时目标。多台一致偏低，疑电芯容量或整机功耗问题。",
    source: "rd",
    product: "氧立得 P1",
    batch: "P1-2404-BAT",
    station: "续航测试台",
    severity: "major",
    defectRate: "—",
    status: "archived",
    keywords: ["锂电", "续航", "电池", "电芯", "容量", "功耗", "便携", "放电"],
    createdBy: "刘洋",
    createdAt: "2026-04-18T09:00:00+08:00",
    updatedAt: "2026-04-28T18:00:00+08:00",
    adopted: { kind: "analysis", causeId: "pc-009-1-2", solutionId: "sol-009-1-2-1" },
    attachments: [],
    analyses: [
      {
        id: "av-009-1",
        version: 1,
        triggerType: "initial",
        model: "gpt-4o-mock",
        createdBy: "system",
        createdAt: "2026-04-18T09:40:00+08:00",
        isAdopted: true,
        summary: "最可能为电芯实际容量低于标称（料），其次为整机静态功耗偏高（机）；建议先核电芯容量再测功耗。",
        content: {
          summary: "最可能为电芯实际容量低于标称（料），其次为整机静态功耗偏高（机）；建议先核电芯容量再测功耗。",
          referencedCases: [],
          possibleCauses: [
            {
              id: "pc-009-1-1",
              cause: "整机静态/工作功耗偏高",
              dimension: "机",
              likelihood: "medium",
              evidence: "主控待机电流偏大，疑外设未进入低功耗。",
              solutions: [
                { id: "sol-009-1-1-1", action: "排查外设低功耗策略并优化固件功耗", type: "correct", owner: "嵌入式工程师" },
              ],
            },
            {
              id: "pc-009-1-2",
              cause: "电芯实际容量低于标称",
              dimension: "料",
              likelihood: "high",
              evidence: "电芯放电测试容量为标称的 88%，批次一致偏低。",
              solutions: [
                { id: "sol-009-1-2-1", action: "更换合格电芯供应商并按容量分档来料检验", type: "correct", owner: "SQE" },
                { id: "sol-009-1-2-2", action: "增加电芯容量来料抽检与放电校验", type: "prevent", owner: "IQC" },
              ],
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "msg-009-1",
        seq: 1,
        role: "assistant",
        content: "已生成根因分析，最可能为电芯容量低于标称（料）。",
        analysisVersionId: "av-009-1",
        createdAt: "2026-04-18T09:40:00+08:00",
      },
      {
        id: "msg-009-2",
        seq: 2,
        role: "user",
        content: "换合格电芯后续航达 4.2 小时，问题闭环，归档沉淀。",
        operator: "刘洋",
        createdAt: "2026-04-28T18:00:00+08:00",
      },
      {
        id: "msg-009-3",
        seq: 3,
        role: "assistant",
        content: "已采纳方案：更换合格电芯供应商并按容量分档来料检验（长期纠正）。问题已归档。",
        analysisVersionId: "av-009-1",
        createdAt: "2026-04-28T18:00:00+08:00",
      },
    ],
  },

  // ── 10. archived（kind: reuse，复用历史方案）────────────────────────────────
  {
    id: "NCR-2406-010",
    title: "molecular sieve module MS-3 新产线浓度衰减复现",
    description:
      "MS-3 转入新产线后，1800 小时浓度衰减问题复现，拆解同样发现进气端粉化受潮。与 NCR-2406-005 现象高度一致。",
    source: "production",
    product: "molecular sieve module MS-3",
    batch: "MS3-2406-NL",
    station: "寿命试验台",
    severity: "major",
    defectRate: "—",
    status: "archived",
    keywords: ["分子筛", "粉化", "受潮", "浓度", "衰减", "干燥", "寿命", "吸附"],
    createdBy: "孙磊",
    createdAt: "2026-06-05T10:00:00+08:00",
    updatedAt: "2026-06-06T14:00:00+08:00",
    adopted: { kind: "reuse", reusedFrom: "NCR-2406-005" },
    attachments: [],
    analyses: [],
    messages: [
      {
        id: "msg-010-1",
        seq: 1,
        role: "user",
        content: "现象与历史问题一致，直接复用既有方案。",
        operator: "孙磊",
        createdAt: "2026-06-06T14:00:00+08:00",
      },
      {
        id: "msg-010-2",
        seq: 2,
        role: "assistant",
        content: "复用自 NCR-2406-005：前置增设干燥过滤并固化干燥工艺参数（长期纠正）。问题已归档。",
        createdAt: "2026-06-06T14:00:00+08:00",
      },
    ],
  },

  // ── 11. archived（kind: analysis，环境维度，长尾补充）───────────────────────
  {
    id: "NCR-2406-011",
    title: "氧立得 Pro 高湿环境下触摸屏误触与凝露",
    description:
      "在 85% RH 高湿环境下整机面板出现凝露，触摸屏偶发误触。常湿环境未复现，疑环境湿度与密封问题。",
    source: "rd",
    product: "氧立得 Pro",
    batch: "PRO-2404-ENV",
    station: "恒温恒湿箱",
    severity: "normal",
    defectRate: "—",
    status: "archived",
    keywords: ["高湿", "凝露", "触摸屏", "误触", "湿度", "密封", "环境", "防潮"],
    createdBy: "王敏",
    createdAt: "2026-04-25T13:00:00+08:00",
    updatedAt: "2026-05-04T10:30:00+08:00",
    adopted: { kind: "analysis", causeId: "pc-011-1-1", solutionId: "sol-011-1-1-2" },
    attachments: [],
    analyses: [
      {
        id: "av-011-1",
        version: 1,
        triggerType: "initial",
        model: "gpt-4o-mock",
        createdBy: "system",
        createdAt: "2026-04-25T13:40:00+08:00",
        isAdopted: true,
        summary: "最可能为高湿环境致面板凝露（环），其次为触摸屏防水阈值设置不当（测）；建议先做密封防潮再调触摸阈值。",
        content: {
          summary: "最可能为高湿环境致面板凝露（环），其次为触摸屏防水阈值设置不当（测）；建议先做密封防潮再调触摸阈值。",
          referencedCases: [],
          possibleCauses: [
            {
              id: "pc-011-1-1",
              cause: "高湿环境致面板内侧凝露",
              dimension: "环",
              likelihood: "high",
              evidence: "仅 85%RH 高湿复现，凝露出现在面板内侧温差区。",
              solutions: [
                { id: "sol-011-1-1-1", action: "临时增加面板防潮垫片观察凝露", type: "contain", owner: "结构工程师" },
                { id: "sol-011-1-1-2", action: "优化面板密封并增加防潮设计", type: "correct", owner: "结构工程师" },
                { id: "sol-011-1-1-3", action: "在环境规格中明确使用湿度上限与防潮要求", type: "prevent", owner: "研发" },
              ],
            },
            {
              id: "pc-011-1-2",
              cause: "触摸屏防水误触阈值不当",
              dimension: "测",
              likelihood: "medium",
              evidence: "凝露时电容值漂移，触摸判定阈值偏敏感。",
              solutions: [
                { id: "sol-011-1-2-1", action: "调整触摸检测阈值并增加防水误触算法", type: "correct", owner: "嵌入式工程师" },
              ],
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "msg-011-1",
        seq: 1,
        role: "assistant",
        content: "已生成根因分析，最可能为高湿环境致凝露（环）。",
        analysisVersionId: "av-011-1",
        createdAt: "2026-04-25T13:40:00+08:00",
      },
      {
        id: "msg-011-2",
        seq: 2,
        role: "user",
        content: "优化面板密封后高湿复测无凝露与误触，归档。",
        operator: "王敏",
        createdAt: "2026-05-04T10:30:00+08:00",
      },
      {
        id: "msg-011-3",
        seq: 3,
        role: "assistant",
        content: "已采纳方案：优化面板密封并增加防潮设计（长期纠正）。问题已归档。",
        analysisVersionId: "av-011-1",
        createdAt: "2026-05-04T10:30:00+08:00",
      },
    ],
  },

  // ── 12. adopted（人因培训为主，补「人」维度长尾）────────────────────────────
  {
    id: "NCR-2406-012",
    title: "氧立得 P1 整机装配漏装单向阀，导致富氧反流",
    description:
      "终检发现部分整机漏装进气单向阀，造成富氧气体反流、浓度不稳。漏装集中在某一班次，疑作业指导与防错缺失。",
    source: "production",
    product: "氧立得 P1",
    batch: "P1-2405-D",
    station: "整机装配工位",
    severity: "major",
    defectRate: "3.2%",
    status: "adopted",
    keywords: ["漏装", "单向阀", "装配", "反流", "防错", "作业指导", "防呆", "终检"],
    createdBy: "赵强",
    createdAt: "2026-05-28T08:50:00+08:00",
    updatedAt: "2026-06-02T17:00:00+08:00",
    adopted: { kind: "analysis", causeId: "pc-012-1-1", solutionId: "sol-012-1-1-2" },
    attachments: [],
    analyses: [
      {
        id: "av-012-1",
        version: 1,
        triggerType: "initial",
        model: "gpt-4o-mock",
        createdBy: "system",
        createdAt: "2026-05-28T09:30:00+08:00",
        isAdopted: true,
        summary: "最可能为装配工位缺防错致漏装（人），其次为作业指导书不清晰（法）；建议先加防错点检再完善 SOP。",
        content: {
          summary: "最可能为装配工位缺防错致漏装（人），其次为作业指导书不清晰（法）；建议先加防错点检再完善 SOP。",
          referencedCases: [],
          possibleCauses: [
            {
              id: "pc-012-1-1",
              cause: "装配工位缺乏防错措施致漏装单向阀",
              dimension: "人",
              likelihood: "high",
              evidence: "漏装集中在某班次，无防错与点检，依赖人工记忆。",
              solutions: [
                { id: "sol-012-1-1-1", action: "终检增加单向阀漏装专项全检（临时遏制）", type: "contain", owner: "终检班长" },
                { id: "sol-012-1-1-2", action: "增加单向阀防错治具与装配到位检测", type: "prevent", owner: "工艺工程师" },
              ],
            },
            {
              id: "pc-012-1-2",
              cause: "作业指导书对单向阀方向描述不清",
              dimension: "法",
              likelihood: "medium",
              evidence: "SOP 未图示单向阀方向，新员工易遗漏。",
              solutions: [
                { id: "sol-012-1-2-1", action: "完善 SOP 增加单向阀方向图示与首件确认", type: "correct", owner: "工艺工程师" },
              ],
            },
            {
              id: "pc-012-1-3",
              cause: "新员工培训不到位",
              dimension: "人",
              likelihood: "low",
              evidence: "漏装班次新员工占比较高。",
              solutions: [
                { id: "sol-012-1-3-1", action: "开展关键工序上岗考核与再培训", type: "prevent", owner: "产线主管" },
              ],
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "msg-012-1",
        seq: 1,
        role: "assistant",
        content: "已生成根因分析，最可能为装配工位缺防错（人）。",
        analysisVersionId: "av-012-1",
        createdAt: "2026-05-28T09:30:00+08:00",
      },
      {
        id: "msg-012-2",
        seq: 2,
        role: "user",
        content: "加装防错治具后连续两周零漏装，采纳防错方案。",
        operator: "赵强",
        createdAt: "2026-06-02T17:00:00+08:00",
      },
      {
        id: "msg-012-3",
        seq: 3,
        role: "assistant",
        content: "已采纳方案：增加单向阀防错治具与装配到位检测（预防）。",
        analysisVersionId: "av-012-1",
        createdAt: "2026-06-02T17:00:00+08:00",
      },
    ],
  },
];
