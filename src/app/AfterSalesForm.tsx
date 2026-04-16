import React, { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileBox,
  FileText,
  Plus,
  Upload,
  User,
  Video,
  Wand2,
  X,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const steps = [
  { id: 1, name: "填写信息", icon: User },
  { id: 2, name: "AI 摘要", icon: Wand2 },
  { id: 3, name: "确认提交", icon: CheckCircle2 },
];

const issueOptions = ["报警", "不出液", "异常噪音", "开机故障", "其他"];
const workModes = ["1档", "2档", "3档", "持续流"];

const uploadSlots = [
  {
    key: "photos",
    title: "现场图片",
    hint: "上传产品铭牌、故障界面或现场环境照片",
    icon: Upload,
    badge: "JPG/PNG",
  },
  {
    key: "videos",
    title: "运行视频",
    hint: "上传 30 秒以内演示视频，方便 AI 识别噪音或异常灯效",
    icon: Video,
    badge: "MP4/MOV",
  },
  {
    key: "reports",
    title: "检测记录",
    hint: "上传现场排查表、维保记录或第三方测试附件",
    icon: FileBox,
    badge: "PDF/XLSX",
  },
] as const;

type UploadKey = (typeof uploadSlots)[number]["key"];

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
  const [attachments, setAttachments] = useState<Record<UploadKey, string[]>>({
    photos: [],
    videos: [],
    reports: [],
  });
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSummary, setAiSummary] = useState("");

  const totalAttachments = useMemo(
    () => Object.values(attachments).reduce((count, files) => count + files.length, 0),
    [attachments],
  );

  const isFormValid = () =>
    Boolean(
      formData.customerName &&
        formData.productModel &&
        formData.serialNumber &&
        formData.reportDate &&
        formData.issueTypes.length > 0 &&
        formData.workMode &&
        formData.description &&
        formData.selfChecked,
    );

  const getMissingFields = () => {
    const missing: string[] = [];
    if (!formData.customerName) missing.push("客户名称");
    if (!formData.productModel) missing.push("产品型号");
    if (!formData.serialNumber) missing.push("序列号");
    if (!formData.reportDate) missing.push("报障日期");
    if (formData.issueTypes.length === 0) missing.push("问题类型");
    if (!formData.workMode) missing.push("工作模式");
    if (!formData.description) missing.push("问题现象描述");
    if (!formData.selfChecked) missing.push("是否已自查");
    return missing;
  };

  const toggleIssueType = (type: string) => {
    setFormData((prev) => ({
      ...prev,
      issueTypes: prev.issueTypes.includes(type)
        ? prev.issueTypes.filter((item) => item !== type)
        : [...prev.issueTypes, type],
    }));
  };

  const generateAiSummary = () => {
    setAiGenerating(true);
    setTimeout(() => {
      setAiSummary(
        `AI 已根据 ${formData.customerName} 提交的 ${formData.productModel} 工单生成摘要：设备序列号 ${formData.serialNumber}，故障模式为 ${formData.issueTypes.join("、")}，当前工作模式 ${formData.workMode}。结合描述“${formData.description}”，系统建议优先检查泵头密封、主板传感反馈与耗材连接状态，并将该问题暂定为 P2 优先级。`,
      );
      setAiGenerating(false);
      toast.success("AI 摘要已生成，可继续确认并流转工单");
    }, 1500);
  };

  const handleNext = () => {
    if (currentStep === 1) {
      if (!isFormValid()) {
        toast.error(`请先补全：${getMissingFields().join("、")}`);
        return;
      }
      generateAiSummary();
      setCurrentStep(2);
      return;
    }

    if (currentStep === 2) {
      setCurrentStep(3);
    }
  };

  const handleUpload = (slot: UploadKey) => {
    const mockFile = `${slot}-${attachments[slot].length + 1}.mock`;
    setAttachments((prev) => ({
      ...prev,
      [slot]: [...prev[slot], mockFile],
    }));
    toast.success(`已添加 1 份${slot === "photos" ? "图片" : slot === "videos" ? "视频" : "附件"}示例`);
  };

  const handleRemoveAttachment = (slot: UploadKey, fileName: string) => {
    setAttachments((prev) => ({
      ...prev,
      [slot]: prev[slot].filter((item) => item !== fileName),
    }));
    toast.success("附件已移除");
  };

  const handleSaveDraft = () => {
    toast.success(`草稿已保存，当前已填写 ${8 - getMissingFields().length}/8 个必填项`);
  };

  const handleSubmit = () => {
    toast.success("售后工单已提交，已进入待受理列表");
    navigate("/after-sales");
  };

  return (
    <div className="mx-auto max-w-[860px] px-4 py-8">
      <div className="mb-8">
        <Link
          to="/after-sales"
          className="group mb-4 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4 transition group-hover:-translate-x-1" />
          返回售后工单
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">新建售后工单</h1>
        <p className="mt-2 text-sm text-slate-500">
          录入客户信息、上传现场资料，并生成 AI 摘要后再进入售后主流程。
        </p>
      </div>

      <div className="material-card mb-8 p-6">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          {steps.map((step, index) => (
            <React.Fragment key={step.id}>
              <div className="relative z-10 flex flex-col items-center gap-2">
                <div
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-full transition",
                    currentStep >= step.id
                      ? "bg-primary text-white shadow-[0_12px_24px_rgba(25,118,210,0.24)]"
                      : "bg-slate-100 text-slate-400",
                  )}
                >
                  {currentStep > step.id ? <Check className="h-5 w-5" /> : <step.icon className="h-5 w-5" />}
                </div>
                <span
                  className={cn(
                    "text-xs font-semibold uppercase tracking-[0.18em]",
                    currentStep >= step.id ? "text-slate-800" : "text-slate-400",
                  )}
                >
                  步骤 {step.id}
                </span>
                <span className="text-sm font-medium text-slate-600">{step.name}</span>
              </div>
              {index < steps.length - 1 && (
                <div className="mx-3 -mt-7 h-[2px] flex-1 bg-slate-100">
                  <motion.div
                    animate={{ width: currentStep > step.id ? "100%" : "0%" }}
                    className="h-full bg-primary transition-all duration-500"
                  />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="material-card overflow-hidden">
        <AnimatePresence mode="wait">
          {currentStep === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8 p-8"
            >
              <section className="space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                  <div className="h-6 w-1.5 rounded-full bg-primary" />
                  <h3 className="text-base font-bold text-slate-900">基础信息</h3>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">客户名称</span>
                    <input
                      value={formData.customerName}
                      onChange={(event) => setFormData({ ...formData, customerName: event.target.value })}
                      placeholder="请输入客户单位名称"
                      className="w-full rounded-2xl border border-transparent bg-slate-50 px-4 py-3 text-sm font-medium outline-none transition focus:border-blue-200 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">产品型号</span>
                    <select
                      value={formData.productModel}
                      onChange={(event) => setFormData({ ...formData, productModel: event.target.value })}
                      className="w-full appearance-none rounded-2xl border border-transparent bg-slate-50 px-4 py-3 text-sm font-medium outline-none transition focus:border-blue-200 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    >
                      <option value="">请选择产品型号</option>
                      <option value="OC-3">OC-3</option>
                      <option value="OC-5">OC-5</option>
                      <option value="OC-10">OC-10</option>
                    </select>
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">序列号</span>
                    <input
                      value={formData.serialNumber}
                      onChange={(event) => setFormData({ ...formData, serialNumber: event.target.value })}
                      placeholder="格式：SN12345678"
                      className="w-full rounded-2xl border border-transparent bg-slate-50 px-4 py-3 text-sm font-medium outline-none transition focus:border-blue-200 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">报障日期</span>
                    <div className="relative">
                      <input
                        type="date"
                        value={formData.reportDate}
                        onChange={(event) => setFormData({ ...formData, reportDate: event.target.value })}
                        className="w-full rounded-2xl border border-transparent bg-slate-50 px-4 py-3 pr-10 text-sm font-medium outline-none transition focus:border-blue-200 focus:bg-white focus:ring-4 focus:ring-blue-100"
                      />
                      <Calendar className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    </div>
                  </label>
                </div>
              </section>

              <section className="space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                  <div className="h-6 w-1.5 rounded-full bg-primary" />
                  <h3 className="text-base font-bold text-slate-900">故障描述</h3>
                </div>

                <div className="space-y-5">
                  <div className="space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">问题类型</div>
                    <div className="flex flex-wrap gap-3">
                      {issueOptions.map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => toggleIssueType(type)}
                          className={cn(
                            "rounded-full border px-4 py-2 text-sm font-semibold transition",
                            formData.issueTypes.includes(type)
                              ? "border-blue-200 bg-blue-50 text-primary shadow-sm"
                              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                          )}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">工作模式</div>
                    <div className="flex flex-wrap gap-5">
                      {workModes.map((mode) => (
                        <label key={mode} className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600">
                          <input
                            type="radio"
                            name="workMode"
                            value={mode}
                            checked={formData.workMode === mode}
                            onChange={(event) => setFormData({ ...formData, workMode: event.target.value })}
                            className="h-4 w-4 border-slate-300 text-primary focus:ring-primary"
                          />
                          {mode}
                        </label>
                      ))}
                    </div>
                  </div>

                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">问题现象描述</span>
                    <textarea
                      rows={5}
                      value={formData.description}
                      onChange={(event) => setFormData({ ...formData, description: event.target.value })}
                      placeholder="例如：启动 3 分钟后出现连续报警，流量输出显著下降。"
                      className="w-full rounded-[24px] border border-transparent bg-slate-50 px-4 py-3 text-sm font-medium outline-none transition focus:border-blue-200 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    />
                  </label>

                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">是否已自查</span>
                      <select
                        value={formData.selfChecked}
                        onChange={(event) => setFormData({ ...formData, selfChecked: event.target.value })}
                        className="w-full appearance-none rounded-2xl border border-transparent bg-slate-50 px-4 py-3 text-sm font-medium outline-none transition focus:border-blue-200 focus:bg-white focus:ring-4 focus:ring-blue-100"
                      >
                        <option value="">请选择</option>
                        <option value="已自查">已自查</option>
                        <option value="未自查">未自查</option>
                      </select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">环境说明</span>
                      <input
                        value={formData.environment}
                        onChange={(event) => setFormData({ ...formData, environment: event.target.value })}
                        placeholder="温度、湿度、电源、现场备注"
                        className="w-full rounded-2xl border border-transparent bg-slate-50 px-4 py-3 text-sm font-medium outline-none transition focus:border-blue-200 focus:bg-white focus:ring-4 focus:ring-blue-100"
                      />
                    </label>
                  </div>
                </div>
              </section>

              <section className="space-y-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-1.5 rounded-full bg-primary" />
                    <h3 className="text-base font-bold text-slate-900">现场附件</h3>
                  </div>
                  <span className="material-chip bg-slate-100 text-slate-600">{totalAttachments} Files</span>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {uploadSlots.map((slot) => (
                    <button
                      key={slot.key}
                      type="button"
                      onClick={() => handleUpload(slot.key)}
                      className="rounded-[26px] border border-dashed border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_16px_28px_rgba(25,118,210,0.12)]"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-primary">
                          <slot.icon className="h-5 w-5" />
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                          {slot.badge}
                        </span>
                      </div>
                      <div className="mt-4 text-sm font-semibold text-slate-800">{slot.title}</div>
                      <p className="mt-2 text-sm leading-6 text-slate-500">{slot.hint}</p>
                      <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary">
                        <Plus className="h-4 w-4" />
                        添加示例附件
                      </div>
                    </button>
                  ))}
                </div>

                {totalAttachments > 0 && (
                  <div className="rounded-[24px] border border-slate-100 bg-slate-50/80 p-5">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <ClipboardList className="h-4 w-4" />
                      已上传附件
                    </div>
                    <div className="space-y-2">
                      {uploadSlots.flatMap((slot) =>
                        attachments[slot.key].map((file) => (
                          <div
                            key={`${slot.key}-${file}`}
                            className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-sm"
                          >
                            <div>
                              <div className="font-medium text-slate-800">{file}</div>
                              <div className="text-xs text-slate-500">{slot.title}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveAttachment(slot.key, file)}
                              className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        )),
                      )}
                    </div>
                  </div>
                )}
              </section>
            </motion.div>
          )}

          {currentStep === 2 && (
            <motion.div
              key="step-2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6 p-8"
            >
              <div className="flex items-start gap-4 rounded-[28px] bg-[linear-gradient(135deg,#eef5ff_0%,#ffffff_55%,#eefaf7_100%)] p-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
                  <Wand2 className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-slate-900">AI 技术摘要</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    根据客户信息、问题类型与附件描述，系统会先生成一版售后流转建议，方便客服与技术人员快速判断优先级。
                  </p>
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-100 bg-white p-6 shadow-[0_20px_40px_rgba(15,23,42,0.06)]">
                {aiGenerating ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 text-sm font-semibold text-primary">
                      <Wand2 className="h-4 w-4 animate-pulse" />
                      AI 正在生成摘要，请稍候...
                    </div>
                    <div className="h-3 rounded-full bg-slate-100">
                      <motion.div
                        initial={{ width: "0%" }}
                        animate={{ width: "92%" }}
                        transition={{ duration: 1.4 }}
                        className="h-3 rounded-full bg-gradient-to-r from-blue-500 via-cyan-500 to-emerald-500"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">AI Result</div>
                        <div className="mt-1 text-lg font-semibold text-slate-900">建议分派给售后二线技术组</div>
                      </div>
                      <button
                        type="button"
                        onClick={generateAiSummary}
                        className="material-button-secondary"
                      >
                        <Wand2 className="h-4 w-4" />
                        重新生成
                      </button>
                    </div>

                    <div className="rounded-[24px] bg-slate-50/80 p-5 text-sm leading-7 text-slate-700">{aiSummary}</div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      {[
                        { label: "建议优先级", value: "P2 普通紧急" },
                        { label: "推荐 SLA", value: "24 小时响应" },
                        { label: "资料完整度", value: `${Math.min(100, 68 + totalAttachments * 8)}%` },
                      ].map((item) => (
                        <div key={item.label} className="rounded-[22px] border border-slate-100 bg-white p-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</div>
                          <div className="mt-3 text-lg font-bold text-slate-900">{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {currentStep === 3 && (
            <motion.div
              key="step-3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6 p-8"
            >
              <div className="rounded-[28px] bg-[linear-gradient(135deg,#eaf4ff_0%,#ffffff_52%,#eefaf7_100%)] p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">提交前确认</h3>
                    <p className="mt-1 text-sm text-slate-600">确认工单信息无误后，系统会自动回到售后列表并展示最新状态。</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-[24px] border border-slate-100 bg-white p-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">客户与设备</div>
                  <div className="mt-4 space-y-3 text-sm text-slate-700">
                    <div>客户：{formData.customerName}</div>
                    <div>型号：{formData.productModel}</div>
                    <div>序列号：{formData.serialNumber}</div>
                    <div>报障日期：{formData.reportDate}</div>
                  </div>
                </div>
                <div className="rounded-[24px] border border-slate-100 bg-white p-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">工单摘要</div>
                  <div className="mt-4 space-y-3 text-sm text-slate-700">
                    <div>问题类型：{formData.issueTypes.join("、")}</div>
                    <div>工作模式：{formData.workMode}</div>
                    <div>已自查：{formData.selfChecked}</div>
                    <div>附件数量：{totalAttachments}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-amber-100 bg-amber-50/80 p-5 text-sm leading-7 text-amber-900">
                <div className="mb-2 flex items-center gap-2 font-semibold">
                  <AlertCircle className="h-4 w-4" />
                  提交后动作
                </div>
                工单将自动进入“待受理”状态，并同步生成一条 AI 摘要记录供二线技术组查看。
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[860px] items-center justify-between px-4 py-4">
          <button
            type="button"
            onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
            disabled={currentStep === 1}
            className="material-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronLeft className="h-4 w-4" />
            上一步
          </button>

          <div className="flex items-center gap-3">
            <button type="button" onClick={handleSaveDraft} className="material-button-secondary">
              保存草稿
            </button>

            {currentStep < 3 ? (
              <button type="button" onClick={handleNext} className="material-button-primary">
                下一步
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button type="button" onClick={handleSubmit} className="material-button-primary">
                提交工单
                <CheckCircle2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
