import React, { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  Copy,
  Filter,
  Inbox,
  Mail,
  MessageCircle,
  Search,
  Send,
  Sparkles,
  User,
} from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "./lib/routePaths";

type Channel = "WhatsApp" | "Email" | "LinkedIn";
type Intent = "询价" | "型号咨询" | "认证资质" | "售后问题" | "合作意向";
type Tone = "正式" | "友好" | "强硬" | "委婉拒绝";
type Language = "中文" | "English" | "Español";

type Inquiry = {
  id: number;
  channel: Channel;
  sender: string;
  company: string;
  country: string;
  preview: string;
  fullMessage: string;
  timestamp: string;
  unread: boolean;
  intent: Intent;
  confidence: number;
  intentReason: string;
  priority: "高" | "中" | "低";
  nextAction: string;
  requiredInfo: { label: string; received: boolean }[];
};

const channelConfig: Record<Channel, { icon: LucideIcon; color: string; bg: string }> = {
  WhatsApp: { icon: MessageCircle, color: "text-emerald-700", bg: "bg-emerald-50" },
  Email: { icon: Mail, color: "text-[#002fa7]", bg: "bg-blue-50" },
  LinkedIn: { icon: User, color: "text-sky-700", bg: "bg-sky-50" },
};

const intentConfig: Record<Intent, string> = {
  询价: "border-orange-200 bg-orange-50 text-orange-700",
  型号咨询: "border-blue-200 bg-blue-50 text-[#002fa7]",
  认证资质: "border-cyan-200 bg-cyan-50 text-cyan-800",
  售后问题: "border-red-200 bg-red-50 text-red-700",
  合作意向: "border-teal-200 bg-teal-50 text-teal-800",
};

