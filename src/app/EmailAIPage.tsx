import React, { useState } from "react";
import { Bot, ChevronDown, ChevronUp, Copy, Mail, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

type TargetLang = "English" | "Español";
type Tone = "正式" | "友好" | "强硬" | "委婉拒绝";

interface Template {
  id: string;
  label: string;
  draft: string;
}

const templates: Template[] = [
  { id: "collect", label: "催款通知", draft: "您好，关于我司发出的发票（编号：INV-2026-XXX），金额为 XXX 元，付款期限已于 XX 日到期。请您尽快安排付款，如有任何问题欢迎与我们联系。" },
  { id: "quote_reply", label: "询价回复", draft: "您好，感谢贵方对我司产品的关注。针对您询问的 CPAP 系列产品，现报价如下：型号 X300，单价 $XXX，MOQ 10 台，含 CE 认证。如需详细规格及报价单，请回复确认。" },
  { id: "complaint", label: "投诉处理", draft: "您好，非常抱歉给您带来了不便。我们已收到您反映的问题，技术团队将在 24 小时内与您取得联系，并提供完整的解决方案。感谢您的耐心和理解。" },
  { id: "partner", label: "合作洽谈", draft: "您好，感谢您对与我司合作的兴趣。我们期待探讨在贵地区开展分销合作的可能性。请问方便安排一次视频会议，进一步介绍双方业务情况吗？" },
  { id: "delay", label: "延期说明", draft: "您好，由于近期原材料供应紧张，您的订单（PO-XXXX）交货期将延后约 X 周，预计新发货日期为 XXXX 年 XX 月 XX 日。对此造成的不便深表歉意，如有疑问请联系我司。" },
  { id: "reject_quote", label: "拒绝报价", draft: "您好，感谢您发来的报价方案。经过内部评估，目前贵方价格与我方预算存在较大差距，暂时无法推进本次合作。期待日后有机会进一步合作，谢谢。" },
  { id: "thanks", label: "感谢函", draft: "您好，非常感谢贵方在合作过程中的支持与配合。贵方的专业态度和高效执行让我们印象深刻，期待未来继续深化合作，共创佳绩。" },
];

const generatedEmails: Record<string, Record<TargetLang, { subject: string; body: string }>> = {
  collect: {
    English: {
      subject: "Payment Reminder – Invoice INV-2026-XXX",
      body: "Dear [Customer Name],\n\nI hope this message finds you well. We would like to kindly remind you that Invoice INV-2026-XXX, amounting to USD XXX, was due on [date].\n\nWould you please arrange the payment at your earliest convenience? Should you have any questions or concerns, please do not hesitate to reach out to us.\n\nThank you for your continued partnership.\n\nBest regards,\nINOGI Finance Team",
    },
    Español: {
      subject: "Recordatorio de Pago – Factura INV-2026-XXX",
      body: "Estimado/a [Nombre del cliente],\n\nEsperamos que se encuentre bien. Le recordamos amablemente que la factura INV-2026-XXX, por un importe de USD XXX, venció el [fecha].\n\nLe agradecemos que gestione el pago a la brevedad posible. Si tiene alguna pregunta, no dude en contactarnos.\n\nGracias por su continua colaboración.\n\nAtentamente,\nEquipo Financiero INOGI",
    },
  },
  quote_reply: {
    English: {
      subject: "Quotation for CPAP Series – INOGI",
      body: "Dear [Customer Name],\n\nThank you for your interest in INOGI's CPAP product line.\n\nPlease find below our quotation for Model X300:\n• Unit Price: USD XXX\n• Minimum Order Quantity: 10 units\n• Certifications: CE, FDA\n• Lead Time: 4–6 weeks\n\nIf you require detailed specifications or a formal quotation document, please let us know and we will send it promptly.\n\nBest regards,\nINOGI Sales Team",
    },
    Español: {
      subject: "Cotización para Serie CPAP – INOGI",
      body: "Estimado/a [Nombre del cliente],\n\nGracias por su interés en la línea de productos CPAP de INOGI.\n\nA continuación le presentamos nuestra cotización para el Modelo X300:\n• Precio unitario: USD XXX\n• Cantidad mínima de pedido: 10 unidades\n• Certificaciones: CE, FDA\n• Plazo de entrega: 4–6 semanas\n\nSi necesita especificaciones detalladas o un documento de cotización formal, háganoslo saber.\n\nAtentamente,\nEquipo de Ventas INOGI",
    },
  },
};

const defaultGenerated: Record<TargetLang, { subject: string; body: string }> = {
  English: {
    subject: "[AI Generated Subject]",
    body: "Dear [Recipient],\n\nThank you for your message. We have carefully reviewed your inquiry and would like to provide the following response.\n\n[AI Generated content based on your Chinese draft will appear here]\n\nPlease feel free to contact us if you need further assistance.\n\nBest regards,\nINOGI Team",
  },
  Español: {
    subject: "[Asunto Generado por IA]",
    body: "Estimado/a [Destinatario],\n\nGracias por su mensaje. Hemos revisado cuidadosamente su consulta y nos gustaría proporcionarle la siguiente respuesta.\n\n[El contenido generado por IA basado en su borrador en chino aparecerá aquí]\n\nNo dude en contactarnos si necesita más ayuda.\n\nAtentamente,\nEquipo INOGI",
  },
};

export function EmailAIPage() {
  const [draftText, setDraftText] = useState("");
  const [targetLang, setTargetLang] = useState<TargetLang>("English");
  const [tone, setTone] = useState<Tone>("正式");
  const [generated, setGenerated] = useState<{ subject: string; body: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");

  const handleGenerate = () => {
    if (!draftText.trim()) {
      toast.error("请输入中文草稿或要点");
      return;
    }
    setIsGenerating(true);
    setTimeout(() => {
      // Try to match a template
      const matched = templates.find((t) => draftText.includes(t.draft.slice(0, 10)));
      const result = matched
        ? generatedEmails[matched.id]?.[targetLang] ?? defaultGenerated[targetLang]
        : defaultGenerated[targetLang];
      setGenerated(result);
      setEditSubject(result.subject);
      setEditBody(result.body);
      setIsGenerating(false);
      toast.success("邮件已生成");
    }, 1200);
  };

  const handleRegenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      const result = generated ?? defaultGenerated[targetLang];
      setEditBody(result.body + "\n\n[重新生成 · " + new Date().toLocaleTimeString() + "]");
      setIsGenerating(false);
      toast.success("已重新生成");
    }, 800);
  };

  const handleTemplateClick = (tpl: Template) => {
    setDraftText(tpl.draft);
    setTemplateOpen(false);
    toast.info(`已填入「${tpl.label}」模板`);
  };

  return (
    <div className="flex h-full gap-4 p-4 bg-gray-50 min-h-0">
      {/* Left: Input */}
      <div className="w-[420px] flex-shrink-0 flex flex-col gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-blue-500" />
            <h2 className="font-semibold text-gray-800 text-sm">邮件 AI 辅助写作</h2>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">输入中文意思或草稿</label>
            <textarea
              className="w-full h-36 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-gray-300"
              placeholder="输入中文意思或草稿，AI 将翻译并润色为商务邮件..."
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">目标语言</label>
            <div className="flex gap-2">
              {(["English", "Español"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setTargetLang(l)}
                  className={cn(
                    "flex-1 text-sm py-1.5 rounded-lg font-medium border transition-colors",
                    targetLang === l
                      ? "bg-blue-500 text-white border-blue-500"
                      : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">语气风格</label>
            <div className="flex gap-1.5 flex-wrap">
              {(["正式", "友好", "强硬", "委婉拒绝"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTone(t)}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full border transition-colors",
                    tone === t
                      ? "bg-blue-50 border-blue-400 text-blue-700 font-medium"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
          >
            {isGenerating ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                AI 生成邮件
              </>
            )}
          </button>
        </div>

        {/* Template Library */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <button
            onClick={() => setTemplateOpen(!templateOpen)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-medium text-gray-700"
          >
            <span>场景模板库</span>
            {templateOpen ? (
              <ChevronUp className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            )}
          </button>
          {templateOpen && (
            <div className="px-4 pb-4 border-t border-gray-50 pt-3 grid grid-cols-2 gap-2">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => handleTemplateClick(tpl)}
                  className="text-left text-xs bg-gray-50 hover:bg-blue-50 hover:text-blue-700 text-gray-600 px-3 py-2 rounded-lg border border-gray-100 hover:border-blue-200 transition-colors font-medium"
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: Generated Email Preview */}
      <div className="flex-1 min-w-0 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col">
        {generated ? (
          <>
            <div className="px-6 pt-5 pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2 mb-4">
                <Mail className="w-4 h-4 text-blue-500" />
                <h3 className="font-semibold text-gray-800 text-sm">生成邮件预览</h3>
                <span className="ml-auto text-xs text-gray-400">{targetLang} · {tone}</span>
              </div>
              <div className="space-y-2.5">
                {[
                  { label: "发件人", value: "sales@inogi.com" },
                  { label: "收件人", value: "" },
                ].map((f) => (
                  <div key={f.label} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-12 flex-shrink-0">{f.label}</span>
                    <input
                      className="flex-1 text-sm text-gray-700 border-b border-gray-100 focus:border-blue-300 focus:outline-none py-0.5 bg-transparent"
                      defaultValue={f.value}
                      placeholder={f.label === "收件人" ? "输入收件人邮箱..." : undefined}
                    />
                  </div>
                ))}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-12 flex-shrink-0">主题</span>
                  <input
                    className="flex-1 text-sm font-medium text-gray-800 border-b border-gray-100 focus:border-blue-300 focus:outline-none py-0.5 bg-transparent"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="flex-1 px-6 py-4 flex flex-col gap-3 min-h-0">
              <textarea
                className="flex-1 min-h-0 w-full text-sm text-gray-700 border border-gray-100 rounded-lg p-4 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300 font-mono leading-relaxed"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
              />
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleRegenerate}
                  className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" /> 重新生成
                </button>
                <button
                  onClick={() => { navigator.clipboard.writeText(`Subject: ${editSubject}\n\n${editBody}`); toast.success("已复制全文"); }}
                  className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
                >
                  <Copy className="w-3 h-3" /> 复制全文
                </button>
                <button
                  onClick={() => toast.success("已在邮件客户端打开")}
                  className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
                >
                  <Mail className="w-3 h-3" /> 用邮件客户端发送
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-300 gap-3">
            <Mail className="w-12 h-12 opacity-30" />
            <p className="text-sm">在左侧输入内容后点击「AI 生成邮件」</p>
          </div>
        )}
      </div>
    </div>
  );
}
