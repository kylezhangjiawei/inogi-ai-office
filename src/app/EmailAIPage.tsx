import React, { useMemo, useState } from "react";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Copy,
  Mail,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

type TargetLang = "English" | "Español";
type Tone = "正式" | "友好" | "强硬" | "委婉拒绝";
type TemplateCategory = "全部" | "销售" | "售后" | "合作";

type Template = {
  id: string;
  category: Exclude<TemplateCategory, "全部">;
  label: string;
  draft: string;
  summary: string;
};

type GeneratedHistory = {
  id: string;
  scenario: string;
  language: TargetLang;
  owner: string;
  updatedAt: string;
};

const templates: Template[] = [
  {
    id: "quote",
    category: "销售",
    label: "询价回复",
    summary: "用于首轮报价、规格说明与交付确认",
    draft: "客户询问 50 台 BiPAP 规格和价格，请生成一封正式英文邮件，补充交付周期与服务范围。",
  },
  {
    id: "partner",
    category: "合作",
    label: "渠道合作邀约",
    summary: "适用于分销合作、首轮拜访与资料包发送",
    draft: "客户有墨西哥渠道合作意向，请生成一封友好的英文回复，询问首批数量、付款方式和会议时间。",
  },
  {
    id: "complaint",
    category: "售后",
    label: "售后故障回复",
    summary: "用于收集序列号、故障照片和保修信息",
    draft: "客户反馈 3 台设备报 E3 故障，请生成一封英文售后回复，要求提供序列号、购买日期和故障照片。",
  },
  {
    id: "followup",
    category: "销售",
    label: "跟进催回复",
    summary: "用于报价后 3 天跟进客户决策进展",
    draft: "给德国客户发送一封跟进邮件，提醒其查看报价单，并邀请安排 15 分钟线上沟通。",
  },
  {
    id: "tender",
    category: "合作",
    label: "招标资料确认",
    summary: "适用于版本核对、IFU 语言和投标时点确认",
    draft: "客户需要西班牙语 IFU 和 CE MDR 材料，请生成一封正式邮件说明当前可提供版本和后续补件路径。",
  },
];

const historyItems: GeneratedHistory[] = [
  { id: "H-01", scenario: "墨西哥渠道合作首轮回复", language: "English", owner: "Iris", updatedAt: "11:20" },
  { id: "H-02", scenario: "德国报价跟进邮件", language: "English", owner: "Ava", updatedAt: "昨天" },
  { id: "H-03", scenario: "西语 IFU 资料确认", language: "Español", owner: "Noah", updatedAt: "昨天" },
  { id: "H-04", scenario: "印度售后故障收集", language: "English", owner: "Leo", updatedAt: "2天前" },
];

const generatedContent: Record<string, Record<TargetLang, { subject: string; body: string }>> = {
  quote: {
    English: {
      subject: "Quotation and Specification Pack for 50 BiPAP Units",
      body:
        "Dear Customer,\n\nThank you for your interest in INOGI's BiPAP range. Please find below the initial commercial outline for 50 units.\n\n- Product: BiPAP Series B20\n- Estimated lead time: 4-6 weeks after confirmation\n- Service coverage: remote troubleshooting and local distributor onboarding support\n- Next step: confirm payment terms and delivery destination so that we can issue a formal quotation\n\nIf needed, we can also share the detailed specification sheet today.\n\nBest regards,\nINOGI Sales Team",
    },
    Español: {
      subject: "Cotización y paquete técnico para 50 unidades BiPAP",
      body:
        "Estimado cliente,\n\nGracias por su interés en la línea BiPAP de INOGI. A continuación compartimos el esquema comercial inicial para 50 unidades.\n\n- Producto: Serie BiPAP B20\n- Plazo estimado: 4 a 6 semanas tras la confirmación\n- Cobertura de servicio: soporte remoto y apoyo para incorporación del distribuidor local\n- Siguiente paso: confirmar condiciones de pago y destino de entrega para emitir la cotización formal\n\nSi lo desea, podemos enviar hoy mismo la ficha técnica detallada.\n\nAtentamente,\nEquipo de Ventas INOGI",
    },
  },
  partner: {
    English: {
      subject: "Next Steps for Distribution Cooperation in Mexico",
      body:
        "Dear Partner,\n\nThank you for your interest in representing INOGI in Mexico. We are glad to support the next discussion round.\n\nTo tailor the cooperation package, could you please confirm your expected first-order volume, preferred payment method, and available meeting slots next week? Once received, we will prepare the commercial pack and certification summary.\n\nLooking forward to your reply.\n\nBest regards,\nINOGI Overseas Sales Team",
    },
    Español: {
      subject: "Próximos pasos para la cooperación de distribución en México",
      body:
        "Estimado socio,\n\nGracias por su interés en representar a INOGI en México. Nos alegra avanzar a la siguiente ronda de conversación.\n\nPara preparar un paquete comercial adecuado, ¿podría confirmar el volumen esperado del primer pedido, el método de pago preferido y su disponibilidad para una reunión la próxima semana? Con ello enviaremos el resumen comercial y de certificaciones.\n\nQuedamos atentos.\n\nAtentamente,\nEquipo Comercial Internacional de INOGI",
    },
  },
  complaint: {
    English: {
      subject: "After-sales Support Request for E3 Fault Cases",
      body:
        "Dear Customer,\n\nWe are sorry to hear about the E3 fault on your devices. To open the service case and arrange the next step, please share the serial numbers, purchase date, and photos or videos of the fault display.\n\nOnce we receive the information, our service team will review the warranty scope and respond with the repair or replacement path within one business day.\n\nBest regards,\nINOGI After-sales Team",
    },
    Español: {
      subject: "Solicitud de soporte posventa para fallas E3",
      body:
        "Estimado cliente,\n\nLamentamos conocer la falla E3 en sus equipos. Para abrir el caso de servicio y organizar el siguiente paso, por favor comparta los números de serie, la fecha de compra y fotos o videos del error.\n\nUna vez recibida la información, nuestro equipo de posventa revisará la cobertura de garantía y responderá con la ruta de reparación o reemplazo dentro de un día hábil.\n\nAtentamente,\nEquipo de Posventa INOGI",
    },
  },
};