const mockInquiries: Inquiry[] = [
  {
    id: 1,
    channel: "WhatsApp",
    sender: "Carlos Mendez",
    company: "Ares Medical",
    country: "墨西哥",
    preview: "Interested in CPAP distribution and 500-unit pricing with CE/FDA support.",
    fullMessage: "Hello, we are interested in your CPAP devices for distribution in Mexico. Could you provide pricing for 500 units and share CE/FDA certification support? We also need your preferred delivery terms for a first order in May.",
    timestamp: "10:32",
    unread: true,
    intent: "合作意向",
    confidence: 92,
    intentReason: "同时出现分销合作、批量采购和资质请求，属于高价值合作线索。",
    priority: "高",
    nextAction: "补齐付款方式与首批交付周期",
    requiredInfo: [{ label: "目标国家", received: true }, { label: "年度采购量", received: false }, { label: "付款方式", received: false }, { label: "认证要求", received: true }],
  },
  {
    id: 2,
    channel: "Email",
    sender: "Ahmed Al-Rashid",
    company: "Riyadh Sleep Lab",
    country: "沙特",
    preview: "Requesting BiPAP specs, hospital pricing, and service coverage in Riyadh.",
    fullMessage: "Dear team, we are evaluating your BiPAP range for our sleep lab in Riyadh. Please provide detailed specifications, pricing for 50 units, and information about after-sales service in Saudi Arabia.",
    timestamp: "09:15",
    unread: true,
    intent: "询价",
    confidence: 88,
    intentReason: "医院采购场景明确，询价信息完整，但尚缺付款与决策周期信息。",
    priority: "高",
    nextAction: "发送报价单并补充服务网络说明",
    requiredInfo: [{ label: "目标国家", received: true }, { label: "使用场景", received: true }, { label: "付款方式", received: false }, { label: "交付时间", received: false }],
  },
  {
    id: 3,
    channel: "LinkedIn",
    sender: "Sophie Laurent",
    company: "MediNova France",
    country: "法国",
    preview: "Need CE MDR compliance pack for a France registration dossier.",
    fullMessage: "Bonjour, we are preparing a France registration dossier and need your CE MDR compliance pack for the CPAP family. Please share the latest declarations, IFU set, and intended use statement.",
    timestamp: "昨天",
    unread: false,
    intent: "认证资质",
    confidence: 95,
    intentReason: "问题聚焦注册材料，适合联动法规知识库与对外资料模块。",
    priority: "中",
    nextAction: "同步法规库条款并整理对外资料版本",
    requiredInfo: [{ label: "目标国家", received: true }, { label: "认证类型", received: true }, { label: "产品型号", received: false }, { label: "版本要求", received: false }],
  },
  {
    id: 4,
    channel: "WhatsApp",
    sender: "Priya Sharma",
    company: "Heal Plus",
    country: "印度",
    preview: "Three units show E3 error code and need warranty repair guidance.",
    fullMessage: "Hi, we purchased 20 units of your CPAP model X300 last year. Three units now show E3 and the humidifier stopped working. Please advise on warranty repair or replacement process.",
    timestamp: "昨天",
    unread: false,
    intent: "售后问题",
    confidence: 97,
    intentReason: "典型售后故障描述，建议直接转入售后工单流程。",
    priority: "高",
    nextAction: "创建售后工单并收集序列号",
    requiredInfo: [{ label: "设备型号", received: true }, { label: "购买日期", received: false }, { label: "故障描述", received: true }, { label: "序列号", received: false }],
  },
  {
    id: 5,
    channel: "Email",
    sender: "Thomas Weber",
    company: "NordCare GmbH",
    country: "德国",
    preview: "Comparing home-use CPAP models for German channel distribution.",
    fullMessage: "We would like to know which CPAP model is most suitable for home use in Germany. Please share a comparison chart and the available local compliance package for distributors.",
    timestamp: "2天前",
    unread: false,
    intent: "型号咨询",
    confidence: 85,
    intentReason: "以产品选择为主，后续可引导到对外资料版本和报价流程。",
    priority: "中",
    nextAction: "发送型号对比和家庭场景推荐",
    requiredInfo: [{ label: "目标国家", received: true }, { label: "使用场景", received: true }, { label: "年度采购量", received: false }, { label: "认证要求", received: false }],
  },
  {
    id: 6,
    channel: "Email",
    sender: "Lucia Gomez",
    company: "Clinica Vida",
    country: "西班牙",
    preview: "Checking available Spanish IFU versions and hospital tender timing.",
    fullMessage: "Hello, our hospital tender will open next month. We need to confirm whether Spanish IFU and labeling files are available for your current model family before we proceed.",
    timestamp: "3天前",
    unread: false,
    intent: "认证资质",
    confidence: 81,
    intentReason: "既有招标时点，也涉及多语言资料版本，适合转交资料版本模块。",
    priority: "中",
    nextAction: "核对西语资料版本并回复可供货窗口",
    requiredInfo: [{ label: "目标国家", received: true }, { label: "语言版本", received: true }, { label: "招标时间", received: true }, { label: "型号范围", received: false }],
  },
];

