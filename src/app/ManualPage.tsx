/**
 * 操作手册（系统管理 · /manual）
 *
 * 结构与「下载和教程」（DownloadTutorialPage）保持一致：索引页列主题卡 → 详情页分条讲解。
 * 与之不同的是配图用真实截图而非手绘示意：图由 apps/api/scripts/shoot-manual-screens.mjs
 * 对着真实页面 + 演示数据自动生成，UI 改版后重跑脚本即可刷新。
 *
 * 图上的红色编号圆点与本文件 points[] 的序号一一对应：中文图由截图脚本烘焙，
 * 英文图由本页按 EN_SHOT_MARKERS 响应式覆盖；调整序号或坐标时需同步维护。
 *
 * 正文和截图均随全站语言切换。
 */
import { useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  GanttChartSquare,
  Images,
  Layers3,
  LayoutGrid,
  ListChecks,
  Search,
  TableProperties,
  X,
  type LucideIcon,
} from "lucide-react";
import { Link, Navigate, useParams } from "react-router";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import { cn } from "./components/ui/utils";
import { MobileImagePreviewLink } from "./components/MobileZoomableImage";
import { t, useI18n, type I18nLang } from "./lib/i18n";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "./lib/routePaths";
import { useResetPageScroll } from "./hooks/useResetPageScroll";

type ShotMarker = { n: number; x: number; y: number };

// 英文图由 1280×720 的真实界面录制；编号用百分比覆盖，响应式缩放时仍能对准。
// 中文历史图已经把编号烘焙进图片，因此仅英文态渲染这些覆盖层。
const EN_SHOT_MARKERS: Record<string, ShotMarker[]> = {
  "cockpit-overview": [
    { n: 1, x: 78.1, y: 17.8 }, { n: 2, x: 25.2, y: 28.5 },
    { n: 3, x: 25.2, y: 45.1 }, { n: 4, x: 25.2, y: 56.3 },
    { n: 5, x: 25.2, y: 70.1 },
  ],
  "workspace-overview": [
    { n: 1, x: 27.3, y: 20.1 }, { n: 2, x: 27.3, y: 30.6 },
    { n: 3, x: 27.3, y: 39.6 }, { n: 4, x: 27.3, y: 74.3 },
    { n: 5, x: 84.4, y: 20.1 },
  ],
  "kb-overview": [
    { n: 1, x: 27.3, y: 19.7 }, { n: 2, x: 84.4, y: 25 },
    { n: 3, x: 71.5, y: 25 }, { n: 4, x: 27.3, y: 36.1 },
    { n: 5, x: 62.5, y: 69.4 },
  ],
  "workspace-progress": [
    { n: 1, x: 48.6, y: 13.3 }, { n: 2, x: 48.6, y: 20.8 },
    { n: 3, x: 48.6, y: 46.7 }, { n: 4, x: 48.6, y: 60.3 },
    { n: 5, x: 48.6, y: 75.8 }, { n: 6, x: 81.4, y: 86.9 },
  ],
  "cockpit-kickoff": [
    { n: 1, x: 53.4, y: 15.6 }, { n: 2, x: 24.7, y: 25.6 },
    { n: 3, x: 24.7, y: 43.3 }, { n: 4, x: 24.7, y: 61.9 },
  ],
  "cockpit-reassign": [
    { n: 1, x: 30.9, y: 14.2 }, { n: 2, x: 30.9, y: 25 },
    { n: 3, x: 60.2, y: 68 }, { n: 4, x: 59.4, y: 96 },
  ],
  "kb-upload": [
    { n: 1, x: 49.5, y: 29.5 }, { n: 2, x: 49.5, y: 50.4 },
    { n: 3, x: 49.5, y: 63.8 }, { n: 4, x: 66.7, y: 92.3 },
  ],
  "kb-member-levels": [
    { n: 1, x: 30.9, y: 16.7 }, { n: 2, x: 30.9, y: 25.6 },
    { n: 3, x: 60.2, y: 34.4 },
  ],
};

function manualShotSrc(shot: string, lang: I18nLang): string {
  return `/manual-shots/${shot}-${lang}.${lang === "en" ? "jpg" : "png"}`;
}

type ManualPoint = {
  /** 与截图上红色圆点的编号对应 */
  n: number;
  title: string;
  body: string;
};

/** 常见操作：分步骤把一件事做完。手册最有用的部分——用户来查的多半是「这事怎么做」。 */
type ManualHowTo = {
  title: string;
  /** 什么场景用得上，帮用户判断该不该看这条 */
  when?: string;
  steps: string[];
  /** 容易踩的坑 / 权限限制 */
  note?: string;
};

/** 概念速查表：状态、优先级、权限矩阵这类「对照着看」的信息，表格比段落一目了然。 */
type ManualTable = {
  title: string;
  intro?: string;
  columns: string[];
  rows: string[][];
};

type ManualFaq = { q: string; a: string };

/**
 * 深入：点开之后才看得到的界面（弹窗 / 抽屉 / 全屏详情页）。
 * 用户大部分时间花在这些界面里，光讲概览页远远不够。配图同样由截图脚本自动生成。
 */
type ManualDeepDive = {
  title: string;
  /** 怎么打开这个界面 */
  entry: string;
  /** public/manual-shots/{shot}-{lang}.{png|jpg} */
  shot: string;
  points: ManualPoint[];
  note?: string;
};

type ManualTopic = {
  id: string;
  /** 侧边栏里对应的页面名，帮助用户把手册和实际入口对上 */
  navLabel: string;
  title: string;
  summary: string;
  /** public/manual-shots/{shot}-{lang}.{png|jpg} */
  shot: string;
  icon: LucideIcon;
  /** 页面定位：一句话说清「这页是干嘛的」 */
  purpose: string;
  /** 谁会用到这页、来这儿干什么 */
  audience?: string[];
  /** 界面导览，与截图上的红色编号一一对应 */
  points: ManualPoint[];
  howTos?: ManualHowTo[];
  deepDives?: ManualDeepDive[];
  tables?: ManualTable[];
  faqs?: ManualFaq[];
  tips?: string[];
};

