import React, { useMemo, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router";
import { ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock3, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

type MetricItem = { label: string; value: string; helper: string };
type ActionItem = { label: string; to: string };
type SectionConfig =
  | { type: "cards"; title: string; description: string; items: Array<{ title: string; subtitle: string; tag?: string }> }
  | { type: "table"; title: string; description: string; columns: string[]; rows: string[][] }
  | { type: "steps"; title: string; description: string; items: Array<{ title: string; detail: string; status: "done" | "current" | "pending" }> }
  | { type: "kanban"; title: string; description: string; columns: Array<{ title: string; tone: string; cards: Array<{ title: string; detail: string }> }> };

type ModuleConfig = {
  title: string;
  subtitle: string;
  badge: string;
  metrics: MetricItem[];
  actions: ActionItem[];
  sections: SectionConfig[];
};

const sectionPageSize = 2;

function matchesKeyword(keyword: string, values: string[]) {
  if (!keyword) return true;
  const text = values.join(" ").toLowerCase();
  return text.includes(keyword.toLowerCase());
}

function cycleStatus(status: "done" | "current" | "pending") {
  if (status === "pending") return "current";
  if (status === "current") return "done";
  return "pending";
}

export const moduleConfigs: Record<string, ModuleConfig> = {
  "rd-triage": {
    title: "研发问题分流",
    subtitle: "提交问题、AI 分类、任务池分流与历史方案复用。",
    badge: "Issue Triage",
    metrics: [
      { label: "待分类问题", value: "14", helper: "其中 4 条需紧急处理" },
      { label: "AI 命中率", value: "87%", helper: "历史方案可复用" },
      { label: "今日流转", value: "26", helper: "已进入任务池" },
    ],
    actions: [
      { label: "查看售后工单", to: "/after-sales" },
      { label: "打开法规知识库", to: "/ra-knowledge" },
    ],
    sections: [
      {
        type: "cards",
        title: "AI 分类结果",
        description: "自动识别问题归属、相似案例和建议流向。",
        items: [
          { title: "硬件类 / 92%", subtitle: "OC-10 主板异常，命中 2 条历史方案", tag: "Urgent" },
          { title: "软件类 / 81%", subtitle: "日志显示串口握手超时", tag: "Normal" },
          { title: "配置类 / 76%", subtitle: "客户参数模板缺失", tag: "Return" },
        ],
      },
      {
        type: "kanban",
        title: "任务池",
        description: "紧急队列与普通队列双泳道流转。",
        columns: [
          { title: "紧急队列", tone: "bg-red-50 text-red-700", cards: [{ title: "OC-10 启动异常", detail: "王工提交 / 10:30 / 硬件" }] },
          { title: "普通队列", tone: "bg-blue-50 text-blue-700", cards: [{ title: "固件版本兼容", detail: "李静提交 / 13:10 / 软件" }] },
        ],
      },
    ],
  },
  "registration-projects": {
    title: "注册项目里程碑",
    subtitle: "项目卡片、阶段进度、资料缺口和提醒日志统一查看。",
    badge: "Milestone",
    metrics: [
      { label: "在途项目", value: "8", helper: "FDA/CE/NMPA 混合推进" },
      { label: "超期提醒", value: "2", helper: "需本周跟进" },
      { label: "资料缺口", value: "11", helper: "自动生成清单" },
    ],
    actions: [
      { label: "查看质量 DMS", to: "/quality-dms" },
      { label: "打开报关单证", to: "/customs-ai" },
    ],
    sections: [
      {
        type: "cards",
        title: "项目卡片",
        description: "按市场类型区分颜色，并显示里程碑进度。",
        items: [
          { title: "OC-5 FDA 注册", subtitle: "当前阶段：审评反馈 / 负责人：韩青", tag: "FDA" },
          { title: "OC-10 CE 更新", subtitle: "当前阶段：资料提交 / 负责人：周宁", tag: "CE" },
          { title: "家庭版 NMPA", subtitle: "当前阶段：整改补充 / 负责人：刘晨", tag: "NMPA" },
        ],
      },
      {
        type: "steps",
        title: "阶段时间线",
        description: "所选项目的垂直里程碑进度。",
        items: [
          { title: "资料提交", detail: "2026-03-02 / 已完成", status: "done" },
          { title: "补充资料", detail: "2026-03-20 / 已完成", status: "done" },
          { title: "审评反馈", detail: "2026-04-10 / 当前进行中", status: "current" },
          { title: "整改闭环", detail: "待计划", status: "pending" },
        ],
      },
    ],
  },
  "bom-archive": {
    title: "硬件图纸与 BOM 确认存档",
    subtitle: "确认记录、审计轨迹、通知历史统一归档。",
    badge: "Archive",
    metrics: [
      { label: "已锁定记录", value: "32", helper: "不可删除，仅可留痕修改" },
      { label: "本月新增", value: "6", helper: "自动通知采购与生产" },
      { label: "待补充原因", value: "1", helper: "需补修改说明" },
    ],
    actions: [
      { label: "查看设计变更", to: "/design-changes" },
      { label: "返回首页", to: "/" },
    ],
    sections: [
      {
        type: "table",
        title: "确认记录列表",
        description: "按型号与版本检索 BOM 确认结果。",
        columns: ["版本号", "确认人", "确认日期", "摘要"],
        rows: [
          ["BOM-OC10-V3.2", "韩琪", "2026-04-08", "主板电阻替代料已确认"],
          ["BOM-OC5-V2.6", "李成", "2026-04-03", "传感器批次切换备案"],
        ],
      },
      {
        type: "steps",
        title: "不可变更审计链",
        description: "版本调整需要给出修改原因并留痕。",
        items: [
          { title: "原始记录创建", detail: "韩琪 / 2026-04-08 09:15", status: "done" },
          { title: "变更说明补录", detail: "李成 / 2026-04-09 14:22", status: "done" },
          { title: "采购通知下发", detail: "系统自动完成", status: "current" },
        ],
      },
    ],
  },
  "design-changes": {
    title: "设计开发变更记录",
    subtitle: "变更登记、影响评估与 DHF 文档预览。",
    badge: "DHF",
    metrics: [
      { label: "本月变更", value: "18", helper: "覆盖输入/输出/验证/评审" },
      { label: "已勾选生成", value: "5", helper: "可导出 Word / PDF" },
      { label: "高影响项", value: "3", helper: "需主管确认" },
    ],
    actions: [
      { label: "查看 BOM 存档", to: "/bom-archive" },
      { label: "查看合同审查", to: "/contract-review" },
    ],
    sections: [
      {
        type: "table",
        title: "变更记录清单",
        description: "支持按变更类型、日期范围、责任人筛选。",
        columns: ["日期", "变更人", "类型", "影响评估", "版本号"],
        rows: [
          ["2026-04-12", "王岚", "设计输入", "影响电源模块", "DHF-2.1"],
          ["2026-04-10", "陈序", "验证", "测试报告需更新", "VR-1.8"],
        ],
      },
      {
        type: "cards",
        title: "DHF 生成预览",
        description: "按勾选记录自动拼装封面、摘要表和详细记录。",
        items: [
          { title: "封面信息", subtitle: "项目、版本、审批人自动填充", tag: "Auto" },
          { title: "变更汇总表", subtitle: "按时间顺序输出 5 条记录", tag: "Word" },
        ],
      },
    ],
  },
  "customs-ai": {
    title: "报关单证 AI 提取与一致性校验",
    subtitle: "上传 PI / CI / PL 后自动抽取字段并比对差异。",
    badge: "Customs AI",
    metrics: [
      { label: "已上传文件", value: "12", helper: "支持 PDF / Word / Excel" },
      { label: "差异项", value: "4", helper: "需人工复核" },
      { label: "模板回填", value: "2", helper: "CI / PL 已生成" },
    ],
    actions: [
      { label: "查看对外资料", to: "/external-docs" },
      { label: "查看项目里程碑", to: "/registration-projects" },
    ],
    sections: [
      {
        type: "table",
        title: "字段提取结果",
        description: "核心贸易字段可编辑，并附带置信度。",
        columns: ["字段", "PI", "CI", "PL", "状态"],
        rows: [
          ["产品型号", "OC-10", "OC-10", "OC-10", "一致"],
          ["数量", "120", "120", "118", "差异"],
        ],
      },
      {
        type: "cards",
        title: "自动模板回填",
        description: "可一键生成 CI 与 PL 预览。",
        items: [
          { title: "CI 模板", subtitle: "含收货人、金额、重量等字段", tag: "Word" },
          { title: "PL 模板", subtitle: "含箱数、毛净重和包装信息", tag: "Word" },
        ],
      },
    ],
  },
  "external-docs": {
    title: "对外资料版本管理与 AI 发包推荐",
    subtitle: "资料索引、版本追踪和多语言外发话术联动。",
    badge: "Enablement",
    metrics: [
      { label: "资料总数", value: "28", helper: "L1/L2/L3 分阶段管理" },
      { label: "推荐命中", value: "5", helper: "基于客户阶段与自然语言查询" },
      { label: "更新提醒", value: "3", helper: "旧版资料需替换" },
    ],
    actions: [
      { label: "去报关单证", to: "/customs-ai" },
      { label: "去售后工单", to: "/after-sales" },
    ],
    sections: [
      {
        type: "table",
        title: "资料索引",
        description: "版本、客户阶段和外发权限一览。",
        columns: ["文件", "版本", "阶段", "允许外发", "更新时间"],
        rows: [
          ["CE 认证资质", "V2.1", "L2", "是", "2026-04-11"],
          ["产品彩页", "V3.0", "L1", "是", "2026-04-09"],
        ],
      },
      {
        type: "cards",
        title: "AI 推荐发包",
        description: "根据客户阶段自动推荐资料并生成对外沟通文案。",
        items: [
          { title: "推荐包 A", subtitle: "CE 资质 + 彩页 + 注册证", tag: "中文" },
          { title: "推荐包 B", subtitle: "FAQ + 维护说明 + 培训资料", tag: "English" },
        ],
      },
    ],
  },
  "ra-knowledge": {
    title: "法规知识库",
    subtitle: "多体系法规检索、条款标注与版本追踪。",
    badge: "Regulatory",
    metrics: [
      { label: "法规文档", value: "36", helper: "FDA / CE MDR / NMPA" },
      { label: "高相关条款", value: "14", helper: "关联当前产品模块" },
      { label: "失效版本", value: "5", helper: "历史版本可追溯" },
    ],
    actions: [
      { label: "去合同审查", to: "/contract-review" },
      { label: "去质量 DMS", to: "/quality-dms" },
    ],
    sections: [
      {
        type: "cards",
        title: "法规检索结果",
        description: "支持精确匹配与语义检索。",
        items: [
          { title: "FDA 21 CFR 820", subtitle: "适用软件 / 硬件 / 电源模块", tag: "Active" },
          { title: "CE MDR Annex II", subtitle: "适用技术文档与设计历史", tag: "Active" },
        ],
      },
      {
        type: "steps",
        title: "条款处理流程",
        description: "条款级标注支持模块映射与版本追踪。",
        items: [
          { title: "选择法规条款", detail: "支持章节树展开", status: "done" },
          { title: "打标签映射模块", detail: "报警 / 电源 / 软件 / 硬件", status: "current" },
          { title: "同步到产品知识库", detail: "供研发与质量复用", status: "pending" },
        ],
      },
    ],
  },
  "quality-dms": {
    title: "质量文件管理系统",
    subtitle: "程序文件、记录表单、作业指导书的全流程受控管理。",
    badge: "QMS DMS",
    metrics: [
      { label: "受控文件", value: "86", helper: "含作废归档版本" },
      { label: "审批中", value: "7", helper: "跨部门会签" },
      { label: "本周发布", value: "4", helper: "已进入受控分发" },
    ],
    actions: [
      { label: "查看角色权限", to: "/roles" },
      { label: "返回首页", to: "/" },
    ],
    sections: [
      {
        type: "table",
        title: "文件清单",
        description: "自动编号、版本、状态、当前审批人全量展示。",
        columns: ["编号", "文件名", "版本", "状态", "当前审批"],
        rows: [
          ["CX-001", "文件控制程序", "V3.2", "已发布", "刘婷"],
          ["JL-014", "来料检验记录", "V1.6", "审核中", "周远"],
        ],
      },
      {
        type: "steps",
        title: "审批工作流",
        description: "起草、审核、评审、批准、受控分发顺序进行。",
        items: [
          { title: "起草", detail: "张宁 / 已完成", status: "done" },
          { title: "审核", detail: "周远 / 当前节点", status: "current" },
          { title: "评审", detail: "质量部、研发部", status: "pending" },
          { title: "批准", detail: "QA 负责人", status: "pending" },
        ],
      },
    ],
  },
  "resume-screening": {
    title: "简历筛选与面试题生成",
    subtitle: "JD 上传、批量评分、候选人排序和面试问题自动生成。",
    badge: "HR AI",
    metrics: [
      { label: "候选人", value: "18", helper: "已完成 AI 评分" },
      { label: "入围推荐", value: "5", helper: "可进入面试流程" },
      { label: "风险提示", value: "7", helper: "稳定性与经历空档" },
    ],
    actions: [
      { label: "查看员工归档", to: "/employee-archive" },
      { label: "查看用户管理", to: "/users" },
    ],
    sections: [
      {
        type: "table",
        title: "候选人排名",
        description: "按匹配分和风险标签默认降序排序。",
        columns: ["姓名", "匹配分", "技能亮点", "风险提示", "动作"],
        rows: [
          ["李航", "92", "法规、英语、海外项目", "无", "进入面试"],
          ["周洁", "85", "售后、医疗器械", "离职频次偏高", "观察"],
        ],
      },
      {
        type: "cards",
        title: "面试问题包",
        description: "分为背景确认、经历深挖、能力验证、动机了解。",
        items: [
          { title: "背景确认", subtitle: "3 个问题，聚焦教育与项目背景", tag: "Stage 1" },
          { title: "经历深挖", subtitle: "3 个问题，聚焦复杂问题处理", tag: "Stage 2" },
        ],
      },
    ],
  },
  "employee-archive": {
    title: "员工入职归档",
    subtitle: "花名册、OCR 字段归档和证照到期提醒统一管理。",
    badge: "Onboarding",
    metrics: [
      { label: "在册员工", value: "46", helper: "含 6 名试用期员工" },
      { label: "合同到期预警", value: "3", helper: "60 天内提醒" },
      { label: "待上传新版本", value: "2", helper: "需补劳动合同附件" },
    ],
    actions: [
      { label: "查看费用报销", to: "/expense-center" },
      { label: "查看角色权限", to: "/roles" },
    ],
    sections: [
      {
        type: "table",
        title: "员工花名册",
        description: "支持按部门、岗位和日期筛选。",
        columns: ["姓名", "工号", "部门", "岗位", "入职日期", "合同到期"],
        rows: [
          ["王若彤", "HR-014", "人事行政", "HRBP", "2024-06-18", "2026-05-31"],
          ["陈禹含", "OPS-022", "运营管理", "运营专员", "2025-03-01", "2026-07-20"],
        ],
      },
      {
        type: "cards",
        title: "档案摘要",
        description: "身份证、学历证、劳动合同 OCR 字段可编辑。",
        items: [
          { title: "身份证", subtitle: "姓名、证号、出生日期、地址", tag: "OCR" },
          { title: "学历证", subtitle: "学校、专业、毕业时间", tag: "OCR" },
        ],
      },
    ],
  },
  "quick-capture": {
    title: "随手记与任务分配",
    subtitle: "语音/文字速记，AI 分类后派发到责任人。",
    badge: "Capture",
    metrics: [
      { label: "今日记录", value: "21", helper: "其中 9 条生成任务" },
      { label: "待分配", value: "4", helper: "需补责任人与截止日" },
      { label: "已推送", value: "12", helper: "企业微信通知已发出" },
    ],
    actions: [
      { label: "查看会议纪要", to: "/meeting" },
      { label: "查看用户管理", to: "/users" },
    ],
    sections: [
      {
        type: "kanban",
        title: "AI 分类结果",
        description: "速记内容按紧急待办、会议安排、项目事项等分类。",
        columns: [
          { title: "紧急待办", tone: "bg-red-50 text-red-700", cards: [{ title: "处理 FDA 补件", detail: "截止今日 18:00 / 待指定责任人" }] },
          { title: "会议安排", tone: "bg-blue-50 text-blue-700", cards: [{ title: "质量周会", detail: "周四 15:00 / 已同步日程" }] },
          { title: "需分配任务", tone: "bg-amber-50 text-amber-700", cards: [{ title: "更新售后 FAQ", detail: "建议分配给客服与研发" }] },
        ],
      },
      {
        type: "table",
        title: "任务派发表",
        description: "展示责任人、截止时间与状态追踪。",
        columns: ["任务", "负责人", "截止时间", "优先级", "状态"],
        rows: [
          ["更新售后 FAQ", "吴清", "2026-04-18", "高", "待确认"],
          ["整理注册证资质包", "韩青", "2026-04-19", "中", "进行中"],
        ],
      },
    ],
  },
  "expense-center": {
    title: "费用报销与月度统计",
    subtitle: "发票 OCR、报销单提交与多维统计看板。",
    badge: "Finance",
    metrics: [
      { label: "本月报销", value: "¥ 186,400", helper: "较上月 +8%" },
      { label: "待审批", value: "9", helper: "其中 2 条缺签字" },
      { label: "发票异常", value: "3", helper: "需补合规信息" },
    ],
    actions: [
      { label: "查看员工归档", to: "/employee-archive" },
      { label: "返回首页", to: "/" },
    ],
    sections: [
      {
        type: "cards",
        title: "OCR 识别结果",
        description: "自动抽取发票代码、金额、日期和归属项目。",
        items: [
          { title: "差旅类", subtitle: "票据金额 ¥ 12,860 / 项目：FDA 注册", tag: "OCR" },
          { title: "办公用品", subtitle: "票据金额 ¥ 1,240 / 项目：日常运营", tag: "Normal" },
        ],
      },
      {
        type: "table",
        title: "报销历史",
        description: "记录提交日期、金额、类别与审批状态。",
        columns: ["日期", "金额", "类别", "部门", "状态"],
        rows: [
          ["2026-04-14", "¥ 8,400", "差旅", "注册部", "审批中"],
          ["2026-04-12", "¥ 1,240", "办公用品", "运营部", "已报销"],
        ],
      },
    ],
  },
  ebpr: {
    title: "电子批记录 eBPR",
    subtitle: "批次记录、工序锁定和修改审计轨迹。",
    badge: "eBPR",
    metrics: [
      { label: "进行中批次", value: "5", helper: "可继续录入工序" },
      { label: "待放行", value: "2", helper: "需 QA 审核" },
      { label: "审计修改", value: "4", helper: "均已填写原因" },
    ],
    actions: [
      { label: "查看检验放行", to: "/inspection-release" },
      { label: "查看 BUG 日志", to: "/bug-log" },
    ],
    sections: [
      {
        type: "steps",
        title: "工序录入",
        description: "已完成工序锁定，当前工序可编辑提交。",
        items: [
          { title: "来料上线", detail: "已完成 / 操作人：周帆", status: "done" },
          { title: "主装配", detail: "已完成 / 操作人：韩可", status: "done" },
          { title: "功能测试", detail: "当前工序 / 设备 ID: T-09", status: "current" },
          { title: "包装入库", detail: "待执行", status: "pending" },
        ],
      },
      {
        type: "table",
        title: "修改审计链",
        description: "锁定记录修改后形成不可删除审计轨迹。",
        columns: ["修改人", "时间", "字段", "原值", "新值", "原因"],
        rows: [["韩可", "2026-04-14 15:20", "压力参数", "0.85", "0.88", "设备校准后重录"]],
      },
    ],
  },
  "inspection-release": {
    title: "检验与放行管理",
    subtitle: "IQC / IPQC / FQC 检验记录与 QA 放行审批。",
    badge: "Release",
    metrics: [
      { label: "待放行批次", value: "3", helper: "含 1 条不合格记录" },
      { label: "检验项目", value: "46", helper: "自动判定合格/不合格" },
      { label: "NCR 处置", value: "2", helper: "返工与让步接收" },
    ],
    actions: [
      { label: "查看 eBPR", to: "/ebpr" },
      { label: "查看质量 DMS", to: "/quality-dms" },
    ],
    sections: [
      {
        type: "table",
        title: "检验记录",
        description: "展示批次、检验类型、日期、结果和放行状态。",
        columns: ["批号", "检验类型", "检验日期", "结果", "放行状态"],
        rows: [
          ["BT-2026-014", "IQC", "2026-04-14", "合格", "待放行"],
          ["BT-2026-013", "IPQC", "2026-04-13", "不合格", "已拒绝"],
        ],
      },
      {
        type: "cards",
        title: "QA 放行面板",
        description: "支持电子签字、批准放行或驳回并要求原因。",
        items: [
          { title: "电子签字", subtitle: "动作视为 QA 审批确认", tag: "eSign" },
          { title: "批次摘要", subtitle: "检验项目 18 条，全部合格", tag: "Pass" },
        ],
      },
    ],
  },
  "bug-log": {
    title: "软件 BUG 日志分析",
    subtitle: "日志文件处理、异常识别与版本变更追踪。",
    badge: "Developer",
    metrics: [
      { label: "日志文件", value: "138", helper: "已处理" },
      { label: "今日异常", value: "7", helper: "较昨日 +2" },
      { label: "高频错误码", value: "E-1042", helper: "本周出现 28 次" },
    ],
    actions: [
      { label: "查看研发问题分流", to: "/rd-triage" },
      { label: "查看 eBPR", to: "/ebpr" },
    ],
    sections: [
      {
        type: "table",
        title: "日志清单",
        description: "设备 ID、上传时间、大小与异常状态一览。",
        columns: ["设备 ID", "上传时间", "大小", "异常检测"],
        rows: [
          ["DEV-OC10-14", "2026-04-14 16:20", "2.1 MB", "发现异常"],
          ["DEV-OC5-03", "2026-04-14 11:05", "1.2 MB", "正常"],
        ],
      },
      {
        type: "cards",
        title: "AI 异常分析",
        description: "自动识别错误码模式、频率和可能责任范围。",
        items: [
          { title: "E-1042", subtitle: "串口握手失败，疑似软件层问题", tag: "Software" },
          { title: "E-2208", subtitle: "传感器读数跳变，需排查硬件", tag: "Hardware" },
        ],
      },
    ],
  },
  "contract-review": {
    title: "合同 AI 审查",
    subtitle: "合同识别、风险扫描、修改建议与高层摘要。",
    badge: "Legal AI",
    metrics: [
      { label: "待审合同", value: "6", helper: "其中 2 份 NDA" },
      { label: "高风险条款", value: "5", helper: "需法务确认" },
      { label: "已采纳建议", value: "11", helper: "生成修订版草案" },
    ],
    actions: [
      { label: "查看法规知识库", to: "/ra-knowledge" },
      { label: "查看用户管理", to: "/users" },
    ],
    sections: [
      {
        type: "cards",
        title: "关键条款提取",
        description: "识别付款条件、交付标准、违约责任、知识产权与争议解决。",
        items: [
          { title: "付款条件", subtitle: "验收后 90 天付款，建议缩短账期", tag: "Risk" },
          { title: "知识产权归属", subtitle: "当前约定偏向对方，建议修改", tag: "High" },
        ],
      },
      {
        type: "table",
        title: "风险扫描结果",
        description: "列出风险等级、原因与建议动作。",
        columns: ["风险等级", "条款", "原因", "建议"],
        rows: [
          ["高", "知识产权归属", "成果归属不清晰", "改为双方授权/我方所有"],
          ["中", "付款条件", "账期过长", "修改为 30/60 天"],
        ],
      },
    ],
  },
};

export function ModulePage() {
  const { moduleId } = useParams();
  const location = useLocation();
  const resolvedModuleId = moduleId ?? location.pathname.replace(/^\//, "");
  const config = moduleConfigs[resolvedModuleId];
  const [keyword, setKeyword] = useState("");
  const [pageBySection, setPageBySection] = useState<Record<string, number>>({});
  const [selectedDetail, setSelectedDetail] = useState<{ title: string; detail: string; tag?: string } | null>(null);
  const [stepStatuses, setStepStatuses] = useState<Record<string, "done" | "current" | "pending">>({});

  if (!config) return <Navigate to="/" replace />;

  const filteredSections = useMemo(() => {
    return config.sections.map((section) => {
      if (section.type === "cards") {
        return {
          ...section,
          items: section.items.filter((item) => matchesKeyword(keyword, [item.title, item.subtitle, item.tag ?? ""])),
        };
      }
      if (section.type === "table") {
        return {
          ...section,
          rows: section.rows.filter((row) => matchesKeyword(keyword, row)),
        };
      }
      if (section.type === "steps") {
        return {
          ...section,
          items: section.items.filter((item) => matchesKeyword(keyword, [item.title, item.detail])),
        };
      }
      return {
        ...section,
        columns: section.columns.map((column) => ({
          ...column,
          cards: column.cards.filter((card) => matchesKeyword(keyword, [card.title, card.detail, column.title])),
        })),
      };
    });
  }, [config.sections, keyword]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <span className="material-chip bg-blue-50 text-blue-700">{config.badge}</span>
            <div>
              <h2 className="text-[2rem] font-bold tracking-tight text-slate-900">{config.title}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{config.subtitle}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {config.actions.map((action) => (
              <Link key={action.to} to={action.to} className="material-button-secondary">
                {action.label}
                <ArrowRight className="h-4 w-4" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {config.metrics.map((metric) => (
          <div key={metric.label} className="material-card-flat p-5">
            <div className="text-sm font-medium text-slate-500">{metric.label}</div>
            <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{metric.value}</div>
            <div className="mt-2 text-sm text-slate-500">{metric.helper}</div>
          </div>
        ))}
      </section>

      <section className="material-card p-5">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="material-input pl-11"
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
              setPageBySection({});
            }}
            placeholder="搜索当前模块中的记录、条款、任务或说明..."
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {filteredSections.map((section) => {
          const currentPage = pageBySection[section.title] ?? 1;
          const totalItems =
            section.type === "cards"
              ? section.items.length
              : section.type === "table"
                ? section.rows.length
                : section.type === "steps"
                  ? section.items.length
                  : section.columns.reduce((sum, column) => sum + column.cards.length, 0);
          const totalPages = Math.max(1, Math.ceil(totalItems / sectionPageSize));

          const setSectionPage = (page: number) =>
            setPageBySection((prev) => ({ ...prev, [section.title]: Math.max(1, Math.min(totalPages, page)) }));

          const paginatedSection =
            section.type === "cards"
              ? { ...section, items: section.items.slice((currentPage - 1) * sectionPageSize, currentPage * sectionPageSize) }
              : section.type === "table"
                ? { ...section, rows: section.rows.slice((currentPage - 1) * sectionPageSize, currentPage * sectionPageSize) }
                : section.type === "steps"
                  ? { ...section, items: section.items.slice((currentPage - 1) * sectionPageSize, currentPage * sectionPageSize) }
                  : {
                      ...section,
                      columns: section.columns.map((column) => ({
                        ...column,
                        cards: column.cards.slice((currentPage - 1) * sectionPageSize, currentPage * sectionPageSize),
                      })),
                    };

          return (
          <div key={section.title} className="material-card overflow-hidden p-6">
            <div className="mb-5">
              <h3 className="text-slate-900">{section.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{section.description}</p>
            </div>

            {paginatedSection.type === "cards" ? (
              <div className="grid gap-4 md:grid-cols-2">
                {paginatedSection.items.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => setSelectedDetail({ title: item.title, detail: item.subtitle, tag: item.tag })}
                    className="rounded-[22px] border border-slate-100 bg-slate-50/80 p-4 text-left transition hover:-translate-y-0.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                        <div className="mt-2 text-sm leading-6 text-slate-500">{item.subtitle}</div>
                      </div>
                      {item.tag ? <span className="material-chip bg-white text-slate-600">{item.tag}</span> : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            {paginatedSection.type === "table" ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead className="bg-slate-50">
                    <tr>
                      {paginatedSection.columns.map((column) => (
                        <th key={column} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedSection.rows.map((row, index) => (
                      <tr
                        key={`${section.title}-${index}`}
                        className="cursor-pointer hover:bg-slate-50/70"
                        onClick={() => setSelectedDetail({ title: row[0], detail: row.slice(1).join(" / ") })}
                      >
                        {row.map((cell, cellIndex) => (
                          <td key={`${cell}-${cellIndex}`} className="px-4 py-3 text-sm text-slate-700">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {paginatedSection.type === "steps" ? (
              <div className="space-y-4">
                {paginatedSection.items.map((item) => {
                  const stepKey = `${section.title}-${item.title}`;
                  const currentStatus = stepStatuses[stepKey] ?? item.status;
                  return (
                  <button
                    type="button"
                    key={item.title}
                    onClick={() => {
                      const next = cycleStatus(currentStatus);
                      setStepStatuses((prev) => ({ ...prev, [stepKey]: next }));
                      toast.success(`${item.title} 已切换为 ${next}`);
                    }}
                    className="flex w-full gap-4 rounded-[20px] border border-slate-100 bg-slate-50/60 p-4 text-left transition hover:-translate-y-0.5"
                  >
                    <div className="pt-0.5">
                      {currentStatus === "done" ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : currentStatus === "current" ? <Clock3 className="h-5 w-5 text-blue-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                      <div className="mt-1 text-sm text-slate-500">{item.detail}</div>
                      <div className="mt-2 text-xs text-slate-400">点击可切换该步骤状态</div>
                    </div>
                  </button>
                )})}
              </div>
            ) : null}

            {paginatedSection.type === "kanban" ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {paginatedSection.columns.map((column) => (
                  <div key={column.title} className="rounded-[22px] border border-slate-100 bg-slate-50/60 p-4">
                    <div className={cn("mb-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold", column.tone)}>{column.title}</div>
                    <div className="space-y-3">
                      {column.cards.map((card) => (
                        <button
                          type="button"
                          key={card.title}
                          onClick={() => setSelectedDetail({ title: card.title, detail: `${column.title} / ${card.detail}` })}
                          className="w-full rounded-2xl bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5"
                        >
                          <div className="text-sm font-semibold text-slate-800">{card.title}</div>
                          <div className="mt-2 text-sm text-slate-500">{card.detail}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
              <div className="text-sm text-slate-500">
                第 {currentPage} / {totalPages} 页
              </div>
              <div className="flex gap-2">
                <button className="material-button-secondary !px-3 !py-2" onClick={() => setSectionPage(currentPage - 1)} disabled={currentPage === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button className="material-button-secondary !px-3 !py-2" onClick={() => setSectionPage(currentPage + 1)} disabled={currentPage === totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )})}
      </section>

      <section className="material-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-slate-900">点击详情</h3>
            <p className="mt-1 text-sm text-slate-500">上方卡片、表格和列表点击后会在这里展示明细。</p>
          </div>
          <button
            className="material-button-secondary"
            onClick={() => {
              toast.success("当前模块列表已刷新");
            }}
          >
            <Sparkles className="h-4 w-4" />
            刷新状态
          </button>
        </div>
        {selectedDetail ? (
          <div className="rounded-[22px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-lg font-semibold text-slate-900">{selectedDetail.title}</div>
              {selectedDetail.tag ? <span className="material-chip bg-white text-slate-600">{selectedDetail.tag}</span> : null}
            </div>
            <div className="mt-3 text-sm leading-7 text-slate-600">{selectedDetail.detail}</div>
          </div>
        ) : (
          <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/60 px-5 py-8 text-center text-sm text-slate-500">
            先点击任意卡片、表格行或任务项，这里就会显示对应内容。
          </div>
        )}
      </section>
    </div>
  );
}