const replyTemplates: Record<Intent, Record<Language, string>> = {
  合作意向: {
    中文: "尊敬的合作伙伴，\n\n感谢您对 INOGI 产品的关注。我们很高兴了解贵司在墨西哥推进分销合作的意向。为便于我们准备报价与资质资料，请进一步确认年度采购量、首批交期及付款方式。\n\n如您方便，我们可以在 24 小时内发送首轮资料包与建议方案。\n\n此致\nINOGI 海外销售团队",
    English: "Dear Partner,\n\nThank you for your interest in INOGI products. We are pleased to learn about your distribution plan for Mexico. To prepare a tailored quotation and compliance pack, could you please confirm the annual purchase volume, first shipment timing, and preferred payment terms?\n\nWe can share the first-round material pack within 24 hours.\n\nBest regards,\nINOGI Overseas Sales Team",
    Español: "Estimado socio,\n\nGracias por su interés en los productos de INOGI. Nos alegra conocer su intención de distribución en México. Para preparar una cotización y un paquete de cumplimiento, por favor confirme el volumen anual, el plazo del primer embarque y las condiciones de pago preferidas.\n\nPodemos enviar el primer paquete de materiales dentro de 24 horas.\n\nAtentamente,\nEquipo Comercial Internacional de INOGI",
  },
  询价: {
    中文: "您好，\n\n感谢您关于 BiPAP 设备的询价。我们已整理适用于医院睡眠实验室场景的产品规格、报价范围和售后网络说明。若您确认采购时间与付款方式，我们将同步正式报价单与服务承诺说明。\n\n祝好\nINOGI 销售团队",
    English: "Dear Customer,\n\nThank you for your inquiry regarding our BiPAP range. We have prepared the specification pack, pricing guidance, and after-sales coverage summary for hospital sleep lab use. Once you confirm the purchasing timeline and payment terms, we will issue a formal quotation.\n\nBest regards,\nINOGI Sales Team",
    Español: "Estimado cliente,\n\nGracias por su consulta sobre nuestra línea de equipos BiPAP. Hemos preparado las especificaciones, el rango de precios y el resumen de servicio posventa para uso hospitalario. Una vez que confirme el calendario de compra y las condiciones de pago, emitiremos la cotización formal.\n\nAtentamente,\nEquipo de Ventas INOGI",
  },
  型号咨询: { 中文: "您好，我们会根据家庭使用场景为您推荐适合德国市场的 CPAP 型号，并附上功能对比与资料版本说明。", English: "Hello, we will recommend the most suitable CPAP model for home use in Germany and attach a comparison sheet with available compliance materials.", Español: "Hola, recomendaremos el modelo CPAP más adecuado para uso doméstico en Alemania e incluiremos una comparativa con los materiales de cumplimiento disponibles." },
  认证资质: { 中文: "您好，针对贵司的注册或招标用途，我们会整理最新的合规资料包，并说明适用版本与补件路径。", English: "Hello, for your registration or tender preparation, we will compile the latest compliance package and clarify the applicable versions and follow-up steps.", Español: "Hola, para su proceso de registro o licitación, prepararemos el paquete de cumplimiento más reciente e indicaremos la versión aplicable y los siguientes pasos." },
  售后问题: { 中文: "您好，已收到设备故障反馈。建议先提供设备序列号、购买日期和故障照片，我们会同步售后工单并安排技术支持。", English: "Hello, we have received the fault report. Please share the serial number, purchase date, and fault photos so that we can open an after-sales ticket and arrange support.", Español: "Hola, hemos recibido el reporte de falla. Por favor comparta el número de serie, la fecha de compra y fotos del problema para abrir un caso de posventa y coordinar soporte técnico." },
};

