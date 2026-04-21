import React, { useMemo, useState } from "react";
import {
  Bot,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Copy,
  Mail,
  MessageCircle,
  Send,
  Sparkles,
  Square,
  User,
} from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

type Channel = "WhatsApp" | "Email" | "LinkedIn";
type Intent = "询价" | "型号咨询" | "认证资质" | "售后问题" | "合作意向";
type Tone = "正式" | "友好" | "强硬" | "委婉拒绝";

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

const channelConfig: Record<Channel, { icon: React.ComponentType<{ className?: string }>; color: string; bg: string }> = {
  WhatsApp: { icon: MessageCircle, color: "text-green-600", bg: "bg-green-50" },
  Email: { icon: Mail, color: "text-blue-600", bg: "bg-blue-50" },
  LinkedIn: { icon: User, color: "text-indigo-700", bg: "bg-indigo-50" },
};

const intentConfig: Record<Intent, string> = {
  询价: "bg-orange-100 text-orange-700",
  型号咨询: "bg-blue-100 text-blue-700",
  认证资质: "bg-purple-100 text-purple-700",
  售后问题: "bg-red-100 text-red-700",
  合作意向: "bg-teal-100 text-teal-700",
};

const mockInquiries: Inquiry[] = [
  {
    id: 1,
    channel: "WhatsApp",
    sender: "Carlos Mendez",
    company: "Ares Medical",
    country: "墨西哥",
    preview: "Interested in CPAP distribution and 500-unit pricing with CE/FDA support.",
    fullMessage:
      "Hello, we are interested in your CPAP devices for distribution in Mexico. Could you provide pricing for 500 units and share CE/FDA certification support? We also need your preferred delivery terms for a first order in May.",
    timestamp: "10:32",
    unread: true,
    intent: "合作意向",
    confidence: 92,
    intentReason: "同时出现分销合作、批量采购和资质请求，属于高价值合作线索。",
    priority: "高",
    nextAction: "补齐付款方式与首批交付周期",
    requiredInfo: [
      { label: "目标国家", received: true },
      { label: "年度采购量", received: false },
      { label: "付款方式", received: false },
      { label: "认证要求", received: true },
    ],
  },
  {
    id: 2,
    channel: "Email",
    sender: "Ahmed Al-Rashid",
    company: "Riyadh Sleep Lab",
    country: "沙特",
    preview: "Requesting BiPAP specs, hospital pricing, and service coverage in Riyadh.",
    fullMessage:
      "Dear team, we are evaluating your BiPAP range for our sleep lab in Riyadh. Please provide detailed specifications, pricing for 50 units, and information about after-sales service in Saudi Arabia.",
    timestamp: "09:15",
    unread: true,
    intent: "询价",
    confidence: 88,
    intentReason: "医院采购场景明确，询价信息完整，但尚缺付款与决策周期信息。",
    priority: "高",
    nextAction: "发送报价单并补充服务网络说明",
    requiredInfo: [
      { label: "目标国家", received: true },
      { label: "使用场景", received: true },
      { label: "付款方式", received: false },
      { label: "交付时间", received: false },
    ],
  },
  {
    id: 3,
    channel: "LinkedIn",
    sender: "Sophie Laurent",
    company: "MediNova France",
    country: "法国",
    preview: "Need CE MDR compliance pack for a France registration dossier.",
    fullMessage:
      "Bonjour, we are preparing a France registration dossier and need your CE MDR compliance pack for the CPAP family. Please share the latest declarations, IFU set, and intended use statement.",
    timestamp: "昨天",
    unread: false,
    intent: "认证资质",
    confidence: 95,
    intentReason: "问题聚焦注册材料，适合联动法规知识库与对外资料模块。",
    priority: "中",
    nextAction: "同步法规库条款并整理对外资料版本",
    requiredInfo: [
      { label: "目标国家", received: true },
      { label: "认证类型", received: true },
      { label: "产品型号", received: false },
      { label: "版本要求", received: false },
    ],
  },
  {
    id: 4,
    channel: "WhatsApp",
    sender: "Priya Sharma",
    company: "Heal Plus",
    country: "印度",
    preview: "Three units show E3 error code and need warranty repair guidance.",
    fullMessage:
      "Hi, we purchased 20 units of your CPAP model X300 last year. Three units now show E3 and the humidifier stopped working. Please advise on warranty repair or replacement process.",
    timestamp: "昨天",
    unread: false,
    intent: "售后问题",
    confidence: 97,
    intentReason: "典型售后故障描述，建议直接转入售后工单流程。",
    priority: "高",
    nextAction: "创建售后工单并收集序列号",
    requiredInfo: [
      { label: "设备型号", received: true },
      { label: "购买日期", received: false },
      { label: "故障描述", received: true },
      { label: "序列号", received: false },
    ],
  },
  {
    id: 5,
    channel: "Email",
    sender: "Thomas Weber",
    company: "NordCare GmbH",
    country: "德国",
    preview: "Comparing home-use CPAP models for German channel distribution.",
    fullMessage:
      "We would like to know which CPAP model is most suitable for home use in Germany. Please share a comparison chart and the available local compliance package for distributors.",
    timestamp: "2天前",
    unread: false,
    intent: "型号咨询",
    confidence: 85,
    intentReason: "以产品选择为主，后续可引导到对外资料版本和报价流程。",
    priority: "中",
    nextAction: "发送型号对比和家庭场景推荐",
    requiredInfo: [
      { label: "目标国家", received: true },
      { label: "使用场景", received: true },
      { label: "年度采购量", received: false },
      { label: "认证要求", received: false },
    ],
  },
  {
    id: 6,
    channel: "Email",
    sender: "Lucia Gomez",
    company: "Clinica Vida",
    country: "西班牙",
    preview: "Checking available Spanish IFU versions and hospital tender timing.",
    fullMessage:
      "Hello, our hospital tender will open next month. We need to confirm whether Spanish IFU and labeling files are available for your current model family before we proceed.",
    timestamp: "3天前",
    unread: false,
    intent: "认证资质",
    confidence: 81,
    intentReason: "既有招标时点，也涉及多语言资料版本，适合转交资料版本模块。",
    priority: "中",
    nextAction: "核对西语资料版本并回复可供货窗口",
    requiredInfo: [
      { label: "目标国家", received: true },
      { label: "语言版本", received: true },
      { label: "招标时间", received: true },
      { label: "型号范围", received: false },
    ],
  },
];