const TOPICS: ManualTopic[] = [
  {
    id: "cockpit",
    navLabel: "协同任务驾驶舱",
    title: "协同任务驾驶舱",
    summary: "全局看板：所有人的协同任务、风险与日报一屏掌握",
    shot: "cockpit-overview",
    icon: LayoutGrid,
    purpose: "驾驶舱是管理视角：看协同池里所有人的任务。只看自己的任务请用「协同工作台」。这里能做的是「调度」——分派、转派、盯风险、看日报；具体干活（填进度、传附件）在工作台或任务详情页。",
    audience: [
      "组长 / 项目负责人：早上扫一眼风险和阻塞，决定今天盯谁。",
      "任何有协同驾驶舱权限的人：查看全员任务、搜任务、看日报。",
    ],
    points: [
      {
        n: 1,
        title: "页头工具栏",
        body: "「AI 立项」把一段文字或一个文件变成任务并下发；「批量转派」一次给多个任务换负责人；「人员管理」跳到成员页（不是弹窗）；「导出」下载指定时间段的完成情况表；「清空数据」是危险操作，见下方常见问题。",
      },
      {
        n: 2,
        title: "六格统计（后四格可点）",
        body: "「进行中」「完成」「阻塞/待派」「风险」这四格点一下就是筛选，再点一次取消，选中后下方会出现「当前筛选」条。前两格「活跃」「完成率」只是数字，点不动。",
      },
      {
        n: 3,
        title: "今日日报",
        body: "显示今天已生成日报的人数，以及完成 / 推进 / 停滞 / 阻塞的任务计数（为 0 的不显示）。点「展开报表」看完整日报和月报，正文由 AI 汇总当日进展与风险。",
      },
      {
        n: 4,
        title: "按人筛选",
        body: "点头像只看这个人的任务，点「全部」回到全员。头像右下角的数字是这个人「主责且未完成」的任务数（协作的不算）；头像外圈的颜色是负载率，绿→琥珀→橙→红表示越来越满，灰色加半透明表示这人请假中。右侧放大镜搜任务。",
      },
      {
        n: 5,
        title: "任务卡片",
        body: "一张卡 = 一个任务，按最近活动时间倒序排。卡上直接能「转派」「删除」。点卡片任意处（或按回车）进入任务详情页。带颜色的横条是备注回执，见下方「概念速查」。",
      },
    ],
    howTos: [
      {
        title: "早上五分钟：找出今天要盯的人和事",
        steps: [
          "先看「风险」那格的数字，点它——列表立刻只剩有风险的任务。",
          "看卡片上的红色「风险」徽标和「已阻塞 N 天」，阻塞久的优先处理。",
          "再点「阻塞/待派」格，看有没有任务还没人认领（待指派）。",
          "扫头像行：外圈发红的人已经满负载，别再给他派活；灰色半透明的人在请假。",
          "点「展开报表」看今日日报的「停滞」分组——这些人今天一条进展都没记。",
        ],
      },
      {
        title: "把一份文档或一段文字变成任务",
        when: "收到会议纪要、邮件、需求清单，想快速拆成任务派下去。",
        steps: [
          "点「AI 立项」。",
          "第 1 步：填标题和描述，或直接上传一个文件（一次只解析第一个文件）。",
          "第 2 步：等 AI 解析，它会自动拆出任务条目、猜负责人、定优先级和截止日。",
          "第 3 步：逐条审阅修改。确认没问题后点「AI 一键立项」——任务直接以「进行中」下发给责任人，不需要审批。",
        ],
        note: "在驾驶舱立项不用走审批流；在工作台立项则只能派给自己。协同池没有分类概念，立项的任务统一落到「协同任务 / 默认」下。",
      },
      {
        title: "批量把任务换个负责人",
        when: "有人离职、请假，或负载太满要匀一些出去。",
        steps: [
          "点「批量转派」（或在某张卡片上点「转派」，会预选这一条）。",
          "勾选要转的任务。候选超过 5 个时会出现搜索框和负责人 / 优先级筛选（搜索只匹配标题）。",
          "在下方选目标负责人。请假的人不会出现在列表里；负载超过 75% 的人任务数会标橙。",
          "点「确认转派」。",
        ],
        note: "转派会把任务状态一律改成「进行中」——原本暂停或阻塞的任务会被拉回进行中，这点要留意。已完成的任务不能转派。",
      },
      {
        title: "导出一段时间的完成情况",
        steps: [
          "点「导出」。",
          "选起止日期，或用「近 7 天 / 近 30 天 / 本月」快捷按钮（默认本月初到今天）。",
          "点「导出 Excel」。",
        ],
        note: "导出的表有「人员汇总」和「任务明细」两个工作表；按任务的最近活动时间归入时间段；已封存的任务不计入。",
      },
    ],
    deepDives: [
      {
        title: "AI 立项弹窗",
        entry: "页头点「AI 立项」。共 4 步，顶部有进度条标明「第 N / 4 步」。",
        shot: "cockpit-kickoff",
        points: [
          { n: 1, title: "步骤指示", body: "描述内容 → AI 解析 → 审阅 → 提交。在第 3 步就能点「AI 一键立项」直接下发，不必走完第 4 步。" },
          { n: 2, title: "立项标题", body: "可以留空，AI 会自动起一个。" },
          { n: 3, title: "立项描述", body: "粘贴会议纪要、邮件正文，或直接写目标和关键节点。" },
          { n: 4, title: "上传附件", body: "支持 Excel / Word / PDF / 图片，以及 zip / rar / 7z 压缩包。描述和附件二选一即可，都给则 AI 综合两者。" },
        ],
        note: "AI 只解析你上传的第一个文件。如果系统没配 AI 模型，会自动降级成本地规则解析并给出提示。",
      },
      {
        title: "批量转派弹窗",
        entry: "页头点「批量转派」；或在某张任务卡上点「转派」（会预选这一条）。",
        shot: "cockpit-reassign",
        points: [
          { n: 1, title: "筛选工具", body: "候选任务超过 5 个时才出现。搜索只匹配任务标题；还能按当前负责人和优先级筛。" },
          { n: 2, title: "勾选任务", body: "已完成的任务不会出现在这里——它们不能转派。已勾选的项不受后续筛选影响，不会被筛掉。" },
          { n: 3, title: "选目标负责人", body: "请假的人不会列出。每人显示当前任务数，负载超过 75% 会标橙。如果所选任务本来就都归这个人，他的卡片会置灰。" },
          { n: 4, title: "确认", body: "所选任务里有「待指派」时，按钮文案会变成「确认指派」。" },
        ],
        note: "转派会把任务状态一律改成「进行中」。若部分任务转派失败，会提示「N 个成功，M 个失败」。",
      },
    ],
    tables: [
      {
        title: "任务状态",
        intro: "卡片上状态文字前的小圆点就是这个颜色。",
        columns: ["状态", "含义"],
        rows: [
          ["进行中", "正常推进中，最常见的状态。"],
          ["待审核", "有人提交了东西等你批：可能是成果、立项、改期、加协作人或申请放弃五种之一。"],
          ["暂停·阻塞", "被外部依赖卡住。协同下卡片会额外显示「已阻塞 N 天」。"],
          ["暂停·请假", "负责人请假期间暂停。"],
          ["待指派", "还没有负责人，需要有人认领或指派。"],
          ["已完成", "验收通过，进度 100%。"],
          ["草稿 / 已挂起 / 已封存", "非活跃状态。已封存的任务不出现在列表里。"],
        ],
      },
      {
        title: "什么情况会被标「风险」",
        intro: "系统自动判定，不用手动打标。从上往下依次判断，命中第一条就停。已完成和已封存的任务永远没有风险。",
        columns: ["顺序", "条件", "显示"],
        rows: [
          ["1", "待审核，且当初是逾期才提交的", "逾期提交 N 天。按时提交的待审核任务不算风险——压着不批是审核方的责任。"],
          ["2", "已经过了截止日", "已逾期 N 天（严重）"],
          ["3", "状态是阻塞", "阻塞中（严重）"],
          ["4", "离截止日不到 2 天", "今日到期 / N 天内到期"],
          ["5", "还没有负责人", "待人工指派"],
          ["6", "高优先级、进行中，但进度不到 30%", "高优先级·进度偏低"],
        ],
      },
      {
        title: "卡片上的徽标怎么看",
        columns: ["徽标", "含义"],
        rows: [
          ["左上角时间 + 彩色圆点", "最近一次更新。绿点（还在呼吸闪动）= 一天内；靛蓝 = 昨天；琥珀 = 2~7 天；灰 = 超过 7 天没动。"],
          ["带颜色的横条", "备注回执。红色 = 对方还没看；琥珀 = 看了但还没提交新进展。对方一提交进展，这条就自动消失。"],
          ["AI 87/100 药丸", "已完成任务的 AI 质量评分，鼠标悬停看各维度点评。"],
          ["☑ 3/5", "工作项完成数 / 总数（协同专属，任务内部的小清单）。"],
          ["已阻塞 N 天", "协同专属。从进入阻塞状态那天算起。"],
          ["回形针 + 数字", "附件数。卡片顶部的图片缩略图可点开看大图（← → 切换，Esc 关闭）。"],
        ],
      },
    ],
    faqs: [
      {
        q: "头像上的数字和点进去的任务条数对不上？",
        a: "头像角标只算「主责且未完成」的任务，列表里还包含他协作的任务和已完成的任务，所以列表通常更多。列表底部有一行小字会写明「其中主责进行中 N 个」。",
      },
      {
        q: "转派之后任务状态怎么变了？",
        a: "批量转派会把任务状态统一改成「进行中」，这是设计如此——转给新人就意味着重新开始推进。如果原来是阻塞或暂停，转派后需要手动改回。",
      },
      {
        q: "任务明明过了截止日，为什么不算逾期？",
        a: "如果它已经提交了审核，系统比的是「提交那天」和截止日，而不是今天。按时提交但压在审核里的任务不算成员逾期——那是审核方的事。",
      },
      {
        q: "搜索搜不到？",
        a: "搜索框匹配标题、任务编号、主责人姓名和分类路径四项，而且区分大小写。试试少打几个字，或换用头像行按人筛选。",
      },
      {
        q: "「清空数据」会清掉什么？",
        a: "只清协同池，不影响研发数据。会清空：协同的任务、工作台进展留痕、看板、日报、立项草稿。会保留：消息记录、人员档案、审批流配置、AI 策略、操作留痕。操作要手打「确认清空」四个字，还有 3 秒冷却，且不可恢复。",
      },
      {
        q: "在哪看已完成任务的 AI 评分？",
        a: "点「完成」那格筛出已完成任务，工具条上会多出「AI 复盘评分」「按新标准重算」「批量导出报告」三个按钮（需要转派权限）。导出报告会打开新窗口生成 PDF，注意别被浏览器拦截弹窗。",
      },
    ],
    tips: [
      "卡片是按「最近活动」排序的，不是按截止日——刚被更新的任务会浮到最上面。",
      "点卡片上的转派、删除、附件缩略图都不会误触打开任务详情。",
      "选中筛选后再用搜索，两个条件是叠加生效的。",
      "任务卡片支持键盘操作：选中后按回车或空格即可打开。",
    ],
  },
  {
    id: "workspace",
    navLabel: "协同工作台",
    title: "协同工作台",
    summary: "个人视角：只看与我有关的任务，日常干活的主入口",
    shot: "workspace-overview",
    icon: GanttChartSquare,
    purpose: "工作台只显示与你有关的任务（你主责的 + 你协作的），是每天干活的地方：填进度、传附件、@同事、提交成果、处理审批通知。看全员情况请用「协同任务驾驶舱」。",
    audience: [
      "所有协同成员：这是你每天打开的第一个页面。",
      "有审批权限的人：通知中心里可以直接批准或驳回。",
    ],
    points: [
      {
        n: 1,
        title: "我的任务统计",
        body: "七个数字的准确口径见下方「概念速查」——特别注意「完成率」其实是平均进度，「待处理」数的是通知条数而不是任务数，这两个最容易误读。",
      },
      {
        n: 2,
        title: "搜索与筛选",
        body: "搜索匹配任务号、标题、负责人、描述等多个字段，不区分大小写。三个下拉分别按优先级、状态、时间筛。右边的比例（如 11/11）是筛出条数 / 总条数。「全景」视图按分类分组，但协同任务没有分类，所以基本都会归到「未分类」——协同下建议就用「列表」。",
      },
      {
        n: 3,
        title: "任务卡片",
        body: "点卡片任意处打开右侧操作抽屉，这是干活的地方。「最新进度」是你上次填的进展，同事在驾驶舱看到的就是这句话。卡片右上角的红色数字是未读评论数，点开即清。「申请放弃」只有主责人看得到。",
      },
      {
        n: 4,
        title: "通知中心",
        body: "审核请求、审核结果、协作邀请、@提及、绩效自评都推到这里。审核类通知可以直接批准 / 驳回（驳回必须填原因），并且会自动带出该任务的进度时间线作为参考。点「×」关闭通知不会影响任务本身。",
      },
      {
        n: 5,
        title: "AI 立项",
        body: "把邮件正文、会议纪要或文件丢给 AI 自动拆成任务。注意：在工作台立项，任务只能派给你自己（负责人被锁定）；要派给别人得去驾驶舱立项。要不要审批取决于你的权限——有直接立项权就直接下发，普通成员走审批流。",
      },
    ],
    howTos: [
      {
        title: "更新一个任务的进度",
        when: "最常用的操作。每天做完事记一笔，别人才看得到你的进展。",
        steps: [
          "点任务卡片打开抽屉，切到「更新进度」页。",
          "填进展说明。可以打「@」提及同事（他会收到站内消息），也可以直接 Ctrl/⌘+V 粘贴截图。",
          "需要的话加附件：点按钮、拖进框里、或直接粘贴都行。",
          "（可选）点「AI 解析」——AI 会读你的文字和附件，建议一个进度百分比并说明依据。它只是建议，不会自动保存。",
          "拖动进度滑块确认最终百分比。",
          "点「保存进度」，弹出的确认框会列清楚这次要写入什么，确认即可。",
        ],
        note: "进度是「以本次确认值为准」，不做累加。「保存进度」不会再跑一次 AI，存多少完全由滑块决定。附件限制：最多 10 个、压缩后单个 25MB、合计 50MB；超过 8MB 的常见图片会自动压缩。",
      },
      {
        title: "任务做完了，提交验收",
        steps: [
          "先在「更新进度」页把最终成果和说明、附件都传好。",
          "切到「提交结果」页，点「提交审核」。",
          "确认框会提示：进度会被置为 100%（待验收，不等于完成）。",
          "任务进入「待审核」，此时卡片会置灰、不能再操作，等审核人处理。",
        ],
        note: "「提交结果」页上的四个检查项、提交说明框和上传附件按钮目前是摆设，填了不会被提交——真正要写说明和传附件，请回到「更新进度」页。审核通过后任务才变成「已完成」；被驳回会退回让你继续。",
      },
      {
        title: "拉人一起做（加协作人）",
        steps: [
          "打开任务抽屉，切到「移交协作」页。",
          "勾选要拉进来的人（可多选），填写协作原因和影响。",
          "有管理权限的人按钮显示「保存协同人」，点了直接生效；普通成员显示「提交审批」，原因必填，等批准后才生效。",
        ],
        note: "这一页是「整份替换」协作人名单，不是追加——原有协作人如果没勾上就会被移除。多人同时改会互相覆盖。",
      },
      {
        title: "改截止日期 / 申请放弃",
        when: "做不完要延期，或这个任务确实不该做了。",
        steps: [
          "改期：抽屉「任务详情」页 → 截止日期卡上点「修改」→ 选新日期 → 必填修改原因 → 提交审核。",
          "放弃：卡片上点「申请放弃」（只有主责人有），填必填原因后提交。",
          "两者都会让任务进入「待审核」，期间不能继续操作。",
        ],
        note: "放弃一旦被批准，任务会被彻底删除、不可恢复——不是归档。如果只是想并到别的任务里，用抽屉底部的「申请合并到其他任务」。",
      },
      {
        title: "处理一条审核请求",
        when: "你有审批权限，通知中心来了「审核请求」。",
        steps: [
          "在右侧通知中心点开那条通知，会显示审核类型、任务、提交人和原因。",
          "往下翻能看到系统自动带出的该任务进度时间线，作为判断依据。",
          "点「批准」或「驳回」，驳回必须填原因。",
        ],
        note: "审核类通知没有「标记已处理」按钮，必须批或驳。",
      },
    ],
    deepDives: [
      {
        title: "任务抽屉：日常操作全在这里",
        entry: "在工作台点任意一张任务卡片（待审核的点不动）。",
        shot: "workspace-progress",
        points: [
          { n: 1, title: "四个页签", body: "任务详情（看信息、改截止日、管工作项、看留痕）/ 更新进度（填进展、传附件）/ 移交协作（加人）/ 提交结果（交验收）。任务完成后只剩「任务详情」且只读。" },
          { n: 2, title: "三步流程条", body: "填写依据 → AI 判断 → 人工确认。它只是指引，不强制按顺序；AI 那步可以跳过。" },
          { n: 3, title: "进度滑块", body: "0~100 手动拖。滑块下方的刻度（未开始 / 方案 / 验证 / 待评审 / 完成）是参考锚点。最终存的就是你松手时的值，不累加。" },
          { n: 4, title: "进展说明", body: "输入 @ 提及同事（他会收到站内消息）。可以直接 Ctrl/⌘+V 粘贴截图。这段文字会成为卡片上的「最新进度」，同事在驾驶舱看到的就是它。" },
          { n: 5, title: "附件区", body: "最多 10 个、压缩后单个 25MB、合计 50MB。超过 8MB 的 JPG/PNG/WebP 自动压缩；点按钮、拖进来、粘贴三种方式都行。" },
          { n: 6, title: "AI 解析 / 保存进度", body: "「AI 解析」读你的文字和附件，给一个进度建议和依据，但不保存。「保存进度」才真正写入，弹出的确认框会列清楚这次写什么。" },
        ],
        note: "「保存进度」不会再跑一次 AI——存多少完全由滑块决定。有文字或附件才会产生一条留痕。",
      },
      {
        title: "任务全屏详情页：看得更全",
        entry: "从「协同任务驾驶舱」点任务卡片进入（工作台点卡片打开的是上面那个抽屉，不是这一页）。",
        shot: "task-detail",
        points: [
          { n: 0, title: "五个页签", body: "默认打开进展留痕；任务讨论用于整个任务持续沟通，也可进入某条进度的独立讨论线程；操作记录保留完整动作时间线；附件库集中查看图片、视频和文档；合并关系按树形展示永久保留的任务层级，点击节点可跳转详情。" },
          { n: 0, title: "右栏人员", body: "主责人和协作人旁边有当地时间小徽标（北京 / 波士顿），方便判断对方在不在上班。点人名能看他名下的其他任务。" },
          { n: 0, title: "两个输入框职责", body: "「进展留痕」底部用于提交正式进展；「任务讨论」底部用于聊天、@提及和上传附件。两者相互独立，讨论不会修改正式记录。" },
          { n: 0, title: "上一条 / 下一条", body: "顶部有翻页按钮，也可以直接按 j / k 键在任务间跳转。" },
          { n: 0, title: "管理员专属", body: "移交任务（换主责人）、标记完成、改标题描述、改优先级、审批——这些只在这一页有，且需要管理权限。" },
        ],
        note: "当地时间徽标是按「名字里有没有中文」猜的，用英文名的中国同事会被显示成波士顿时间，别全信。",
      },
    ],
    tables: [
      {
        title: "顶部七个数字的准确含义",
        intro: "有两个指标的名字和实际口径不一致，用之前先看清楚。",
        columns: ["指标", "实际统计的是"],
        rows: [
          ["主责", "你是主责人、且未完成的任务数。"],
          ["协作", "你是协作人、且未完成的任务数。"],
          ["完成率", "⚠️ 名字容易误导：它是你所有未完成任务的平均进度百分比，不是「完成数 ÷ 总数」。所以任务做完了它反而可能下降。"],
          ["已完成", "你参与的任务里已完成的条数（为 0 时不显示）。"],
          ["逾期", "未完成任务里已过截止日的条数。"],
          ["今日到期", "截止日正好是今天的任务数。"],
          ["待处理", "⚠️ 与任务无关：它数的是右侧通知中心的通知条数 + AI 建议条数。关掉通知这个数就会减少。"],
        ],
      },
      {
        title: "主责人和协作人分别能做什么",
        columns: ["能力", "主责人", "协作人"],
        rows: [
          ["填进度、传附件、@提及、增删工作项", "可以", "可以"],
          ["提交成果验收、改截止日期、改协作人", "可以", "可以"],
          ["申请放弃、申请合并", "可以", "看不到入口"],
          ["改自己写的那条留痕的附件", "可以（所有留痕都能改）", "只能改自己写的那条"],
          ["换主责人、直接标记完成、改标题 / 优先级", "需要管理权限", "需要管理权限"],
        ],
      },
      {
        title: "哪些操作要走审批",
        intro: "任务一旦进入「待审核」，卡片会置灰，谁都不能继续操作，直到审核人处理完。",
        columns: ["操作", "要不要审批"],
        rows: [
          ["更新进度、传附件、@提及、勾工作项", "不用，随时可做"],
          ["提交成果验收", "要。通过后才变「已完成」"],
          ["改截止日期", "要"],
          ["申请放弃 / 申请合并", "要。放弃批准 = 永久删除"],
          ["加协作人", "有管理权限直接生效；普通成员要审批"],
          ["管理员「标记完成」「移交任务」", "不用，直接生效（入口在任务全屏详情页）"],
        ],
      },
    ],
    faqs: [
      {
        q: "任务卡片点不动，灰的？",
        a: "这个任务正在「待审核」——有人提交了成果、改期或放弃申请，等审核人批完才能继续操作。这是最常见的疑问。",
      },
      {
        q: "我在「提交结果」页写了说明、传了附件，对方说没收到？",
        a: "那一页的检查项、说明框、上传按钮目前都还没接后端逻辑，填了不会保存。请到「更新进度」页写说明和传附件，那里才是真正生效的地方。",
      },
      {
        q: "为什么我的「完成率」不涨反跌？",
        a: "因为它其实是「未完成任务的平均进度」。你把一个 90% 的任务做完了，它就从平均里移出去，剩下的低进度任务拉低了平均值。",
      },
      {
        q: "「待处理」那个数字点不动，是什么？",
        a: "它是右侧通知中心的条数加上 AI 建议的条数，和你的任务数量无关。处理掉或关掉通知，这个数就降了。",
      },
      {
        q: "我 @ 了同事，他说没收到通知？",
        a: "提交时正文里必须还留着「@姓名」这几个字。如果你用 @ 选了人之后又把正文里的名字删掉，系统就不会给他发通知。另外重名的人无法定位，也不会发。",
      },
      {
        q: "顶栏铃铛的数字为什么没马上变？",
        a: "铃铛每 60 秒刷新一次，所以在通知中心点开消息后，铃铛数字最多一分钟内才跟着减。批准 / 驳回 / 提交审核会让它立刻刷新。",
      },
      {
        q: "工作项是什么？和子任务有什么区别？",
        a: "工作项是任务内部的小清单（比如「英文版手册」），随手加、随手勾，不走任何审批，也不是独立任务。它是协同模块专属的。记进展时可以关联到某个工作项；删掉工作项后，已关联的留痕会归到主任务下，不会丢。",
      },
    ],
    tips: [
      "进度不会自己动，得你去填。连着几天不记进展，驾驶舱的日报里会把你的任务标成「停滞」。",
      "传上去的附件会被自动做文字识别并进入 AI 检索——涉密文件请谨慎上传。",
      "每个任务最多保留 100 条进展留痕，超出会丢弃最早的。长周期任务留意一下。",
      "页面每 60 秒自动刷新一次，切回这个标签页也会刷新，不用手动刷。",
      "列表默认每次加载 8 条，滚到底自动加载更多。",
    ],
  },
  {
    id: "kb",
    navLabel: "协同知识库",
    title: "协同知识库",
    summary: "协同专属资料库，按权限分值控制谁能看到哪份文件",
    shot: "kb-overview",
    icon: BookOpen,
    purpose: "协同知识库是协同团队专属的资料库，和研发知识库是两个完全独立的库，内容互不可见。它比其他部门知识库多一层「权限分值」：每份文件有分值，每个人也有分值，只有你的分值不低于文件的分值，才看得到这份文件。",
    audience: [
      "协同成员：查资料、上传资料。看得到哪些文件由你的权限分值决定。",
      "库管理员（有「知识库管理」权限）：给成员设权限分值、设文件权限分值、管理知识域，且不受权限限制。",
    ],
    points: [
      {
        n: 1,
        title: "筛选与搜索",
        body: "关键词框匹配标题、描述、标签三项（注意：不搜文件名，也不搜文件正文）。「全部类型」按图片 / PDF / 文档 / 视频 / 其他过滤。「权限分」是显示筛选，只让你少看几条，不会让你看到本来无权看的文件。右侧「共 N / 文档 N / PDF N / 图片 N」是当前条件下的计数。",
      },
      {
        n: 2,
        title: "上传文件",
        body: "点按钮，或直接把文件拖到页面任意位置——会自动弹出上传队列。可一次选多个文件，它们共用同一套分类、描述、标签和权限分值。选好文件后系统会用 AI 猜一个知识域并标「AI 推荐」，你可以改。",
      },
      {
        n: 3,
        title: "成员权限",
        body: "只有库管理员看得到这个按钮。点开是全员名单，给每人填 0~100 的权限分值。这是协同库和采购库独有的机制，其他部门库没有。",
      },
      {
        n: 4,
        title: "知识域",
        body: "左侧的分类树，固定两层（一级类目 + 子类目）。点标题栏「+」建一级类目；鼠标移到类目行上会出现三个图标：新建子类、编辑（改名/图标/颜色）、删除。类目名后的数字是文件数（含子类目）。",
      },
      {
        n: 5,
        title: "权限分值",
        body: "卡片右下角的盾牌数字就是这份文件的权限分值。图中 0 分的 FDA 公开清单人人可见；80 分的成本明细只有分值 ≥ 80 的人（如 Mike Johnson）看得到，其他人连列表里都不会出现这一条。",
      },
    ],
    howTos: [
      {
        title: "上传一份资料",
        steps: [
          "把文件拖到页面上，或点右上角「上传文件」。可以一次拖多个。",
          "选「知识库分类」（必填）。系统可能已经用 AI 帮你预选了，确认一下即可。",
          "填描述和标签（可选，但强烈建议填——搜索只认标题、描述、标签这三项）。",
          "设「访问权限分值」（仅管理员可调；普通成员上传的文件一律是 0 分＝完全公开）。",
          "点确认上传。文件标题自动取文件名。",
        ],
        note: "格式没有限制，图片 / PDF / Office / 视频都行。想换文件版本只能重新上传——「编辑」只能改标题、描述、分类、标签和权限分值，改不了文件本身。",
      },
      {
        title: "给成员设权限分值（管理员）",
        when: "新人加入协同团队，或有人反馈「知识库里什么都看不到」时。",
        steps: [
          "点工具栏「成员权限」。",
          "在名单里找到这个人（可按姓名、账号、部门搜）。",
          "填 0~100 的分值，参考下方「权限分值档位」表。",
          "保存。改动最长 1 分钟内生效。",
        ],
        note: "没登记的成员按 0 分算，只能看到完全公开的文件。这是最常见的「我看不到文件」原因。",
      },
      {
        title: "找一份资料",
        steps: [
          "先用左侧知识域缩小范围（选父类目会自动包含它的子类目）。",
          "在关键词框输入标题或标签里的词。",
          "还是太多就用「全部类型」按文件类型过滤。",
          "点标题或封面上的眼睛图标预览；点下载图标存到本地。",
        ],
        note: "搜不到不一定是没有——搜索只匹配标题、描述、标签，文件名和正文都不参与。也可能是这份文件的权限分值高于你。",
      },
      {
        title: "整理知识域",
        steps: [
          "点「知识域」标题栏的「+」建一级类目，或在类目行上点文件夹图标建子类目（最多两层）。",
          "可以给类目挑图标和颜色，方便一眼认出。",
          "要删或改一个类目，得先把里面的文件全部「移动」走——鼠标移到文件卡片上，点移动图标选新类目。",
          "类目空了以后，删除和编辑按钮才可用。",
        ],
        note: "有文件的类目既不能删也不能改名，按钮是灰的。这是防误删的设计——文件不会跟着类目消失。「其他」是默认类目，永远删不掉。",
      },
    ],
    deepDives: [
      {
        title: "上传文件弹窗",
        entry: "工具栏点「上传文件」，或把文件直接拖到知识库页面。",
        shot: "kb-upload",
        points: [
          { n: 1, title: "选择文件", body: "点击虚线区域选择文件，或把一个或多个文件拖进来。选中文件后，这里会变成上传队列，并显示每个文件的名称和大小。" },
          { n: 2, title: "知识库分类", body: "分类是必填项。系统可能根据文件名和内容给出 AI 推荐，但上传前仍应确认资料放到了正确的知识域。" },
          { n: 3, title: "访问权限分值", body: "管理员可设置 0~100；成员分值必须不低于该值才能看到文件。普通成员上传时固定为 0，即完全公开。" },
          { n: 4, title: "确认上传", body: "按钮会在已选择文件且分类有效后可用。多个文件会共用本弹窗里的分类、描述、标签和权限分值。" },
        ],
        note: "上传前特别检查权限分值。文件一旦上传，虽然可以再编辑标题和权限，但无法在原记录上替换文件内容。",
      },
      {
        title: "成员权限分值弹窗（管理员）",
        entry: "工具栏点「成员权限」。只有库管理员看得到这个按钮。",
        shot: "kb-member-levels",
        points: [
          { n: 1, title: "规则说明", body: "弹窗顶部就写着判定规则，和本手册一致：成员只看得到分值不高于自己的文件；未配置按 0 处理；库管理员不受限。" },
          { n: 2, title: "搜人", body: "按姓名、账号或部门搜。名单里是全部未停用的账号，不限于协同成员。" },
          { n: 3, title: "填分值", body: "每人一个 0~100 的输入框，参考下方「权限分值档位」表。改完点保存，最长 1 分钟内生效。" },
        ],
        note: "只有分值大于 0 的成员会被保存——填 0 等同于不配置。这个界面叫「成员权限分值」，但里面的说明文字用的是「密级分值」，弹窗外的筛选器又叫「权限分」，指的都是同一个东西。",
      },
    ],
    tables: [
      {
        title: "权限分值档位",
        intro: "分值 0~100，滑块每 5 分一档。颜色是界面上盾牌角标的颜色。",
        columns: ["分值", "档位", "适合放什么"],
        rows: [
          ["0 ~ 25", "公开（绿）", "对全组无保留的资料：公开清单、对外规范、流程说明。0 分＝完全公开。"],
          ["26 ~ 50", "内部（蓝）", "组内周知但不外传：例会纪要、内部进度、工作草稿。"],
          ["51 ~ 75", "受限（琥珀）", "只给相关角色：设计规格、测试原始数据、供应商信息。"],
          ["76 ~ 100", "机密（红）", "只给负责人：成本结构、报价、合同条款。"],
        ],
      },
      {
        title: "谁能看到 / 改动什么",
        intro: "「看得到」的判定只有一条：本人分值 ≥ 文件分值。",
        columns: ["角色", "看文件", "设文件权限分值", "设成员分值", "管理知识域"],
        rows: [
          ["库管理员", "全部，不受权限限制", "可以", "可以", "可以"],
          ["普通成员（已登记分值）", "分值 ≤ 本人分值的文件", "不能（上传一律 0 分）", "不能", "看权限配置"],
          ["普通成员（未登记）", "只有 0 分的完全公开文件", "不能", "不能", "看权限配置"],
        ],
      },
      {
        title: "哪些文件能在线预览",
        intro: "不支持预览的类型仍可下载。解析都在你的浏览器本地完成，文件不会发给第三方。",
        columns: ["能预览", "只能下载"],
        rows: [
          [
            "图片（jpg/png/gif/webp/svg/bmp）、PDF、视频（mp4/mov/webm）、Word（doc/docx）、表格（xlsx/xls/csv，可切 sheet）、文本（txt/md/json/xml/yaml/log）、网页（html）",
            "PPT（ppt/pptx）、压缩包，以及其他未列出的格式",
          ],
        ],
      },
    ],
    faqs: [
      {
        q: "我能打开知识库，但一个文件都看不到？",
        a: "多半是管理员还没给你登记权限分值——未登记按 0 分算，只能看到完全公开的文件。找库管理员在「成员权限」里给你设一个分值即可。",
      },
      {
        q: "为什么 AI 对话里找不到知识库的文件？",
        a: "协同库只有 0 分（完全公开）的文件才会进 AI 检索索引，设了权限分值（>0）的文件 AI 永远检索不到——这是有意为之的安全设计，防止 AI 绕过权限分值把内容透出去。想让 AI 能引用，就把文件设为 0 分。另外 AI 只索引标题、描述、标签，不索引文件正文。",
      },
      {
        q: "为什么这个分类删不掉？",
        a: "类目里还有文件（包括子类目里的）。先把文件逐个「移动」到别的类目，类目空了按钮就亮了。「其他」是系统默认类目，任何情况下都删不掉。",
      },
      {
        q: "「同步」按钮是干什么的？",
        a: "就是刷新列表，重新拉一遍类目和文件，并保留你当前的筛选条件。别人刚传了文件、或管理员刚调了你的分值，点它即可。它和 AI 索引无关——索引是文件增改时自动更新的。",
      },
      {
        q: "预览打不开，提示文件加载失败？",
        a: "老文件的访问链接有 30 天有效期，过期了刷新一下页面重新获取即可。如果是 PPT，本来就不支持在线预览，下载后打开。",
      },
      {
        q: "怎么加一个网页链接到知识库？",
        a: "当前页面只支持上传文件，还不能在界面上新建链接型条目。已有的链接条目（图标是锁链）可以正常打开。",
      },
    ],
    tips: [
      "权限分值过滤在列表和详情两处都拦——就算别人把链接发给你，超出你分值的文件也打不开（会提示条目不存在）。",
      "删除是永久的：文件数据会被移除，相关链接同步失效，无法恢复。",
      "改权限分值、删除、编辑都会写进操作留痕，权限分值的改动会逐字段记录改前改后。",
      "列表每页 24 条；任何筛选变化或刷新都会跳回第 1 页。",
      "文件卡片和预览弹窗底部能看到浏览次数和下载次数。",
    ],
  },
];