const pageSize = 4;
const selectClassName = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus-visible:border-[#002fa7] focus-visible:ring-2 focus-visible:ring-[#002fa7]/20";

export function InquiryPage() {
  const [selectedId, setSelectedId] = useState<number>(mockInquiries[0].id);
  const [lang, setLang] = useState<Language>("中文");
  const [tone, setTone] = useState<Tone>("友好");
  const [channelFilter, setChannelFilter] = useState<Channel | "全部">("全部");
  const [intentFilter, setIntentFilter] = useState<Intent | "全部">("全部");
  const [keyword, setKeyword] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [checkedInfo, setCheckedInfo] = useState<Record<string, boolean>>({});
  const [crmOpen, setCrmOpen] = useState(false);

  const filteredInquiries = useMemo(() => mockInquiries.filter((item) => {
    const matchChannel = channelFilter === "全部" || item.channel === channelFilter;
    const matchIntent = intentFilter === "全部" || item.intent === intentFilter;
    const matchKeyword = !keyword.trim() || [item.sender, item.company, item.country, item.preview, item.fullMessage].join(" ").toLowerCase().includes(keyword.toLowerCase());
    return matchChannel && matchIntent && matchKeyword;
  }), [channelFilter, intentFilter, keyword]);

  const totalPages = Math.max(1, Math.ceil(filteredInquiries.length / pageSize));
  const pagedInquiries = filteredInquiries.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selected = filteredInquiries.find((item) => item.id === selectedId) ?? filteredInquiries[0] ?? mockInquiries[0];
  const replyText = replyTemplates[selected.intent][lang];
  const stats = useMemo(() => ({
    unread: mockInquiries.filter((item) => item.unread).length,
    highPriority: mockInquiries.filter((item) => item.priority === "高").length,
    certification: mockInquiries.filter((item) => item.intent === "认证资质").length,
  }), []);

  const handleSelectInquiry = (id: number) => { setSelectedId(id); setCheckedInfo({}); };
  const handleFilterReset = () => { setKeyword(""); setChannelFilter("全部"); setIntentFilter("全部"); setCurrentPage(1); };
  const handleNextStep = () => {
    if (selected.intent === "售后问题") { toast.success("已生成售后线索，建议继续进入售后工单。"); return; }
    toast.success(`已将 ${selected.sender} 的询盘加入跟进队列。`);
  };

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full max-w-[1600px] min-w-0 flex-col gap-4 px-3 py-4 sm:p-5 lg:p-6">
      <HorizonPageHeader
        Icon={Inbox}
        eyebrow="客户运营 · 询盘工作台"
        title="海外询盘与商机"
        description="聚合多渠道询盘，完成意图识别、补件核查、回复与后续业务流转。"
        meta={<><span>WhatsApp / Email / LinkedIn</span><span aria-hidden="true">·</span><span>{stats.unread} 条未读</span></>}
        actions={<><Button asChild variant="outline"><Link to={routePath("page:email-ai", "/email-ai")}><Mail className="size-4" />邮件 AI</Link></Button><Button type="button" className="hz-primary-action" onClick={() => setCrmOpen(true)}><BriefcaseBusiness className="size-4" />同步 CRM</Button></>}
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={Inbox} label="全部询盘" value={mockInquiries.length} note="3 个客户触达渠道" tone="brand" />
        <HorizonMetric Icon={Mail} label="未读" value={stats.unread} note="需要完成首次响应" tone="warning" />
        <HorizonMetric Icon={Sparkles} label="高优先级" value={stats.highPriority} note="采购或售后紧急线索" tone="danger" />
        <HorizonMetric Icon={BriefcaseBusiness} label="资质咨询" value={stats.certification} note="可联动法规与资料模块" tone="success" />
      </HorizonMetricGrid>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader Icon={Filter} title="渠道与询盘队列" description="按来源、意图和客户关键词筛选。" trailing={<span className="text-xs text-slate-500 tabular-nums">{filteredInquiries.length} 条</span>} />
          <div className="hz-toolbar space-y-3 border-b p-3">
            <div className="space-y-2"><Label htmlFor="inquiry-search">搜索询盘</Label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" /><Input id="inquiry-search" type="search" value={keyword} onChange={(event) => { setKeyword(event.target.value); setCurrentPage(1); }} placeholder="客户、公司、国家或正文" className="h-10 rounded-xl bg-white pl-9" /></div></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="space-y-2"><Label htmlFor="inquiry-channel">渠道</Label><select id="inquiry-channel" value={channelFilter} onChange={(event) => { setChannelFilter(event.target.value as Channel | "全部"); setCurrentPage(1); }} className={selectClassName}>{["全部", "WhatsApp", "Email", "LinkedIn"].map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
              <div className="space-y-2"><Label htmlFor="inquiry-intent">意图</Label><select id="inquiry-intent" value={intentFilter} onChange={(event) => { setIntentFilter(event.target.value as Intent | "全部"); setCurrentPage(1); }} className={selectClassName}>{["全部", "询价", "型号咨询", "认证资质", "售后问题", "合作意向"].map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={handleFilterReset}>清空筛选</Button>
          </div>

          {pagedInquiries.length > 0 ? <ul className="max-h-[620px] divide-y divide-slate-100 overflow-y-auto" aria-label="询盘列表">{pagedInquiries.map((inq) => { const Icon = channelConfig[inq.channel].icon; return <li key={inq.id}><button type="button" aria-pressed={selected.id === inq.id} onClick={() => handleSelectInquiry(inq.id)} className={cn("w-full min-w-0 px-4 py-3 text-left transition-colors hover:bg-[#f7f9ff]", selected.id === inq.id && "border-l-2 border-[#002fa7] bg-blue-50/60 pl-[14px]")}><div className="flex items-start gap-3"><span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg", channelConfig[inq.channel].bg)} aria-hidden="true"><Icon className={cn("size-4", channelConfig[inq.channel].color)} /></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-slate-800">{inq.sender}</span><time className="shrink-0 text-xs text-slate-500 tabular-nums">{inq.timestamp}</time></span><span className="mt-0.5 block truncate text-xs text-slate-500">{inq.company} · {inq.country}</span><span className="mt-2 line-clamp-2 block text-xs text-pretty leading-5 text-slate-600">{inq.preview}</span><span className="mt-2 flex flex-wrap gap-1.5"><span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", intentConfig[inq.intent])}>{inq.intent}</span>{inq.unread ? <span className="rounded-full border border-red-100 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">未读</span> : null}<span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{inq.priority}优先级</span></span></span></div></button></li>; })}</ul> : <HorizonEmptyState Icon={Search} title="没有匹配询盘" description="调整搜索条件或恢复全部询盘。" action={<Button type="button" variant="outline" onClick={handleFilterReset}>清除筛选</Button>} />}

          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3"><span className="text-xs text-slate-500 tabular-nums">第 {currentPage} / {totalPages} 页</span><div className="flex gap-2"><Button type="button" variant="outline" size="icon" aria-label="上一页询盘" disabled={currentPage === 1} onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}><ChevronLeft className="size-4" /></Button><Button type="button" variant="outline" size="icon" aria-label="下一页询盘" disabled={currentPage === totalPages} onClick={() => setCurrentPage((value) => Math.min(totalPages, value + 1))}><ChevronRight className="size-4" /></Button></div></div>
        </aside>

        <main className="min-w-0 space-y-4">
          <section className="hz-surface min-w-0 overflow-hidden">
            <HorizonSectionHeader Icon={MessageCircle} title="当前会话与商机" description={`${selected.company} · ${selected.country} · ${selected.timestamp}`} trailing={<div className="flex flex-wrap gap-2"><span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", intentConfig[selected.intent])}>{selected.intent}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{selected.channel}</span></div>} />
            <div className="p-4 sm:p-5"><h1 className="text-balance text-xl font-bold text-slate-900">{selected.sender}</h1><p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-pretty leading-7 text-slate-700">{selected.fullMessage}</p><dl className="mt-4 grid gap-px overflow-hidden rounded-xl bg-slate-100 sm:grid-cols-3"><div className="bg-white p-3"><dt className="text-xs text-slate-500">AI 置信度</dt><dd className="mt-1 text-lg font-semibold text-[#002fa7] tabular-nums">{selected.confidence}%</dd><p className="mt-1 text-xs text-pretty text-slate-600">{selected.intentReason}</p></div><div className="bg-white p-3"><dt className="text-xs text-slate-500">下一步</dt><dd className="mt-1 text-sm font-semibold text-slate-800">{selected.nextAction}</dd><p className="mt-1 text-xs text-slate-600">建议 4 小时内完成首轮反馈</p></div><div className="bg-white p-3"><dt className="text-xs text-slate-500">业务流转</dt><dd className="mt-2 flex flex-wrap gap-2"><Button asChild variant="outline" size="sm"><Link to={routePath("page:email-ai", "/email-ai")}>邮件写作</Link></Button><Button asChild variant="outline" size="sm"><Link to={selected.intent === "售后问题" ? routePath("page:after-sales", "/after-sales") : routePath("page:external-docs", "/external-docs")}>{selected.intent === "售后问题" ? "转售后工单" : "资料版本"}</Link></Button></dd></div></dl></div>
          </section>

          <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <section className="hz-surface min-w-0 overflow-hidden">
              <HorizonSectionHeader Icon={Sparkles} title="意图分析与补件" description="确认线索信息，再进入 CRM 或后续跟进。" />
              <div className="divide-y divide-slate-100 px-4">{selected.requiredInfo.map((item) => { const checked = checkedInfo[item.label] ?? item.received; const id = `inquiry-info-${selected.id}-${item.label}`; return <div key={item.label} className="flex items-center justify-between gap-3 py-3"><div className="flex items-center gap-3"><Checkbox id={id} checked={checked} onCheckedChange={() => setCheckedInfo((value) => ({ ...value, [item.label]: !checked }))} /><Label htmlFor={id} className={cn("cursor-pointer text-sm", checked ? "text-slate-400 line-through" : "text-slate-700")}>{item.label}</Label></div><span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", checked ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>{checked ? "已确认" : "待补充"}</span></div>; })}</div>
              <div className="flex flex-wrap gap-2 border-t border-slate-100 p-4"><Button type="button" className="bg-[#002fa7] hover:bg-[#002581]" onClick={() => setCrmOpen(true)}>同步 CRM 台账</Button><Button type="button" variant="outline" onClick={handleNextStep}>加入跟进队列</Button></div>
            </section>

            <section className="hz-surface min-w-0 overflow-hidden">
              <HorizonSectionHeader Icon={Bot} title="AI 回复草稿" description="切换语言和语气后复制、润色或发送。" />
              <div className="space-y-4 p-4">
                <fieldset><legend className="text-xs font-semibold text-slate-600">回复语言</legend><div className="mt-2 flex flex-wrap gap-2">{(["中文", "English", "Español"] as const).map((item) => <Button key={item} type="button" size="sm" variant={lang === item ? "default" : "outline"} aria-pressed={lang === item} className={cn(lang === item && "bg-[#002fa7] hover:bg-[#002581]")} onClick={() => setLang(item)}>{item}</Button>)}</div></fieldset>
                <fieldset><legend className="text-xs font-semibold text-slate-600">沟通语气</legend><div className="mt-2 flex flex-wrap gap-2">{(["正式", "友好", "强硬", "委婉拒绝"] as const).map((item) => <Button key={item} type="button" size="sm" variant={tone === item ? "default" : "outline"} aria-pressed={tone === item} className={cn(tone === item && "bg-[#002fa7] hover:bg-[#002581]")} onClick={() => setTone(item)}>{item}</Button>)}</div></fieldset>
                <div className="space-y-2"><Label htmlFor="inquiry-reply">回复内容</Label><Textarea id="inquiry-reply" readOnly value={`${replyText}\n\n[当前语气：${tone}]`} className="min-h-64 rounded-xl bg-slate-50 text-sm leading-7" /></div>
                <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => { navigator.clipboard.writeText(replyText); toast.success("回复草稿已复制。"); }}><Copy className="size-4" />复制</Button><Button type="button" variant="outline" onClick={() => toast.success("已推送到邮件 AI 写作页继续润色。")}><Mail className="size-4" />深度润色</Button><Button type="button" className="ml-auto bg-[#002fa7] hover:bg-[#002581]" onClick={() => toast.success("已发送演示回复。")}><Send className="size-4" />发送回复</Button></div>
              </div>
            </section>
          </div>
        </main>
      </div>

      <Dialog open={crmOpen} onOpenChange={setCrmOpen}>
        <DialogContent className="horizon-portal sm:max-w-2xl">
          <DialogHeader><DialogTitle className="text-balance text-slate-900">同步 CRM 台账</DialogTitle><DialogDescription className="text-pretty">将当前询盘登记为销售线索，保留跟进阶段与补件状态。</DialogDescription></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">{[{ label: "客户", value: selected.sender }, { label: "公司", value: selected.company }, { label: "国家", value: selected.country }, { label: "需求类型", value: selected.intent }, { label: "优先级", value: selected.priority }, { label: "下一步", value: selected.nextAction }].map((item, index) => { const id = `crm-field-${index}`; return <div key={item.label} className="space-y-2"><Label htmlFor={id}>{item.label}</Label><Input id={id} name={`crm-${index}`} defaultValue={item.value} className="h-10 rounded-xl" /></div>; })}</div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setCrmOpen(false)}>取消</Button><Button type="button" className="bg-[#002fa7] hover:bg-[#002581]" onClick={() => { setCrmOpen(false); toast.success("CRM 线索已创建。"); }}>保存线索</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
