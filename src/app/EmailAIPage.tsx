import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  History,
  Languages,
  Library,
  Mail,
  RefreshCw,
  Send,
  Sparkles,
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
import { routePath } from "./lib/routePaths";

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
  { id: "quote", category: "销售", label: "询价回复", summary: "用于首轮报价、规格说明与交付确认", draft: "客户询问 50 台 BiPAP 规格和价格，请生成一封正式英文邮件，补充交付周期与服务范围。" },
  { id: "partner", category: "合作", label: "渠道合作邀约", summary: "适用于分销合作、首轮拜访与资料包发送", draft: "客户有墨西哥渠道合作意向，请生成一封友好的英文回复，询问首批数量、付款方式和会议时间。" },
  { id: "complaint", category: "售后", label: "售后故障回复", summary: "用于收集序列号、故障照片和保修信息", draft: "客户反馈 3 台设备报 E3 故障，请生成一封英文售后回复，要求提供序列号、购买日期和故障照片。" },
  { id: "followup", category: "销售", label: "跟进催回复", summary: "用于报价后 3 天跟进客户决策进展", draft: "给德国客户发送一封跟进邮件，提醒其查看报价单，并邀请安排 15 分钟线上沟通。" },
  { id: "tender", category: "合作", label: "招标资料确认", summary: "适用于版本核对、IFU 语言和投标时点确认", draft: "客户需要西班牙语 IFU 和 CE MDR 材料，请生成一封正式邮件说明当前可提供版本和后续补件路径。" },
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
      body: "Dear Customer,\n\nThank you for your interest in INOGI's BiPAP range. Please find below the initial commercial outline for 50 units.\n\n- Product: BiPAP Series B20\n- Estimated lead time: 4-6 weeks after confirmation\n- Service coverage: remote troubleshooting and local distributor onboarding support\n- Next step: confirm payment terms and delivery destination so that we can issue a formal quotation\n\nIf needed, we can also share the detailed specification sheet today.\n\nBest regards,\nINOGI Sales Team",
    },
    Español: {
      subject: "Cotización y paquete técnico para 50 unidades BiPAP",
      body: "Estimado cliente,\n\nGracias por su interés en la línea BiPAP de INOGI. A continuación compartimos el esquema comercial inicial para 50 unidades.\n\n- Producto: Serie BiPAP B20\n- Plazo estimado: 4 a 6 semanas tras la confirmación\n- Cobertura de servicio: soporte remoto y apoyo para incorporación del distribuidor local\n- Siguiente paso: confirmar condiciones de pago y destino de entrega para emitir la cotización formal\n\nSi lo desea, podemos enviar hoy mismo la ficha técnica detallada.\n\nAtentamente,\nEquipo de Ventas INOGI",
    },
  },
  partner: {
    English: {
      subject: "Next Steps for Distribution Cooperation in Mexico",
      body: "Dear Partner,\n\nThank you for your interest in representing INOGI in Mexico. To tailor the cooperation package, please confirm your expected first-order volume, preferred payment method, and available meeting slots next week. Once received, we will prepare the commercial pack and certification summary.\n\nBest regards,\nINOGI Overseas Sales Team",
    },
    Español: {
      subject: "Próximos pasos para la cooperación de distribución en México",
      body: "Estimado socio,\n\nGracias por su interés en representar a INOGI en México. Para preparar un paquete comercial adecuado, confirme el volumen esperado del primer pedido, el método de pago preferido y su disponibilidad para una reunión la próxima semana.\n\nAtentamente,\nEquipo Comercial Internacional de INOGI",
    },
  },
  complaint: {
    English: {
      subject: "After-sales Support Request for E3 Fault Cases",
      body: "Dear Customer,\n\nWe are sorry to hear about the E3 fault on your devices. To open the service case, please share the serial numbers, purchase date, and photos or videos of the fault display. Our service team will review the warranty scope within one business day.\n\nBest regards,\nINOGI After-sales Team",
    },
    Español: {
      subject: "Solicitud de soporte posventa para fallas E3",
      body: "Estimado cliente,\n\nLamentamos conocer la falla E3 en sus equipos. Para abrir el caso, comparta los números de serie, la fecha de compra y fotos o videos del error. Nuestro equipo revisará la cobertura dentro de un día hábil.\n\nAtentamente,\nEquipo de Posventa INOGI",
    },
  },
};