const pageSize = 3;

export function EmailAIPage() {
  const [draftText, setDraftText] = useState("");
  const [targetLang, setTargetLang] = useState<TargetLang>("English");
  const [tone, setTone] = useState<Tone>("正式");
  const [category, setCategory] = useState<TemplateCategory>("全部");
  const [templatePage, setTemplatePage] = useState(1);
  const [generated, setGenerated] = useState<{ subject: string; body: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const filteredTemplates = useMemo(
    () => templates.filter((item) => category === "全部" || item.category === category),
    [category],
  );

  const totalPages = Math.max(1, Math.ceil(filteredTemplates.length / pageSize));
  const pagedTemplates = filteredTemplates.slice((templatePage - 1) * pageSize, templatePage * pageSize);

  const handleGenerate = () => {
    if (!draftText.trim()) {
      toast.error("请先输入中文草稿或选择模板。");
      return;
    }
    setIsGenerating(true);
    window.setTimeout(() => {
      const matched = templates.find((item) => draftText.includes(item.label) || draftText.includes(item.draft.slice(0, 12)));
      const content =
        (matched && generatedContent[matched.id]?.[targetLang]) || {
          subject: `AI Draft for ${targetLang}`,
          body:
            "Dear Customer,\n\nThank you for your message. We reviewed your request and prepared a first-round response. Please confirm the business timing, required documents, and expected delivery plan so that we can tailor the next version.\n\nBest regards,\nINOGI Team",
        };
      setGenerated({
        subject: content.subject,
        body: `${content.body}\n\n[当前语气：${tone}]`,
      });
      setIsGenerating(false);
      toast.success("邮件草稿已生成。");
    }, 900);
  };

  return (
    <div className="flex h-full min-h-0 gap-4 bg-slate-50 p-4">
      <aside className="flex w-[360px] flex-shrink-0 flex-col gap-4">
        <section className="material-card p-5">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-blue-500" />
            <h2 className="text-sm font-semibold text-slate-800">邮件 AI 写作</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-500">把中文意图整理为可发送的外文商务邮件，并保留模板、历史和发送前预览。</p>

          <label className="mt-4 block text-xs text-slate-400">中文草稿 / 指令</label>
          <textarea
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            placeholder="输入中文草稿、客户场景或下一步行动要求"
            className="mt-2 h-36 w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white"
          />

          <div className="mt-4 grid grid-cols-2 gap-2">
            {(["English", "Español"] as const).map((item) => (
              <button
                key={item}
                onClick={() => setTargetLang(item)}
                className={cn(
                  "rounded-2xl px-3 py-2 text-sm font-medium transition",
                  targetLang === item ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500",
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

          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={handleGenerate} disabled={isGenerating} className="material-button-primary">
              {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              生成邮件
            </button>
            <Link to="/inquiry" className="material-button-secondary">
              返回询盘页
            </Link>
          </div>
        </section>

        <section className="material-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">模板库</h3>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">{filteredTemplates.length} 条</span>
          </div>
          <div className="mt-3 flex gap-2">
            {(["全部", "销售", "售后", "合作"] as const).map((item) => (
              <button
                key={item}
                onClick={() => {
                  setCategory(item);
                  setTemplatePage(1);
                }}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition",
                  category === item ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500",
                )}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {pagedTemplates.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setDraftText(item.draft);
                  toast.success(`已填入模板：${item.label}`);
                }}
                className="w-full rounded-[24px] border border-slate-100 bg-slate-50/80 p-4 text-left transition hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-800">{item.label}</div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">{item.category}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">{item.summary}</p>
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>
              第 {templatePage} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <button
                disabled={templatePage === 1}
                onClick={() => setTemplatePage((value) => Math.max(1, value - 1))}
                className="rounded-full border border-slate-200 p-1.5 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                disabled={templatePage === totalPages}
                onClick={() => setTemplatePage((value) => Math.min(totalPages, value + 1))}
                className="rounded-full border border-slate-200 p-1.5 disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </section>
      </aside>

      <main className="grid min-w-0 flex-1 grid-cols-12 gap-4">
        <section className="col-span-12 xl:col-span-8">
          <div className="material-card flex h-full flex-col p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">生成预览</h3>
                <p className="mt-1 text-sm text-slate-500">生成后可继续编辑标题、正文，并一键复制或发送演示邮件。</p>
              </div>
              <button
                onClick={() => setPreviewOpen(true)}
                disabled={!generated}
                className="material-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                打开发送预览
              </button>
            </div>

            {generated ? (
              <div className="mt-5 flex min-h-0 flex-1 flex-col rounded-[28px] border border-slate-100 bg-slate-50/80 p-5">
                <div className="grid gap-3 border-b border-slate-100 pb-4 sm:grid-cols-[72px_1fr]">
                  <div className="text-xs text-slate-400">主题</div>
                  <div className="text-sm font-semibold text-slate-900">{generated.subject}</div>
                  <div className="text-xs text-slate-400">参数</div>
                  <div className="text-sm text-slate-500">
                    {targetLang} · {tone}
                  </div>
                </div>
                <textarea
                  value={generated.body}
                  onChange={(event) => setGenerated((value) => (value ? { ...value, body: event.target.value } : value))}
                  className="mt-4 min-h-0 flex-1 rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-sm leading-7 text-slate-700 outline-none"
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    onClick={() => {
                      if (!generated) return;
                      navigator.clipboard.writeText(`Subject: ${generated.subject}\n\n${generated.body}`);
                      toast.success("邮件内容已复制。");
                    }}
                    className="material-button-secondary"
                  >
                    <Copy className="h-4 w-4" />
                    复制全文
                  </button>
                  <button onClick={handleGenerate} className="material-button-secondary">
                    <RefreshCw className="h-4 w-4" />
                    重新生成
                  </button>
                  <button onClick={() => toast.success("已发送到演示邮箱客户端。")} className="material-button-primary ml-auto">
                    <Send className="h-4 w-4" />
                    发送邮件
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 flex flex-1 items-center justify-center rounded-[28px] border border-dashed border-slate-200 bg-white text-center">
                <div>
                  <Mail className="mx-auto h-10 w-10 text-slate-300" />
                  <p className="mt-3 text-sm text-slate-400">左侧输入草稿或选择模板后即可生成邮件。</p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="col-span-12 xl:col-span-4">
          <div className="material-card h-full p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">最近生成</h3>
                <p className="mt-1 text-sm text-slate-500">保留团队最近处理过的邮件场景，方便快速复用。</p>
              </div>
              <Link to="/report-compression" className="material-button-secondary text-xs">
                去汇报压缩
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {historyItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setDraftText(`${item.scenario}，请输出一封${item.language}邮件。`);
                    setTargetLang(item.language);
                    toast.info(`已加载历史场景：${item.scenario}`);
                  }}
                  className="w-full rounded-[24px] border border-slate-100 bg-slate-50/80 p-4 text-left transition hover:-translate-y-0.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-800">{item.scenario}</div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">{item.language}</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {item.owner} · {item.updatedAt}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      </main>

      {previewOpen && generated && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/20 p-4" onClick={() => setPreviewOpen(false)}>
          <div className="w-full max-w-3xl rounded-[28px] bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">发送前预览</h3>
                <p className="mt-1 text-sm text-slate-500">确认收件人、主题和正文后即可执行演示发送。</p>
              </div>
              <button onClick={() => setPreviewOpen(false)} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-500">
                关闭
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <input defaultValue="sales@inogi.com" className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none" />
                <input placeholder="输入收件人邮箱" className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none" />
              </div>
              <input value={generated.subject} readOnly className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 outline-none" />
              <div className="rounded-[24px] bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-700 whitespace-pre-line">{generated.body}</div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setPreviewOpen(false)} className="material-button-secondary">
                返回编辑
              </button>
              <button
                onClick={() => {
                  setPreviewOpen(false);
                  toast.success("邮件已发送到演示通道。");
                }}
                className="material-button-primary"
              >
                <Send className="h-4 w-4" />
                确认发送
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