const replyTemplates: Record<Intent, Record<"中文" | "English" | "Español", string>> = {
  合作意向: {
    中文:
      "尊敬的合作伙伴，\n\n感谢您对 INOGI 产品的关注。我们很高兴了解贵司在墨西哥推进分销合作的意向。为便于我们准备报价与资质资料，请进一步确认年度采购量、首批交期及付款方式。\n\n如您方便，我们可以在 24 小时内发送首轮资料包与建议方案。\n\n此致\nINOGI 海外销售团队",
    English:
      "Dear Partner,\n\nThank you for your interest in INOGI products. We are pleased to learn about your distribution plan for Mexico. To prepare a tailored quotation and compliance pack, could you please confirm the annual purchase volume, first shipment timing, and preferred payment terms?\n\nWe can share the first-round material pack within 24 hours.\n\nBest regards,\nINOGI Overseas Sales Team",
    Español:
      "Estimado socio,\n\nGracias por su interés en los productos de INOGI. Nos alegra conocer su intención de distribución en México. Para preparar una cotización y un paquete de cumplimiento, por favor confirme el volumen anual, el plazo del primer embarque y las condiciones de pago preferidas.\n\nPodemos enviar el primer paquete de materiales dentro de 24 horas.\n\nAtentamente,\nEquipo Comercial Internacional de INOGI",
  },
  询价: {
    中文:
      "您好，\n\n感谢您关于 BiPAP 设备的询价。我们已整理适用于医院睡眠实验室场景的产品规格、报价范围和售后网络说明。若您确认采购时间与付款方式，我们将同步正式报价单与服务承诺说明。\n\n祝好\nINOGI 销售团队",
    English:
      "Dear Customer,\n\nThank you for your inquiry regarding our BiPAP range. We have prepared the specification pack, pricing guidance, and after-sales coverage summary for hospital sleep lab use. Once you confirm the purchasing timeline and payment terms, we will issue a formal quotation.\n\nBest regards,\nINOGI Sales Team",
    Español:
      "Estimado cliente,\n\nGracias por su consulta sobre nuestra línea de equipos BiPAP. Hemos preparado las especificaciones, el rango de precios y el resumen de servicio posventa para uso hospitalario. Una vez que confirme el calendario de compra y las condiciones de pago, emitiremos la cotización formal.\n\nAtentamente,\nEquipo de Ventas INOGI",
  },
  型号咨询: {
    中文: "您好，我们会根据家庭使用场景为您推荐适合德国市场的 CPAP 型号，并附上功能对比与资料版本说明。",
    English:
      "Hello, we will recommend the most suitable CPAP model for home use in Germany and attach a comparison sheet with available compliance materials.",
    Español:
      "Hola, recomendaremos el modelo CPAP más adecuado para uso doméstico en Alemania e incluiremos una comparativa con los materiales de cumplimiento disponibles.",
  },
  认证资质: {
    中文: "您好，针对贵司的注册或招标用途，我们会整理最新的合规资料包，并说明适用版本与补件路径。",
    English:
      "Hello, for your registration or tender preparation, we will compile the latest compliance package and clarify the applicable versions and follow-up steps.",
    Español:
      "Hola, para su proceso de registro o licitación, prepararemos el paquete de cumplimiento más reciente e indicaremos la versión aplicable y los siguientes pasos.",
  },
  售后问题: {
    中文: "您好，已收到设备故障反馈。建议先提供设备序列号、购买日期和故障照片，我们会同步售后工单并安排技术支持。",
    English:
      "Hello, we have received the fault report. Please share the serial number, purchase date, and fault photos so that we can open an after-sales ticket and arrange support.",
    Español:
      "Hola, hemos recibido el reporte de falla. Por favor comparta el número de serie, la fecha de compra y fotos del problema para abrir un caso de posventa y coordinar soporte técnico.",
  },
};