const pageSize = 3;

export function EmailAIPage() {
  const [draftText, setDraftText] = useState("");
  const [draftError, setDraftError] = useState("");
  const [targetLang, setTargetLang] = useState<TargetLang>("English");
  const [tone, setTone] = useState<Tone>("正式");
  const [category, setCategory] = useState<TemplateCategory>("全部");
  const [templatePage, setTemplatePage] = useState(1);
  const [generated, setGenerated] = useState<{ subject: string; body: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [recipientError, setRecipientError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const filteredTemplates = useMemo(
    () => templates.filter((item) => category === "全部" || item.category === category),
    [category],
  );
  const totalPages = Math.max(1, Math.ceil(filteredTemplates.length / pageSize));
  const pagedTemplates = filteredTemplates.slice((templatePage - 1) * pageSize, templatePage * pageSize);

  const loadTemplate = (template: Template) => {
    setDraftText(template.draft);
    setDraftError("");
    toast.success(`已填入模板：${template.label}`);
  };

  const handleGenerate = () => {
    if (!draftText.trim()) {
      setDraftError("请先输入中文草稿或从模板库选择一个场景。");
      return;
    }
    setDraftError("");
    setIsGenerating(true);
    window.setTimeout(() => {
      const matched = templates.find((item) => draftText.includes(item.label) || draftText.includes(item.draft.slice(0, 12)));
      const content = (matched && generatedContent[matched.id]?.[targetLang]) || {
        subject: `AI Draft for ${targetLang}`,
        body: "Dear Customer,\n\nThank you for your message. We reviewed your request and prepared a first-round response. Please confirm the business timing, required documents, and expected delivery plan so that we can tailor the next version.\n\nBest regards,\nINOGI Team",
      };
      setGenerated({ subject: content.subject, body: `${content.body}\n\n[当前语气：${tone}]` });
      setIsGenerating(false);
      toast.success("邮件草稿已生成。");
    }, 600);
  };

  const confirmSend = () => {
    const normalized = recipient.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setRecipientError("请输入有效的收件人邮箱地址。");
      return;
    }
    setRecipientError("");
    setPreviewOpen(false);
    toast.success("邮件已发送到演示通道。");
  };

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full max-w-[1600px] min-w-0 flex-col gap-4 px-3 py-4 sm:p-5 lg:p-6">
      <HorizonPageHeader
        Icon={Mail}
        eyebrow="COMMUNICATION · AI EMAIL WORKSPACE"
        title="邮件 AI 写作"
        description="把中文业务意图转为可编辑的英文或西班牙语邮件，并在发送前完成模板、语气和收件人复核。"
        meta={<><span>{templates.length} 个业务模板</span><span>·</span><span>支持 English / Español</span><span>·</span><span>{historyItems.length} 条最近记录</span></>}
        actions={<Button asChild variant="outline"><Link to={routePath("page:inquiry", "/inquiry")}>返回询盘工作台<ArrowRight className="size-4" /></Link></Button>}
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={Library} label="业务模板" value={templates.length} note="销售、售后与合作" />
        <HorizonMetric Icon={Languages} label="目标语言" value={targetLang} note="可随时切换" />
        <HorizonMetric Icon={History} label="最近生成" value={historyItems.length} note="团队场景可复用" />
        <HorizonMetric Icon={generated ? CheckCircle2 : Sparkles} label="当前草稿" value={generated ? "已就绪" : "待生成"} note={generated ? "可编辑并发送预览" : "输入意图后开始生成"} tone={generated ? "success" : "neutral"} />
      </HorizonMetricGrid>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="hz-surface min-w-0 overflow-hidden border" aria-label="邮件生成设置">
          <HorizonSectionHeader Icon={Sparkles} title="生成设置" description="描述客户场景、目标和下一步行动。" />
          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <Label htmlFor="email-draft">中文草稿 / 指令</Label>
              <Textarea
                id="email-draft"
                value={draftText}
                onChange={(event) => { setDraftText(event.target.value); if (draftError) setDraftError(""); }}
                placeholder="输入客户场景、邮件目的和需要确认的下一步"
                className="min-h-36 resize-y bg-slate-50 text-sm leading-6"
                aria-invalid={Boolean(draftError)}
                aria-describedby={draftError ? "email-draft-error" : "email-draft-help"}
              />
              {draftError ? <p id="email-draft-error" className="text-pretty text-xs text-red-600" role="alert">{draftError}</p> : <p id="email-draft-help" className="text-pretty text-xs text-slate-500">建议包含客户、产品、数量、时点和下一步要求。</p>}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">目标语言</legend>
              <div className="grid grid-cols-2 gap-2">
                {(["English", "Español"] as const).map((language) => (
                  <Button key={language} type="button" variant={targetLang === language ? "default" : "outline"} className={targetLang === language ? "hz-primary-action" : ""} aria-pressed={targetLang === language} onClick={() => setTargetLang(language)}>{language}</Button>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">沟通语气</legend>
              <div className="flex flex-wrap gap-2">
                {(["正式", "友好", "强硬", "委婉拒绝"] as const).map((item) => (
                  <Button key={item} type="button" size="sm" variant={tone === item ? "secondary" : "outline"} aria-pressed={tone === item} onClick={() => setTone(item)} className={tone === item ? "border-blue-200 bg-blue-50 text-[#002fa7]" : ""}>{item}</Button>
                ))}
              </div>
            </fieldset>

            <Button type="button" className="hz-primary-action w-full" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
              {isGenerating ? "正在生成" : "生成邮件草稿"}
            </Button>
          </div>

          <div className="border-t border-slate-100">
            <HorizonSectionHeader Icon={Library} title="模板库" description="选择常见场景快速填入生成指令。" trailing={<span className="text-xs tabular-nums text-slate-500">{filteredTemplates.length} 条</span>} />
            <div className="hz-toolbar flex flex-wrap gap-2 border-b p-3" aria-label="模板分类">
              {(["全部", "销售", "售后", "合作"] as const).map((item) => (
                <Button key={item} type="button" size="sm" variant={category === item ? "secondary" : "ghost"} aria-pressed={category === item} onClick={() => { setCategory(item); setTemplatePage(1); }} className={category === item ? "bg-blue-50 text-[#002fa7]" : ""}>{item}</Button>
              ))}
            </div>
            <ul className="divide-y divide-slate-100" aria-label="邮件模板列表">
              {pagedTemplates.map((template) => (
                <li key={template.id}>
                  <button type="button" onClick={() => loadTemplate(template)} className="w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-3"><span className="font-semibold text-slate-800">{template.label}</span><span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500">{template.category}</span></div>
                    <p className="mt-1 text-pretty text-xs leading-5 text-slate-600">{template.summary}</p>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
              <span className="tabular-nums">第 {templatePage} / {totalPages} 页</span>
              <div className="flex gap-2">
                <Button type="button" size="icon" variant="outline" disabled={templatePage === 1} onClick={() => setTemplatePage((value) => Math.max(1, value - 1))} aria-label="上一页模板"><ChevronLeft className="size-4" /></Button>
                <Button type="button" size="icon" variant="outline" disabled={templatePage === totalPages} onClick={() => setTemplatePage((value) => Math.min(totalPages, value + 1))} aria-label="下一页模板"><ChevronRight className="size-4" /></Button>
              </div>
            </div>
          </div>
        </section>

        <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="hz-surface min-w-0 overflow-hidden border" aria-label="邮件草稿预览">
            <HorizonSectionHeader Icon={Mail} title="邮件草稿" description="生成后可继续编辑主题和正文，再进入发送预览。" trailing={<Button type="button" size="sm" variant="outline" disabled={!generated} onClick={() => { setRecipientError(""); setPreviewOpen(true); }}>发送预览</Button>} />
            {generated ? (
              <div className="space-y-4 p-4 sm:p-5">
                <div className="space-y-2"><Label htmlFor="generated-subject">邮件主题</Label><Input id="generated-subject" value={generated.subject} onChange={(event) => setGenerated((current) => current ? { ...current, subject: event.target.value } : current)} /></div>
                <div className="space-y-2"><Label htmlFor="generated-body">邮件正文</Label><Textarea id="generated-body" value={generated.body} onChange={(event) => setGenerated((current) => current ? { ...current, body: event.target.value } : current)} className="min-h-[360px] resize-y whitespace-pre-wrap text-sm leading-6" /></div>
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <Button type="button" variant="outline" onClick={() => { void navigator.clipboard.writeText(`Subject: ${generated.subject}\n\n${generated.body}`); toast.success("邮件内容已复制。"); }}><Copy className="size-4" />复制全文</Button>
                  <Button type="button" variant="outline" onClick={handleGenerate}><RefreshCw className="size-4" />重新生成</Button>
                  <Button type="button" className="hz-primary-action sm:ml-auto" onClick={() => { setRecipientError(""); setPreviewOpen(true); }}><Send className="size-4" />进入发送预览</Button>
                </div>
              </div>
            ) : (
              <HorizonEmptyState Icon={Mail} title="尚未生成邮件草稿" description="输入业务意图，或从模板库载入一个场景后开始生成。" action={<Button type="button" size="sm" variant="outline" onClick={() => loadTemplate(templates[0])}>载入询价模板</Button>} />
            )}
          </section>

          <section className="hz-surface min-w-0 overflow-hidden border" aria-label="最近生成记录">
            <HorizonSectionHeader Icon={History} title="最近生成" description="复用团队最近处理过的邮件场景。" trailing={<Button asChild size="sm" variant="ghost"><Link to={routePath("page:report-compression", "/report-compression")}>汇报压缩</Link></Button>} />
            <ul className="divide-y divide-slate-100">
              {historyItems.map((item) => (
                <li key={item.id}>
                  <button type="button" className="w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-slate-50" onClick={() => { setDraftText(`${item.scenario}，请输出一封${item.language}邮件。`); setTargetLang(item.language); setDraftError(""); toast.info(`已加载历史场景：${item.scenario}`); }}>
                    <div className="line-clamp-2 text-sm font-semibold text-slate-800">{item.scenario}</div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500"><span>{item.language} · {item.owner}</span><time className="tabular-nums">{item.updatedAt}</time></div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={(open) => { setPreviewOpen(open); if (!open) setRecipientError(""); }}>
        <DialogContent className="horizon-portal sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-balance">发送前预览</DialogTitle>
            <DialogDescription className="text-pretty">确认发送账号、收件人、主题和正文后执行演示发送。</DialogDescription>
          </DialogHeader>
          {generated ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="email-sender">发送账号</Label><Input id="email-sender" value="sales@inogi.com" readOnly /></div>
                <div className="space-y-2">
                  <Label htmlFor="email-recipient">收件人邮箱</Label>
                  <Input id="email-recipient" type="email" value={recipient} onChange={(event) => { setRecipient(event.target.value); if (recipientError) setRecipientError(""); }} placeholder="customer@example.com" aria-invalid={Boolean(recipientError)} aria-describedby={recipientError ? "email-recipient-error" : undefined} />
                  {recipientError ? <p id="email-recipient-error" className="text-pretty text-xs text-red-600" role="alert">{recipientError}</p> : null}
                </div>
              </div>
              <div className="space-y-2"><Label htmlFor="preview-subject">主题</Label><Input id="preview-subject" value={generated.subject} readOnly /></div>
              <div className="max-h-64 overflow-y-auto whitespace-pre-line rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">{generated.body}</div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(false)}>返回编辑</Button>
            <Button type="button" className="hz-primary-action" onClick={confirmSend}><Send className="size-4" />确认发送</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