function SectionHeading({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-3">
      <HorizonSectionHeader title={title} description={desc} />
    </div>
  );
}

function ManualShotImage({ shot, lang, alt }: { shot: string; lang: I18nLang; alt: string }) {
  const markers = lang === "en" ? (EN_SHOT_MARKERS[shot] ?? []) : [];
  return (
    <span className="relative block">
      <img
        src={manualShotSrc(shot, lang)}
        alt={alt}
        width={1280}
        height={720}
        className="block h-auto w-full cursor-zoom-in"
        loading="lazy"
      />
      {markers.map((marker) => (
        <span
          key={marker.n}
          data-manual-marker={marker.n}
          aria-hidden
          className="pointer-events-none absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-rose-600 text-xs font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.35)]"
          style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
        >
          {marker.n}
        </span>
      ))}
    </span>
  );
}

function TopicIndexCard({ topic }: { topic: ManualTopic }) {
  const Icon = topic.icon;
  return (
    <Link
      to={`${routePath("page:manual", "/manual")}/${topic.id}`}
      className="group flex min-h-56 min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-[#002fa7]/35 hover:bg-[#f8faff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30 focus-visible:ring-offset-2"
    >
      <div className="flex min-w-0 items-start justify-between gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#eef3ff] text-[#002fa7]" aria-hidden="true">
          <Icon className="size-5" />
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">
          {t(topic.navLabel)}
        </span>
      </div>
      <div className="mt-5 min-w-0 flex-1">
        <h3 className="text-balance text-xl font-semibold leading-7 text-slate-950">{t(topic.title)}</h3>
        <p className="mt-2 text-pretty text-sm leading-6 text-slate-600">{t(topic.summary)}</p>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <span className="text-xs text-slate-500">
          {t("{points} 个导览点 · {steps} 个操作流程", {
            points: topic.points.length,
            steps: topic.howTos?.length ?? 0,
          })}
        </span>
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#002fa7]">
          <BookOpen className="size-4" aria-hidden="true" />
          {t("查看手册")}
        </span>
      </div>
    </Link>
  );
}