const pageSize = 4;

export function InquiryPage() {
  const [selectedId, setSelectedId] = useState<number>(mockInquiries[0].id);
  const [lang, setLang] = useState<"中文" | "English" | "Español">("中文");
  const [tone, setTone] = useState<Tone>("友好");
  const [channelFilter, setChannelFilter] = useState<Channel | "全部">("全部");
  const [intentFilter, setIntentFilter] = useState<Intent | "全部">("全部");
  const [keyword, setKeyword] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [checkedInfo, setCheckedInfo] = useState<Record<string, boolean>>({});
  const [crmOpen, setCrmOpen] = useState(false);

  const filteredInquiries = useMemo(() => {
    return mockInquiries.filter((item) => {
      const matchChannel = channelFilter === "全部" || item.channel === channelFilter;
      const matchIntent = intentFilter === "全部" || item.intent === intentFilter;
      const matchKeyword =
        !keyword.trim() ||
        [item.sender, item.company, item.country, item.preview, item.fullMessage].join(" ").toLowerCase().includes(keyword.toLowerCase());
      return matchChannel && matchIntent && matchKeyword;
    });
  }, [channelFilter, intentFilter, keyword]);

  const totalPages = Math.max(1, Math.ceil(filteredInquiries.length / pageSize));
  const pagedInquiries = filteredInquiries.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selected = filteredInquiries.find((item) => item.id === selectedId) ?? filteredInquiries[0] ?? mockInquiries[0];
  const replyText = replyTemplates[selected.intent][lang];

  const stats = useMemo(
    () => ({
      unread: mockInquiries.filter((item) => item.unread).length,
      highPriority: mockInquiries.filter((item) => item.priority === "高").length,
      certification: mockInquiries.filter((item) => item.intent === "认证资质").length,
    }),
    [],
  );

  const handleSelectInquiry = (id: number) => {
    setSelectedId(id);
    setCheckedInfo({});
  };

  const handleFilterReset = () => {
    setKeyword("");
    setChannelFilter("全部");
    setIntentFilter("全部");
    setCurrentPage(1);
  };

  const handleNextStep = () => {
    if (selected.intent === "售后问题") {
      toast.success("已生成售后线索，建议继续进入售后工单。");
      return;
    }
    toast.success(`已将 ${selected.sender} 的询盘加入跟进队列。`);
  };

  return (
    <div className="flex h-full min-h-0 gap-4 bg-slate-50 p-4">
      <aside className="flex w-[320px] flex-shrink-0 flex-col rounded-3xl border border-slate-100 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">询盘收件箱</h2>
              <p className="mt-1 text-xs text-slate-400">聚合 WhatsApp、Email、LinkedIn 三类来源</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
              {filteredInquiries.length} 条
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-2xl bg-slate-50 px-2 py-3">
              <div className="font-semibold text-slate-800">{stats.unread}</div>
              <div className="mt-1 text-slate-400">未读</div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-2 py-3">
              <div className="font-semibold text-slate-800">{stats.highPriority}</div>
              <div className="mt-1 text-slate-400">高优先级</div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-2 py-3">
              <div className="font-semibold text-slate-800">{stats.certification}</div>
              <div className="mt-1 text-slate-400">资质咨询</div>
            </div>
          </div>
          <input
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
              setCurrentPage(1);
            }}
            placeholder="搜索客户、公司、国家或正文"
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-teal-300 focus:bg-white"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <select
              value={channelFilter}
              onChange={(event) => {
                setChannelFilter(event.target.value as Channel | "全部");
                setCurrentPage(1);
              }}
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 outline-none"
            >
              {["全部", "WhatsApp", "Email", "LinkedIn"].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              value={intentFilter}
              onChange={(event) => {
                setIntentFilter(event.target.value as Intent | "全部");
                setCurrentPage(1);
              }}
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 outline-none"
            >
              {["全部", "询价", "型号咨询", "认证资质", "售后问题", "合作意向"].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <button onClick={handleFilterReset} className="mt-3 text-xs text-slate-400 transition hover:text-slate-600">
            清空筛选
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {pagedInquiries.map((inq) => {
            const Icon = channelConfig[inq.channel].icon;
            return (
              <button
                key={inq.id}
                onClick={() => handleSelectInquiry(inq.id)}
                className={cn(
                  "w-full border-b border-slate-50 px-5 py-4 text-left transition hover:bg-slate-50",
                  selected.id === inq.id && "bg-teal-50/70",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn("mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl", channelConfig[inq.channel].bg)}>
                    <Icon className={cn("h-4 w-4", channelConfig[inq.channel].color)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800">{inq.sender}</span>
                      <span className="text-xs text-slate-400">{inq.timestamp}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <span>{inq.company}</span>
                      <span>·</span>
                      <span>{inq.country}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{inq.preview}</p>
                    <div className="mt-3 flex items-center gap-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", intentConfig[inq.intent])}>{inq.intent}</span>
                      {inq.unread && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">未读</span>}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                        {inq.priority}优先级
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <span>
            第 {currentPage} / {totalPages} 页
          </span>
          <div className="flex gap-2">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}
              className="rounded-full border border-slate-200 p-1.5 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((value) => Math.min(totalPages, value + 1))}
              className="rounded-full border border-slate-200 p-1.5 disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-4">
        <section className="material-card p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-3">
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", intentConfig[selected.intent])}>{selected.intent}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">{selected.channel}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">{selected.priority}优先级</span>
              </div>
              <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">{selected.sender}</h1>
              <p className="mt-2 text-sm text-slate-500">
                {selected.company} · {selected.country} · {selected.timestamp}
              </p>
              <p className="mt-4 rounded-[24px] bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-700">{selected.fullMessage}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 xl:w-[360px] xl:grid-cols-1">
              <div className="material-card-flat p-4">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Confidence</div>
                <div className="mt-3 text-3xl font-bold text-slate-900">{selected.confidence}%</div>
                <p className="mt-2 text-sm text-slate-500">{selected.intentReason}</p>
              </div>
              <div className="material-card-flat p-4">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Next Action</div>
                <div className="mt-3 text-sm font-semibold text-slate-800">{selected.nextAction}</div>
                <p className="mt-2 text-sm text-slate-500">建议在 4 小时内完成首轮反馈。</p>
              </div>
              <div className="material-card-flat p-4">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Flow Links</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link to="/email-ai" className="material-button-secondary text-xs">
                    去邮件写作
                  </Link>
                  <Link to={selected.intent === "售后问题" ? "/after-sales" : "/external-docs"} className="material-button-secondary text-xs">
                    {selected.intent === "售后问题" ? "转售后工单" : "看资料版本"}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-12 gap-4">
          <div className="col-span-12 xl:col-span-7">
            <div className="material-card p-6">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-teal-500" />
                <h3 className="text-sm font-semibold text-slate-800">AI 意图分析与补件核查</h3>
              </div>
              <div className="mt-5 space-y-3">
                {selected.requiredInfo.map((item) => {
                  const checked = checkedInfo[item.label] ?? item.received;
                  return (
                    <div key={item.label} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button onClick={() => setCheckedInfo((value) => ({ ...value, [item.label]: !checked }))}>
                          {checked ? <CheckSquare className="h-4 w-4 text-teal-500" /> : <Square className="h-4 w-4 text-slate-300" />}
                        </button>
                        <span className={cn("text-sm", checked ? "text-slate-400 line-through" : "text-slate-700")}>{item.label}</span>
                      </div>
                      <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", checked ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")}>
                        {checked ? "已确认" : "待补充"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button onClick={() => setCrmOpen(true)} className="material-button-primary">
                  同步 CRM 台账
                </button>
                <button onClick={handleNextStep} className="material-button-secondary">
                  加入跟进队列
                </button>
              </div>
            </div>
          </div>

          <div className="col-span-12 xl:col-span-5">
            <div className="material-card p-6">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-blue-500" />
                <h3 className="text-sm font-semibold text-slate-800">AI 回复草稿</h3>
              </div>
              <div className="mt-4 flex gap-2">
                {(["中文", "English", "Español"] as const).map((item) => (
                  <button
                    key={item}
                    onClick={() => setLang(item)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-medium transition",
                      lang === item ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500",
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(["正式", "友好", "强硬", "委婉拒绝"] as const).map((item) => (
                  <button
                    key={item}
                    onClick={() => setTone(item)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition",
                      tone === item ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500",
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <textarea
                readOnly
                value={`${replyText}\n\n[当前语气：${tone}]`}
                className="mt-4 h-72 w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-700 outline-none"
              />
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(replyText);
                    toast.success("回复草稿已复制。");
                  }}
                  className="material-button-secondary"
                >
                  <Copy className="h-4 w-4" />
                  复制
                </button>
                <button onClick={() => toast.success("已推送到邮件 AI 写作页继续润色。")} className="material-button-secondary">
                  <Mail className="h-4 w-4" />
                  深度润色
                </button>
                <button onClick={() => toast.success("已发送演示回复。")} className="material-button-primary ml-auto">
                  <Send className="h-4 w-4" />
                  发送回复
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {crmOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/20 p-4" onClick={() => setCrmOpen(false)}>
          <div className="w-full max-w-xl rounded-[28px] bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">同步 CRM 台账</h3>
                <p className="mt-1 text-sm text-slate-500">将当前询盘登记为销售线索，保留跟进阶段与补件状态。</p>
              </div>
              <button onClick={() => setCrmOpen(false)} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-500">
                关闭
              </button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {[
                { label: "客户", value: selected.sender },
                { label: "公司", value: selected.company },
                { label: "国家", value: selected.country },
                { label: "需求类型", value: selected.intent },
                { label: "优先级", value: selected.priority },
                { label: "下一步", value: selected.nextAction },
              ].map((item) => (
                <label key={item.label} className="block">
                  <span className="mb-1 block text-xs text-slate-400">{item.label}</span>
                  <input defaultValue={item.value} className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none" />
                </label>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setCrmOpen(false)} className="material-button-secondary">
                取消
              </button>
              <button
                onClick={() => {
                  setCrmOpen(false);
                  toast.success("CRM 线索已创建。");
                }}
                className="material-button-primary"
              >
                保存线索
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
