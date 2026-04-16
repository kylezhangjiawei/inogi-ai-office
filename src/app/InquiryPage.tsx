import React, { useState } from "react";
import {
  Bot,
  CheckSquare,
  ChevronRight,
  Copy,
  Globe,
  Mail,
  MessageCircle,
  RefreshCw,
  Send,
  Square,
  Sparkles,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

type Channel = "WhatsApp" | "Email" | "LinkedIn";
type Intent = "询价" | "型号咨询" | "认证资质" | "售后问题" | "合作意向";
type Tone = "正式" | "友好" | "强硬" | "委婉拒绝";

interface Inquiry {
  id: number;
  channel: Channel;
  sender: string;
  country: string;
  preview: string;
  fullMessage: string;
  timestamp: string;
  unread: boolean;
  intent: Intent;
  confidence: number;
  intentReason: string;
  requiredInfo: { label: string; received: boolean }[];
}

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
    country: "墨西哥",
    preview: "Hello, we are interested in your CPAP devices for distribution in Mexico...",
    fullMessage:
      "Hello, we are interested in your CPAP devices for distribution in Mexico. Could you please provide us with pricing for 500 units? We also need to know about CE and FDA certifications. Our company is a registered medical device importer.",
    timestamp: "10:32",
    unread: true,
    intent: "合作意向",
    confidence: 92,
    intentReason: "消息明确提及分销合作意向及批量采购需求，并询问资质认证",
    requiredInfo: [
      { label: "目标国家", received: true },
      { label: "用途场景", received: false },
      { label: "年采购量", received: false },
      { label: "付款方式", received: false },
      { label: "认证要求", received: true },
    ],
  },
  {
    id: 2,
    channel: "Email",
    sender: "Ahmed Al-Rashid",
    country: "沙特",
    preview: "Inquiry about your BiPAP model specifications and pricing...",
    fullMessage:
      "Dear team, I am writing to inquire about your BiPAP product range. We are a hospital in Riyadh looking to procure 50 units for our sleep lab. Please provide detailed specifications, pricing, and availability of after-sales service in Saudi Arabia.",
    timestamp: "09:15",
    unread: true,
    intent: "询价",
    confidence: 88,
    intentReason: "明确提出采购需求和数量，属于医疗机构直采场景",
    requiredInfo: [
      { label: "目标国家", received: true },
      { label: "用途场景", received: true },
      { label: "年采购量", received: false },
      { label: "付款方式", received: false },
      { label: "认证要求", received: false },
    ],
  },
  {
    id: 3,
    channel: "LinkedIn",
    sender: "Sophie Laurent",
    country: "法国",
    preview: "Bonjour, je souhaite obtenir des informations sur vos certifications CE...",
    fullMessage:
      "Bonjour, je souhaite obtenir des informations sur vos certifications CE MDR pour vos appareils CPAP. Notre société prépare un dossier d'enregistrement en France et nous avons besoin de vos documents de conformité.",
    timestamp: "昨天",
    unread: false,
    intent: "认证资质",
    confidence: 95,
    intentReason: "询问 CE MDR 认证文件，明确为注册资质合规需求",
    requiredInfo: [
      { label: "目标国家", received: true },
      { label: "认证类型", received: true },
      { label: "产品型号", received: false },
      { label: "用途场景", received: false },
    ],
  },
  {
    id: 4,
    channel: "WhatsApp",
    sender: "Priya Sharma",
    country: "印度",
    preview: "Hi, our CPAP device showing E3 error code, need support...",
    fullMessage:
      "Hi, we purchased 20 units of your CPAP model X300 last year. Three units are now showing E3 error code and the humidifier function has stopped working. Please advise on warranty repair or replacement process.",
    timestamp: "昨天",
    unread: false,
    intent: "售后问题",
    confidence: 97,
    intentReason: "描述设备故障报错，属于售后维修场景",
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
    country: "德国",
    preview: "We would like to know which CPAP model is suitable for home use...",
    fullMessage:
      "We would like to know which CPAP model from your range is suitable for home use in Germany. We are a distributor looking for a product that meets German medical device regulations. Could you share product comparison charts?",
    timestamp: "2天前",
    unread: false,
    intent: "型号咨询",
    confidence: 85,
    intentReason: "咨询适合特定市场的产品型号选择，属于产品推荐场景",
    requiredInfo: [
      { label: "目标国家", received: true },
      { label: "用途场景", received: true },
      { label: "年采购量", received: false },
      { label: "认证要求", received: false },
    ],
  },
];

