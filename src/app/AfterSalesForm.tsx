import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileBox,
  FileText,
  Image,
  Plus,
  Save,
  Upload,
  User,
  Video,
  Wand2,
  X,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { HorizonPageHeader, HorizonSectionHeader } from "./components/horizon/HorizonPage";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "./lib/routePaths";

const steps = [
  { id: 1, name: "填写信息", icon: User },
  { id: 2, name: "AI 摘要", icon: Wand2 },
  { id: 3, name: "确认提交", icon: CheckCircle2 },
];

const issueOptions = ["报警", "不出液", "异常噪音", "开机故障", "其他"];
const workModes = ["1档", "2档", "3档", "持续流"];

const uploadSlots = [
  { key: "photos", title: "现场图片", hint: "产品铭牌、故障界面或现场环境照片", icon: Image, badge: "JPG / PNG" },
  { key: "videos", title: "运行视频", hint: "30 秒以内演示视频，便于识别噪音或灯效", icon: Video, badge: "MP4 / MOV" },
  { key: "reports", title: "检测记录", hint: "现场排查表、维保记录或第三方测试附件", icon: FileBox, badge: "PDF / XLSX" },
] as const;

type UploadKey = (typeof uploadSlots)[number]["key"];
type RequiredField = "customerName" | "productModel" | "serialNumber" | "reportDate" | "issueTypes" | "workMode" | "description" | "selfChecked";

const requiredFieldLabels: Record<RequiredField, string> = {
  customerName: "客户名称",
  productModel: "产品型号",
  serialNumber: "序列号",
  reportDate: "报障日期",
  issueTypes: "问题类型",
  workMode: "工作模式",
  description: "问题现象描述",
  selfChecked: "是否已自查",
};