export function ManualPage() {
  useI18n();
  const pageRef = useResetPageScroll<HTMLDivElement>();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredTopics = normalizedQuery
    ? TOPICS.filter((topic) => {
        const searchable = [
          topic.navLabel,
          topic.title,
          topic.summary,
          topic.purpose,
          ...(topic.audience ?? []),
          ...topic.points.flatMap((point) => [point.title, point.body]),
          ...(topic.howTos ?? []).flatMap((guide) => [guide.title, guide.when ?? "", ...guide.steps, guide.note ?? ""]),
          ...(topic.deepDives ?? []).flatMap((detail) => [
            detail.title,
            detail.entry,
            detail.note ?? "",
            ...detail.points.flatMap((point) => [point.title, point.body]),
          ]),
          ...(topic.tables ?? []).flatMap((table) => [table.title, table.intro ?? "", ...table.columns, ...table.rows.flat()]),
          ...(topic.faqs ?? []).flatMap((faq) => [faq.q, faq.a]),
          ...(topic.tips ?? []),
        ];
        return searchable.some((value) => t(value).toLocaleLowerCase().includes(normalizedQuery));
      })
    : TOPICS;
  const guideCount = TOPICS.reduce((total, topic) => total + (topic.howTos?.length ?? 0), 0);
  const mediaCount = TOPICS.reduce((total, topic) => total + 1 + (topic.deepDives?.length ?? 0), 0);
  const referenceCount = TOPICS.reduce(
    (total, topic) => total + (topic.tables ?? []).reduce((rows, table) => rows + table.rows.length, 0),
    0,
  );

  return (
    <div ref={pageRef} className="horizon-theme hz-page mx-auto w-full max-w-[1680px]">
      <HorizonPageHeader
        Icon={BookOpen}
        eyebrow={t("系统指南")}
        title={t("操作手册")}
        description={t("按页面定位操作流程、权限边界与常见问题；截图来自真实界面，并随语言切换。")}
        meta={
          <>
            <span>{t("适用范围：中美协同")}</span>
            <span>{t("内容与实际业务数据隔离")}</span>
          </>
        }
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={Layers3} label={t("手册主题")} value={TOPICS.length} note={t("覆盖当前协同核心入口")} tone="brand" />
        <HorizonMetric Icon={ListChecks} label={t("操作流程")} value={guideCount} note={t("按任务逐步执行")} tone="success" />
        <HorizonMetric Icon={Images} label={t("真实界面图")} value={mediaCount} note={t("支持点击放大预览")} tone="neutral" />
        <HorizonMetric Icon={TableProperties} label={t("速查条目")} value={referenceCount} note={t("状态、权限与规则")} tone="warning" />
      </HorizonMetricGrid>

      <section className="hz-panel overflow-hidden">
        <HorizonSectionHeader
          Icon={Search}
          title={t("查找手册")}
          description={t("搜索页面名称、操作步骤、权限说明或常见问题。")}
          trailing={<span className="text-xs text-slate-500 tabular-nums">{t("{shown} / {total} 个主题", { shown: filteredTopics.length, total: TOPICS.length })}</span>}
        />
        <div className="border-t border-slate-100 p-4 sm:p-5">
          <label htmlFor="manual-topic-search" className="sr-only">{t("搜索操作手册")}</label>
          <div className="relative max-w-2xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              id="manual-topic-search"
              name="manual-topic-search"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("例如：批量转派、权限分值、上传文件…")}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-10 text-sm text-slate-800 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus-visible:border-[#002fa7] focus-visible:ring-2 focus-visible:ring-[#002fa7]/15"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("清除搜索")}
                className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/25"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="manual-topics-heading">
        <div id="manual-topics-heading">
          <HorizonSectionHeader
            Icon={BookOpen}
            title={t("中美协同手册")}
            description={t("美国团队使用、中国研发团队支持；任务、人员与资料和研发模块完全隔离。")}
          />
        </div>
        {filteredTopics.length > 0 ? (
          <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {filteredTopics.map((topic) => <TopicIndexCard key={topic.id} topic={topic} />)}
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white">
            <HorizonEmptyState
              Icon={Search}
              title={t("没有匹配的手册主题")}
              description={t("换一个页面名称、业务动作或权限关键词，或清除当前搜索。")}
              action={
                <button type="button" onClick={() => setQuery("")} className="hz-secondary-action">
                  <X className="size-4" aria-hidden="true" />
                  {t("清除搜索")}
                </button>
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}

export function ManualTopicPage() {
  const { lang } = useI18n();
  const { topicId } = useParams();
  const pageRef = useResetPageScroll<HTMLDivElement>();
  const topic = TOPICS.find((item) => item.id === topicId);

  if (!topic) return <Navigate to={routePath("page:manual", "/manual")} replace />;

  const shotSrc = manualShotSrc(topic.shot, lang);

  return (
    <div ref={pageRef} className="horizon-theme hz-page mx-auto w-full max-w-[1680px]">
      <HorizonPageHeader
        Icon={topic.icon}
        eyebrow={t("中美协同 · 操作手册")}
        title={t(topic.title)}
        description={t(topic.summary)}
        meta={
          <>
            <span>{t("侧边栏入口")}：{t("中美协同")} › {t(topic.navLabel)}</span>
            <span className="tabular-nums">{t("{points} 个导览点", { points: topic.points.length })}</span>
            <span className="tabular-nums">{t("{steps} 个操作流程", { steps: topic.howTos?.length ?? 0 })}</span>
            <span className="tabular-nums">{t("{references} 组快捷参考", { references: topic.tables?.length ?? 0 })}</span>
          </>
        }
        actions={
          <Link
            to={routePath("page:manual", "/manual")}
            aria-label={t("返回操作手册索引")}
            title={t("返回操作手册索引")}
            className="hz-secondary-action flex size-9 items-center justify-center p-0"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
        }
      />

      {/* 页内导航：单页很长，原生 hash 与既有 section id 保持可深链。 */}
      <nav aria-label={t("本页目录")} className="hz-panel flex min-w-0 flex-wrap items-center gap-2 p-3 sm:p-4">
        <span className="mr-1 text-xs font-semibold text-slate-500">{t("本页目录")}</span>
          {[
            { id: "tour", label: "界面导览" },
            ...(topic.howTos?.length ? [{ id: "howto", label: "常见操作" }] : []),
            ...(topic.deepDives?.length ? [{ id: "deep", label: "深入：点开之后" }] : []),
            ...(topic.tables?.length ? [{ id: "tables", label: "概念速查" }] : []),
            ...(topic.faqs?.length ? [{ id: "faq", label: "常见问题" }] : []),
          ].map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-[#002fa7]/30 hover:bg-[#eef3ff] hover:text-[#002fa7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/25"
            >
              {t(item.label)}
            </a>
          ))}
          <Link to={routePath("page:manual", "/manual")} className="hz-primary-action ml-auto shrink-0 text-xs">
            {t("其他页面")}
          </Link>
      </nav>

      <div className="space-y-6">
        {/* 页面定位：先说清「这页是干嘛的」，避免驾驶舱/工作台被用混 */}
        <div className="rounded border border-blue-100 bg-blue-50/60 px-4 py-3.5">
          <p className="text-sm leading-6 text-blue-900">{t(topic.purpose)}</p>
          {topic.audience?.length ? (
            <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
              {topic.audience.map((line) => (
                <li key={line} className="flex gap-2 text-sm leading-6 text-blue-800">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-blue-400" />
                  <span>{t(line)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* 整页截图 + 红色编号，与下方条目一一对应。
            图是 1600px 宽，塞进正文容器会缩到 ~75%，界面上的小字就糊了——
            故整图可点；移动端进入可缩放预览，桌面端仍在新标签页查看原图。 */}
        <figure className="space-y-1.5">
          <MobileImagePreviewLink
            src={shotSrc}
            alt={t(topic.title)}
            title={t(topic.title)}
            className="block overflow-hidden rounded-lg border border-slate-200 bg-slate-50 transition-colors hover:border-[#002fa7]/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/25"
          >
            <ManualShotImage shot={topic.shot} lang={lang} alt={t(topic.title)} />
          </MobileImagePreviewLink>
          <figcaption className="text-xs text-slate-400">{t("点击图片查看大图")}</figcaption>
        </figure>

        <section id="tour" className="scroll-mt-24">
        <SectionHeading title={t("界面导览")} desc={t("编号对应上图的红点。")} />
        <ol className="grid gap-3 lg:grid-cols-2">
          {topic.points.map((point) => (
            <li key={point.n} className="flex gap-3 rounded border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white">
                {point.n}
              </span>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-slate-900">{t(point.title)}</h4>
                <p className="mt-1 text-sm leading-6 text-slate-600">{t(point.body)}</p>
              </div>
            </li>
          ))}
        </ol>
        </section>

        {topic.howTos?.length ? (
          <section id="howto" className="scroll-mt-24">
            <SectionHeading title={t("常见操作")} desc={t("照着步骤做即可，每步都对应界面上的一个动作。")} />
            <div className="grid gap-3 xl:grid-cols-2">
              {topic.howTos.map((how) => (
                <div key={how.title} className="rounded border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <h4 className="text-sm font-semibold text-slate-900">{t(how.title)}</h4>
                  {how.when ? <p className="mt-1 text-xs leading-5 text-slate-500">{t(how.when)}</p> : null}
                  <ol className="mt-3 space-y-2">
                    {how.steps.map((step, i) => (
                      <li key={step} className="flex gap-2.5 text-sm leading-6 text-slate-700">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                          {i + 1}
                        </span>
                        <span className="min-w-0">{t(step)}</span>
                      </li>
                    ))}
                  </ol>
                  {how.note ? (
                    <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">{t(how.note)}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {topic.deepDives?.length ? (
          <section id="deep" className="space-y-6 scroll-mt-24">
            <SectionHeading title={t("深入：点开之后")} desc={t("弹窗和抽屉里的界面——你大部分时间都花在这儿。")} />
            {topic.deepDives.map((dive) => (
              <div key={dive.title} className="rounded border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <h4 className="text-sm font-semibold text-slate-900">{t(dive.title)}</h4>
                <p className="mt-1 text-xs leading-5 text-slate-500">{t("打开方式")}：{t(dive.entry)}</p>
                <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
                  <MobileImagePreviewLink
                    src={manualShotSrc(dive.shot, lang)}
                    alt={t(dive.title)}
                    title={t(dive.title)}
                    className="block overflow-hidden rounded-lg border border-slate-200 bg-slate-50 transition-colors hover:border-[#002fa7]/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/25"
                  >
                    <ManualShotImage shot={dive.shot} lang={lang} alt={t(dive.title)} />
                  </MobileImagePreviewLink>
                  <ol className="grid gap-2">
                    {dive.points.map((point) => (
                      // n=0 表示这张图没打编号（如整页详情页），退化成普通圆点，别显示个「0」
                      <li key={point.title} className="flex gap-2.5 rounded border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                        {point.n > 0 ? (
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 text-[11px] font-bold text-white">
                            {point.n}
                          </span>
                        ) : (
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                        )}
                        <div className="min-w-0">
                          <span className="text-sm font-semibold text-slate-900">{t(point.title)}</span>
                          <span className="text-sm leading-6 text-slate-600"> — {t(point.body)}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
                {dive.note ? (
                  <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">{t(dive.note)}</p>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {topic.tables?.length ? (
          <section id="tables" className="space-y-4 scroll-mt-24">
            <SectionHeading title={t("概念速查")} desc={t("界面上的徽标、状态和权限，对照这张表看。")} />
            {topic.tables.map((table) => (
              <div key={table.title}>
                <h4 className="text-sm font-semibold text-slate-900">{t(table.title)}</h4>
                {table.intro ? <p className="mt-1 text-xs leading-5 text-slate-500">{t(table.intro)}</p> : null}
                {/* 表格在窄屏自己横向滚动，不撑破页面 */}
                <div className="mt-2 overflow-x-auto rounded border border-slate-200">
                  <table className="w-full min-w-[520px] border-collapse text-left">
                    <caption className="sr-only">{t(table.title)}</caption>
                    <thead>
                      <tr className="bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                        {table.columns.map((col) => (
                          <th key={col} scope="col" className="border-b border-slate-200 px-3 py-2">{t(col)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row) => (
                        <tr key={row.join("|")} className="align-top">
                          {row.map((cell, i) => (
                            <td
                              key={i}
                              className={cn(
                                "border-b border-slate-100 px-3 py-2.5 text-sm leading-6",
                                i === 0 ? "font-semibold text-slate-900" : "text-slate-600",
                              )}
                            >
                              {t(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {topic.faqs?.length ? (
          <section id="faq" className="scroll-mt-24">
            <SectionHeading title={t("常见问题")} />
            <div className="grid gap-2.5 xl:grid-cols-2">
              {topic.faqs.map((faq) => (
                <div key={faq.q} className="rounded border border-slate-200 bg-slate-50/60 px-4 py-3">
                  <div className="text-sm font-semibold text-slate-900">{t(faq.q)}</div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{t(faq.a)}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {topic.tips?.length ? (
          <div className="rounded border border-amber-100 bg-amber-50/50 px-4 py-3.5">
            <div className="text-xs font-semibold uppercase text-amber-700">{t("提示")}</div>
            <ul className="mt-2 space-y-1.5">
              {topic.tips.map((tip) => (
                <li key={tip} className="flex gap-2 text-sm leading-6 text-amber-900">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                  <span>{t(tip)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ManualPage;