const replyTemplates: Record<string, Record<"中文" | "English" | "Español", string>> = {
  合作意向: {
    中文: `尊敬的合作伙伴，\n\n感谢您对我司产品的关注，非常高兴了解您有意在当地开展分销合作。\n\n我司产品已获 CE、FDA 相关认证，具备完善的售后体系。针对您的合作意向，我们希望进一步了解：\n• 贵方目标区域及年度预计采购量\n• 现有的医疗设备进口资质\n• 期望的付款及交货条件\n\n期待与您深入沟通，欢迎随时联系。\n\n此致\nINOGI 销售团队`,
    English: `Dear Partner,\n\nThank you for your interest in our products. We are delighted to learn about your intention to become a distributor in your region.\n\nOur products are CE and FDA certified with a comprehensive after-sales network. To proceed further, we would appreciate if you could share:\n• Target region and estimated annual purchase volume\n• Your existing medical device import licenses\n• Preferred payment and delivery terms\n\nWe look forward to a fruitful partnership.\n\nBest regards,\nINOGI Sales Team`,
    Español: `Estimado socio,\n\nGracias por su interés en nuestros productos. Nos complace conocer su intención de convertirse en distribuidor en su región.\n\nNuestros productos cuentan con certificaciones CE y FDA y una red de posventa completa. Para avanzar, nos gustaría que compartiera:\n• Región objetivo y volumen anual estimado de compras\n• Sus licencias existentes de importación de dispositivos médicos\n• Condiciones de pago y entrega preferidas\n\nEsperamos una colaboración fructífera.\n\nAtentamente,\nEquipo de Ventas INOGI`,
  },
};

const defaultReply = {
  中文: "尊敬的客户，\n\n感谢您的来信，我们已收到您的询问并将尽快为您处理。\n\n如有任何疑问，欢迎随时联系。\n\n此致\nINOGI 团队",
  English:
    "Dear Customer,\n\nThank you for reaching out. We have received your inquiry and will get back to you as soon as possible.\n\nPlease feel free to contact us if you have any questions.\n\nBest regards,\nINOGI Team",
  Español:
    "Estimado cliente,\n\nGracias por ponerse en contacto con nosotros. Hemos recibido su consulta y nos pondremos en contacto con usted a la brevedad posible.\n\nNo dude en contactarnos si tiene alguna pregunta.\n\nAtentamente,\nEquipo INOGI",
};