const selectClassName = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus-visible:border-[#002fa7] focus-visible:ring-2 focus-visible:ring-[#002fa7]/20";

export function AfterSalesForm() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    customerName: "",
    productModel: "",
    serialNumber: "",
    reportDate: "",
    issueTypes: [] as string[],
    workMode: "",
    description: "",
    selfChecked: "",
    environment: "",
  });
  const [attachments, setAttachments] = useState<Record<UploadKey, string[]>>({ photos: [], videos: [], reports: [] });
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const totalAttachments = useMemo(() => Object.values(attachments).reduce((count, files) => count + files.length, 0), [attachments]);

  const getMissingFields = (): RequiredField[] => {
    const missing: RequiredField[] = [];
    if (!formData.customerName) missing.push("customerName");
    if (!formData.productModel) missing.push("productModel");
    if (!formData.serialNumber) missing.push("serialNumber");
    if (!formData.reportDate) missing.push("reportDate");
    if (formData.issueTypes.length === 0) missing.push("issueTypes");
    if (!formData.workMode) missing.push("workMode");
    if (!formData.description) missing.push("description");
    if (!formData.selfChecked) missing.push("selfChecked");
    return missing;
  };

  const missingFields = getMissingFields();
  const isMissing = (field: RequiredField) => showErrors && missingFields.includes(field);
  const completion = Math.round(((8 - missingFields.length) / 8) * 100);

  const toggleIssueType = (type: string) => {
    setFormData((prev) => ({
      ...prev,
      issueTypes: prev.issueTypes.includes(type) ? prev.issueTypes.filter((item) => item !== type) : [...prev.issueTypes, type],
    }));
  };

  const generateAiSummary = () => {
    setAiGenerating(true);
    setTimeout(() => {
      setAiSummary(`AI 已根据 ${formData.customerName} 提交的 ${formData.productModel} 工单生成摘要：设备序列号 ${formData.serialNumber}，故障模式为 ${formData.issueTypes.join("、")}，当前工作模式 ${formData.workMode}。结合描述“${formData.description}”，系统建议优先检查泵头密封、主板传感反馈与耗材连接状态，并将该问题暂定为 P2 优先级。`);
      setAiGenerating(false);
      toast.success("AI 摘要已生成，可继续确认并流转工单");
    }, 1500);
  };

  const handleNext = () => {
    if (currentStep === 1) {
      if (missingFields.length > 0) {
        setShowErrors(true);
        toast.error(`请先补全：${missingFields.map((field) => requiredFieldLabels[field]).join("、")}`);
        return;
      }
      setShowErrors(false);
      generateAiSummary();
      setCurrentStep(2);
      return;
    }
    if (currentStep === 2) setCurrentStep(3);
  };

  const handleUpload = (slot: UploadKey) => {
    const mockFile = `${slot}-${attachments[slot].length + 1}.mock`;
    setAttachments((prev) => ({ ...prev, [slot]: [...prev[slot], mockFile] }));
    toast.success(`已添加 1 份${slot === "photos" ? "图片" : slot === "videos" ? "视频" : "附件"}示例`);
  };

  const handleRemoveAttachment = (slot: UploadKey, fileName: string) => {
    setAttachments((prev) => ({ ...prev, [slot]: prev[slot].filter((item) => item !== fileName) }));
    toast.success("附件已移除");
  };

  const handleSaveDraft = () => toast.success(`草稿已保存，当前已填写 ${8 - missingFields.length}/8 个必填项`);

  const handleSubmit = () => {
    toast.success("售后工单已提交，已进入待受理列表");
    navigate(routePath("page:after-sales", "/after-sales"));
  };

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full max-w-[1120px] min-w-0 flex-col gap-4 px-3 py-4 pb-28 sm:p-5 sm:pb-28 lg:p-6 lg:pb-28">
      <HorizonPageHeader
        Icon={ClipboardList}
        eyebrow="售后服务 · Case 录入"
        title="新建售后工单"
        description="录入客户与设备信息、补充现场证据，并在提交前复核 AI 技术摘要。"
        meta={<><span>必填项完成度 {completion}%</span><span aria-hidden="true">·</span><span>{totalAttachments} 个附件</span></>}
        actions={<Button asChild variant="outline"><Link to={routePath("page:after-sales", "/after-sales")}><ArrowLeft className="size-4" />返回列表</Link></Button>}
      />

      <nav className="hz-surface overflow-x-auto p-3" aria-label="新建工单步骤">
        <ol className="grid min-w-[520px] grid-cols-3">
          {steps.map((step) => {
            const complete = currentStep > step.id;
            const active = currentStep === step.id;
            return (
              <li key={step.id} className={cn("relative flex items-center gap-3 px-4 py-2 after:absolute after:left-[calc(50%+1.5rem)] after:right-[calc(-50%+1.5rem)] after:top-1/2 after:h-px after:bg-slate-200 last:after:hidden", complete && "after:bg-[#002fa7]")} aria-current={active ? "step" : undefined}>
                <span className={cn("relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border bg-white", complete || active ? "border-[#002fa7] text-[#002fa7]" : "border-slate-200 text-slate-400")} aria-hidden="true">
                  {complete ? <Check className="size-4" /> : <step.icon className="size-4" />}
                </span>
                <span className="relative z-10 min-w-0 bg-white pr-2"><span className="block text-xs text-slate-500 tabular-nums">步骤 {step.id}</span><span className={cn("block text-sm font-semibold", active || complete ? "text-slate-800" : "text-slate-400")}>{step.name}</span></span>
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="hz-surface min-w-0 overflow-hidden">
        {currentStep === 1 ? (
          <div>
            <HorizonSectionHeader Icon={User} title="客户与设备" description="带 * 的信息用于识别设备与建立响应时效。" />
            <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-2">
              <Field label="客户名称 *" htmlFor="case-customer" error={isMissing("customerName") ? "请输入客户单位名称" : undefined}>
                <Input id="case-customer" value={formData.customerName} onChange={(event) => setFormData({ ...formData, customerName: event.target.value })} placeholder="请输入客户单位名称" aria-invalid={isMissing("customerName")} className="h-10 rounded-xl" />
              </Field>
              <Field label="产品型号 *" htmlFor="case-product" error={isMissing("productModel") ? "请选择产品型号" : undefined}>
                <select id="case-product" value={formData.productModel} onChange={(event) => setFormData({ ...formData, productModel: event.target.value })} aria-invalid={isMissing("productModel")} className={selectClassName}><option value="">请选择产品型号</option><option value="OC-3">OC-3</option><option value="OC-5">OC-5</option><option value="OC-10">OC-10</option></select>
              </Field>
              <Field label="序列号 *" htmlFor="case-sn" error={isMissing("serialNumber") ? "请输入设备序列号" : undefined}>
                <Input id="case-sn" value={formData.serialNumber} onChange={(event) => setFormData({ ...formData, serialNumber: event.target.value })} placeholder="格式：SN12345678" aria-invalid={isMissing("serialNumber")} className="h-10 rounded-xl font-mono" />
              </Field>
              <Field label="报障日期 *" htmlFor="case-date" error={isMissing("reportDate") ? "请选择报障日期" : undefined}>
                <Input id="case-date" type="date" value={formData.reportDate} onChange={(event) => setFormData({ ...formData, reportDate: event.target.value })} aria-invalid={isMissing("reportDate")} className="h-10 rounded-xl tabular-nums" />
              </Field>
            </div>

            <HorizonSectionHeader Icon={AlertCircle} title="故障描述" description="提供复现条件与自查结果，有助于技术团队快速判断。" />
            <div className="space-y-5 p-4 sm:p-5">
              <fieldset className="space-y-2" aria-invalid={isMissing("issueTypes")}>
                <legend className="text-sm font-medium text-slate-700">问题类型 *</legend>
                <div className="flex flex-wrap gap-2">{issueOptions.map((type) => <Button key={type} type="button" size="sm" variant={formData.issueTypes.includes(type) ? "default" : "outline"} className={cn(formData.issueTypes.includes(type) && "bg-[#002fa7] hover:bg-[#002581]")} aria-pressed={formData.issueTypes.includes(type)} onClick={() => toggleIssueType(type)}>{type}</Button>)}</div>
                {isMissing("issueTypes") ? <FieldError>请至少选择一种问题类型</FieldError> : null}
              </fieldset>

              <fieldset className="space-y-2" aria-invalid={isMissing("workMode")}>
                <legend className="text-sm font-medium text-slate-700">工作模式 *</legend>
                <div className="flex flex-wrap gap-x-6 gap-y-3">{workModes.map((mode) => <label key={mode} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"><input type="radio" name="workMode" value={mode} checked={formData.workMode === mode} onChange={(event) => setFormData({ ...formData, workMode: event.target.value })} className="size-4 accent-[#002fa7]" />{mode}</label>)}</div>
                {isMissing("workMode") ? <FieldError>请选择设备当前工作模式</FieldError> : null}
              </fieldset>

              <Field label="问题现象描述 *" htmlFor="case-description" error={isMissing("description") ? "请描述故障现象与复现条件" : undefined}>
                <Textarea id="case-description" rows={5} value={formData.description} onChange={(event) => setFormData({ ...formData, description: event.target.value })} placeholder="例如：启动 3 分钟后出现连续报警，流量输出显著下降。" aria-invalid={isMissing("description")} className="min-h-28 rounded-xl" />
              </Field>

              <div className="grid gap-5 md:grid-cols-2">
                <Field label="是否已自查 *" htmlFor="case-self-check" error={isMissing("selfChecked") ? "请选择自查状态" : undefined}>
                  <select id="case-self-check" value={formData.selfChecked} onChange={(event) => setFormData({ ...formData, selfChecked: event.target.value })} aria-invalid={isMissing("selfChecked")} className={selectClassName}><option value="">请选择</option><option value="已自查">已自查</option><option value="未自查">未自查</option></select>
                </Field>
                <Field label="环境说明" htmlFor="case-environment">
                  <Input id="case-environment" value={formData.environment} onChange={(event) => setFormData({ ...formData, environment: event.target.value })} placeholder="温度、湿度、电源、现场备注" className="h-10 rounded-xl" />
                </Field>
              </div>
            </div>

            <HorizonSectionHeader Icon={Upload} title="现场附件" description="附件不是必填项，但能显著缩短首次诊断时间。" trailing={<span className="text-xs text-slate-500 tabular-nums">{totalAttachments} 个文件</span>} />
            <div className="p-4 sm:p-5">
              <div className="grid gap-3 md:grid-cols-3">
                {uploadSlots.map((slot) => <button key={slot.key} type="button" onClick={() => handleUpload(slot.key)} className="min-w-0 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-left transition-colors hover:border-[#002fa7] hover:bg-[#f7f9ff]"><div className="flex items-center justify-between gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-[#eef3ff] text-[#002fa7]" aria-hidden="true"><slot.icon className="size-4" /></span><span className="text-xs text-slate-500">{slot.badge}</span></div><div className="mt-3 text-sm font-semibold text-slate-800">{slot.title}</div><p className="mt-1 text-xs text-pretty leading-5 text-slate-500">{slot.hint}</p><div className="mt-3 flex items-center gap-1 text-xs font-semibold text-[#002fa7]"><Plus className="size-3.5" />添加示例附件</div></button>)}
              </div>
              {totalAttachments > 0 ? <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">{uploadSlots.flatMap((slot) => attachments[slot.key].map((file) => <div key={`${slot.key}-${file}`} className="flex min-w-0 items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><div className="truncate text-sm font-medium text-slate-800">{file}</div><div className="mt-0.5 text-xs text-slate-500">{slot.title}</div></div><Button type="button" variant="ghost" size="icon" aria-label={`移除附件 ${file}`} onClick={() => handleRemoveAttachment(slot.key, file)}><X className="size-4" /></Button></div>))}</div> : null}
            </div>
          </div>
        ) : null}

        {currentStep === 2 ? (
          <div>
            <HorizonSectionHeader Icon={Wand2} title="AI 技术摘要" description="根据表单与附件生成初步分类，最终结论仍需技术人员复核。" trailing={<Button type="button" variant="outline" size="sm" onClick={generateAiSummary} disabled={aiGenerating}><Wand2 className="size-4" />重新生成</Button>} />
            <div className="p-4 sm:p-6">
              {aiGenerating ? <div className="flex min-h-48 flex-col items-center justify-center text-center"><span className="flex size-11 items-center justify-center rounded-xl bg-[#eef3ff] text-[#002fa7]" aria-hidden="true"><Wand2 className="size-5" /></span><div className="mt-4 font-semibold text-slate-800">AI 正在生成摘要</div><p className="mt-1 text-sm text-pretty text-slate-500">正在归纳故障现象、资料完整度和推荐响应级别。</p><div className="mt-5 h-2 w-full max-w-sm overflow-hidden rounded-full bg-slate-100"><div className="h-full w-[92%] rounded-full bg-[#002fa7]" /></div></div> : <div className="space-y-5"><div><div className="text-xs font-semibold text-slate-500">AI 分派建议</div><h2 className="mt-1 text-balance text-lg font-semibold text-slate-900">建议分派给售后二线技术组</h2></div><p className="rounded-xl bg-slate-50 p-4 text-sm text-pretty leading-7 text-slate-700">{aiSummary}</p><dl className="grid divide-y divide-slate-100 border-y border-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">{[{ label: "建议优先级", value: "P2 普通紧急" }, { label: "推荐 SLA", value: "24 小时响应" }, { label: "资料完整度", value: `${Math.min(100, 68 + totalAttachments * 8)}%` }].map((item) => <div key={item.label} className="px-4 py-3"><dt className="text-xs text-slate-500">{item.label}</dt><dd className="mt-1 font-semibold text-slate-900 tabular-nums">{item.value}</dd></div>)}</dl></div>}
            </div>
          </div>
        ) : null}

        {currentStep === 3 ? (
          <div>
            <HorizonSectionHeader Icon={FileText} title="提交前确认" description="确认以下 Case 信息无误后提交至待受理队列。" />
            <div className="p-4 sm:p-6">
              <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">{[
                ["客户", formData.customerName], ["产品型号", formData.productModel], ["序列号", formData.serialNumber], ["报障日期", formData.reportDate],
                ["问题类型", formData.issueTypes.join("、")], ["工作模式", formData.workMode], ["自查情况", formData.selfChecked], ["附件数量", `${totalAttachments} 个`],
              ].map(([label, value]) => <div key={label} className="border-b border-slate-100 pb-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-800 tabular-nums">{value}</dd></div>)}</dl>
              <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-pretty text-amber-900"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>提交后工单将进入“待受理”状态，并同步生成一条 AI 摘要记录供二线技术组查看。</p></div>
            </div>
          </div>
        ) : null}
      </main>

      <div className="sticky bottom-0 z-20 -mx-3 border-t border-slate-200 bg-white px-4 pb-3 pt-3 sm:-mx-5 lg:-mx-6">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))} disabled={currentStep === 1}><ChevronLeft className="size-4" />上一步</Button>
          <div className="flex flex-col gap-2 sm:flex-row"><Button type="button" variant="outline" onClick={handleSaveDraft}><Save className="size-4" />保存草稿</Button>{currentStep < 3 ? <Button type="button" className="bg-[#002fa7] hover:bg-[#002581]" onClick={handleNext}>下一步<ChevronRight className="size-4" /></Button> : <Button type="button" className="bg-[#002fa7] hover:bg-[#002581]" onClick={handleSubmit}>提交工单<CheckCircle2 className="size-4" /></Button>}</div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={htmlFor} className="text-slate-700">{label}</Label>{children}{error ? <FieldError>{error}</FieldError> : null}</div>;
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="flex items-center gap-1.5 text-xs text-red-600" role="alert"><AlertCircle className="size-3.5" aria-hidden="true" />{children}</p>;
}