export function InquiryPage() {
  const [selected, setSelected] = useState<Inquiry>(mockInquiries[0]);
  const [lang, setLang] = useState<"中文" | "English" | "Español">("中文");
  const [tone, setTone] = useState<Tone>("友好");
  const [replyText, setReplyText] = useState<string>(() => {
    const tpl = replyTemplates[mockInquiries[0].intent];
    return tpl ? tpl["中文"] : defaultReply["中文"];
  });
  const [checkedInfo, setCheckedInfo] = useState<Record<string, boolean>>({});
  const [crmOpen, setCrmOpen] = useState(false);

  const handleSelectInquiry = (inq: Inquiry) => {
    setSelected(inq);
    const tpl = replyTemplates[inq.intent];
    setReplyText(tpl ? tpl[lang] : defaultReply[lang]);
    setCheckedInfo({});
  };

  const handleLangChange = (l: "中文" | "English" | "Español") => {
    setLang(l);
    const tpl = replyTemplates[selected.intent];
    setReplyText(tpl ? tpl[l] : defaultReply[l]);
  };

  const handleRegenerate = () => {
    toast.success("已重新生成回复草稿");
    const tpl = replyTemplates[selected.intent];
    setReplyText((tpl ? tpl[lang] : defaultReply[lang]) + "\n\n[重新生成 · " + new Date().toLocaleTimeString() + "]");
  };

  const ChannelIcon = channelConfig[selected.channel].icon;

  return (
    <div className="flex h-full gap-4 p-4 bg-gray-50 min-h-0">
      {/* Left: Inquiry Inbox */}
      <div className="w-72 flex-shrink-0 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col">
        <div className="px-4 pt-4 pb-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm">询盘收件箱</h2>
          <p className="text-xs text-gray-400 mt-0.5">{mockInquiries.filter((i) => i.unread).length} 条未读</p>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {mockInquiries.map((inq) => {
            const cfg = channelConfig[inq.channel];
            const Icon = cfg.icon;
            return (
              <button
                key={inq.id}
                onClick={() => handleSelectInquiry(inq)}
                className={cn(
                  "w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors",
                  selected.id === inq.id && "bg-teal-50"
                )}
              >
                <div className="flex items-start gap-2">
                  <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5", cfg.bg)}>
                    <Icon className={cn("w-4 h-4", cfg.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sm font-medium text-gray-800 truncate">{inq.sender}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">{inq.timestamp}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {inq.unread && <span className="w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />}
                      <span className="text-xs text-gray-500 truncate">{inq.preview}</span>
                    </div>
                    <div className="mt-1">
                      <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium", intentConfig[inq.intent])}>
                        {inq.intent}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Center: Inquiry Detail + AI Analysis */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {/* Message */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", channelConfig[selected.channel].bg)}>
              <ChannelIcon className={cn("w-4 h-4", channelConfig[selected.channel].color)} />
            </div>
            <div>
              <div className="font-semibold text-gray-800 text-sm">{selected.sender}</div>
              <div className="text-xs text-gray-400">{selected.channel} · {selected.country} · {selected.timestamp}</div>
            </div>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-lg p-3">{selected.fullMessage}</p>
        </div>

        {/* AI Intent Analysis */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-teal-500" />
            <h3 className="font-semibold text-gray-800 text-sm">AI 意图分析</h3>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <span className={cn("text-sm px-2.5 py-1 rounded-full font-medium", intentConfig[selected.intent])}>
              {selected.intent}
            </span>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-24 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal-400 rounded-full"
                  style={{ width: `${selected.confidence}%` }}
                />
              </div>
              <span className="text-xs text-gray-500">置信度 {selected.confidence}%</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-4">{selected.intentReason}</p>

          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">所需信息核查</h4>
          <div className="space-y-1.5">
            {selected.requiredInfo.map((item) => (
              <label key={item.label} className="flex items-center gap-2 cursor-pointer group">
                <button
                  onClick={() => setCheckedInfo((prev) => ({ ...prev, [item.label]: !prev[item.label] }))}
                  className="flex-shrink-0"
                >
                  {checkedInfo[item.label] ?? item.received ? (
                    <CheckSquare className="w-4 h-4 text-teal-500" />
                  ) : (
                    <Square className="w-4 h-4 text-gray-300" />
                  )}
                </button>
                <span className={cn("text-sm", (checkedInfo[item.label] ?? item.received) ? "text-gray-400 line-through" : "text-gray-700")}>
                  {item.label}
                </span>
                {!item.received && !(checkedInfo[item.label]) && (
                  <span className="text-xs text-orange-500 font-medium">待获取</span>
                )}
              </label>
            ))}
          </div>
        </div>

        {/* CRM Lead Entry */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <button
            onClick={() => setCrmOpen(!crmOpen)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-xl"
          >
            <span>线索台账录入</span>
            <ChevronRight className={cn("w-4 h-4 text-gray-400 transition-transform", crmOpen && "rotate-90")} />
          </button>
          {crmOpen && (
            <div className="px-5 pb-4 grid grid-cols-3 gap-3 border-t border-gray-50 pt-3">
              {[
                { label: "客户名", value: selected.sender },
                { label: "国家", value: selected.country },
                { label: "需求类型", value: selected.intent },
                { label: "当前阶段", value: "初步接触 L1" },
                { label: "下一步行动", value: "发送产品资料" },
                { label: "预计金额", value: "—" },
              ].map((f) => (
                <div key={f.label}>
                  <div className="text-xs text-gray-400 mb-1">{f.label}</div>
                  <input
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    defaultValue={f.value}
                  />
                </div>
              ))}
              <div className="col-span-3 flex justify-end mt-1">
                <button
                  onClick={() => toast.success("线索已保存到台账")}
                  className="bg-teal-500 hover:bg-teal-600 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
                >
                  保存到线索台账
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: AI Reply Generator */}
      <div className="w-80 flex-shrink-0 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col">
        <div className="px-4 pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <Bot className="w-4 h-4 text-teal-500" />
            <h3 className="font-semibold text-gray-800 text-sm">AI 回复生成</h3>
          </div>
          {/* Language */}
          <div className="flex gap-1 mb-2">
            {(["中文", "English", "Español"] as const).map((l) => (
              <button
                key={l}
                onClick={() => handleLangChange(l)}
                className={cn(
                  "flex-1 text-xs py-1 rounded-lg font-medium transition-colors",
                  lang === l ? "bg-teal-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                )}
              >
                {l}
              </button>
            ))}
          </div>
          {/* Tone */}
          <div className="flex gap-1 flex-wrap">
            {(["正式", "友好", "强硬", "委婉拒绝"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTone(t)}
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full border transition-colors",
                  tone === t
                    ? "border-teal-400 bg-teal-50 text-teal-700"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 p-4 flex flex-col gap-3 min-h-0">
          <textarea
            className="flex-1 min-h-0 w-full text-sm text-gray-700 border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-1 focus:ring-teal-400"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={handleRegenerate}
              className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> 重新生成
            </button>
            <button
              onClick={() => { navigator.clipboard.writeText(replyText); toast.success("已复制"); }}
              className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
            >
              <Copy className="w-3 h-3" /> 复制
            </button>
            <button
              onClick={() => toast.success("已发送")}
              className="flex items-center gap-1.5 text-xs bg-teal-500 hover:bg-teal-600 text-white rounded-lg px-3 py-1.5 transition-colors ml-auto"
            >
              <Send className="w-3 h-3" /> 发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
