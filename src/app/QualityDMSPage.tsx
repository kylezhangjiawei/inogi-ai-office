import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileText,
  FolderOpen,
  History,
  Plus,
  RotateCcw,
  Search,
  Shield,
  ThumbsUp,
  XCircle,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { cn } from "./components/ui/utils";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "./lib/routePaths";

type DocStatus = "草稿" | "审核中" | "已批准" | "已作废";
type ApprovalStep = "起草" | "审核" | "评审" | "批准" | "受控分发";
type ApprovalAction = "pass" | "reject" | "approve" | "deny";

interface VersionRecord {
  version: string;
  editor: string;
  date: string;
  reason: string;
  summary: string;
}

interface QualityDoc {
  id: string;
  code: string;
  name: string;
  version: string;
  status: DocStatus;
  category: string;
  updatedAt: string;
  approver: string;
  currentStep: ApprovalStep;
  history: VersionRecord[];
}

const mockDocs: QualityDoc[] = [
  {
    id: "q1",
    code: "SOP-001",
    name: "文件控制程序",
    version: "V3.2",
    status: "已批准",
    category: "程序文件",
    updatedAt: "2026-04-01",
    approver: "张经理",
    currentStep: "受控分发",
    history: [
      { version: "V3.2", editor: "刘嘉", date: "2026-04-01", reason: "更新审批流程", summary: "增加数字签名要求，调整分发记录格式" },
      { version: "V3.1", editor: "刘嘉", date: "2026-01-15", reason: "年度例行审查", summary: "更新相关法规引用，修订章节编号" },
    ],
  },
  {
    id: "q2",
    code: "SOP-008",
    name: "变更控制程序",
    version: "V2.0",
    status: "审核中",
    category: "程序文件",
    updatedAt: "2026-04-10",
    approver: "王主管",
    currentStep: "审核",
    history: [
      { version: "V2.0", editor: "陈远", date: "2026-04-10", reason: "增加风险评估步骤", summary: "新增变更风险矩阵，更新影响评估表单" },
      { version: "V1.5", editor: "陈远", date: "2025-11-20", reason: "合规整改", summary: "按 MDR 要求补充变更通知条款" },
    ],
  },
  {
    id: "q3",
    code: "JL-014",
    name: "来料检验记录",
    version: "V1.6",
    status: "已批准",
    category: "记录表单",
    updatedAt: "2026-03-22",
    approver: "周质检",
    currentStep: "受控分发",
    history: [
      { version: "V1.6", editor: "周远", date: "2026-03-22", reason: "增加检测项目", summary: "增加生物相容性检测栏位，修订取样数量说明" },
    ],
  },
  {
    id: "q4",
    code: "JL-023",
    name: "不合格品处理记录",
    version: "V2.1",
    status: "草稿",
    category: "记录表单",
    updatedAt: "2026-04-13",
    approver: "（待定）",
    currentStep: "起草",
    history: [],
  },
  {
    id: "q5",
    code: "JL-031",
    name: "设备校准记录",
    version: "V1.0",
    status: "已作废",
    category: "记录表单",
    updatedAt: "2025-12-01",
    approver: "林监察",
    currentStep: "受控分发",
    history: [
      { version: "V1.0", editor: "林娜", date: "2025-06-10", reason: "初版发布", summary: "新建设备校准记录格式" },
    ],
  },
  {
    id: "q6",
    code: "WI-022",
    name: "装配作业指导书",
    version: "V2.1",
    status: "审核中",
    category: "作业指导书",
    updatedAt: "2026-04-08",
    approver: "赵制造",
    currentStep: "评审",
    history: [
      { version: "V2.1", editor: "王工", date: "2026-04-08", reason: "工艺优化", summary: "更新装配顺序，增加防错说明图示" },
      { version: "V2.0", editor: "王工", date: "2026-02-11", reason: "设备更换", summary: "更新新设备操作参数" },
    ],
  },
  {
    id: "q7",
    code: "WI-035",
    name: "灭菌操作指导书",
    version: "V1.3",
    status: "已批准",
    category: "作业指导书",
    updatedAt: "2026-03-05",
    approver: "孙验证",
    currentStep: "受控分发",
    history: [
      { version: "V1.3", editor: "林娜", date: "2026-03-05", reason: "更新灭菌参数", summary: "根据验证报告 V-2026-02 更新温度曲线" },
    ],
  },
  {
    id: "q8",
    code: "IFU-001",
    name: "产品使用说明书（中文版）",
    version: "V4.0",
    status: "已批准",
    category: "说明书",
    updatedAt: "2026-04-02",
    approver: "何 RA",
    currentStep: "受控分发",
    history: [
      { version: "V4.0", editor: "何丽", date: "2026-04-02", reason: "年度更新与法规符合性", summary: "更新警示语，增加 QR 码，符合 GB 9706 要求" },
      { version: "V3.8", editor: "何丽", date: "2025-09-18", reason: "勘误", summary: "修正第 3 章操作步骤顺序错误" },
    ],
  },
  {
    id: "q9",
    code: "IFU-002",
    name: "产品使用说明书（英文版）",
    version: "V3.9",
    status: "草稿",
    category: "说明书",
    updatedAt: "2026-04-14",
    approver: "（待定）",
    currentStep: "起草",
    history: [],
  },
];

const categories = ["程序文件", "记录表单", "作业指导书", "说明书"];

const statusConfig: Record<DocStatus, { label: string; cls: string }> = {
  草稿: { label: "草稿", cls: "border-slate-200 bg-slate-100 text-slate-600" },
  审核中: { label: "审核中", cls: "border-amber-100 bg-amber-50 text-amber-700" },
  已批准: { label: "已批准", cls: "border-emerald-100 bg-emerald-50 text-emerald-700" },
  已作废: { label: "已作废", cls: "border-red-100 bg-red-50 text-red-600" },
};

const approvalSteps: ApprovalStep[] = ["起草", "审核", "评审", "批准", "受控分发"];
const stepIndex = (step: ApprovalStep) => approvalSteps.indexOf(step);

const actionLabels: Record<ApprovalAction, string> = {
  pass: "审核通过",
  reject: "打回修改",
  approve: "批准文件",
  deny: "驳回文件",
};

export function QualityDMSPage() {
  const [docs, setDocs] = useState<QualityDoc[]>(mockDocs);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("q2");
  const [activeTab, setActiveTab] = useState<"approval" | "history">("approval");
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingAction, setPendingAction] = useState<ApprovalAction | null>(null);

  const filteredDocs = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    return docs.filter((doc) => {
      const matchesCategory = !selectedCategory || doc.category === selectedCategory;
      const matchesKeyword =
        !keyword ||
        [doc.code, doc.name, doc.version, doc.status, doc.category, doc.approver].some((value) =>
          value.toLowerCase().includes(keyword),
        );
      return matchesCategory && matchesKeyword;
    });
  }, [docs, searchQuery, selectedCategory]);

  const selected = docs.find((doc) => doc.id === selectedId) ?? docs[0];
  const reviewCount = docs.filter((doc) => doc.status === "审核中").length;
  const approvedCount = docs.filter((doc) => doc.status === "已批准").length;
  const draftCount = docs.filter((doc) => doc.status === "草稿").length;

  function handleAction(action: ApprovalAction) {
    toast.success(`操作：${actionLabels[action]}（模拟电子签名已记录）`);
    if (action === "pass") {
      setDocs((current) =>
        current.map((doc) =>
          doc.id === selectedId
            ? { ...doc, currentStep: approvalSteps[stepIndex(doc.currentStep) + 1] ?? doc.currentStep }
            : doc,
        ),
      );
    }
  }

  function confirmAction() {
    if (pendingAction) handleAction(pendingAction);
    setPendingAction(null);
  }

  const categoryCount = (category: string) => docs.filter((doc) => doc.category === category).length;
  const negativeAction = pendingAction === "reject" || pendingAction === "deny";

  return (
    <div className="horizon-theme hz-page min-w-0 space-y-3 px-3 py-3 sm:px-4 lg:px-5">
      <HorizonPageHeader
        Icon={Shield}
        eyebrow="质量体系 / DOCUMENT CONTROL"
        title="质量文件管理系统"
        description="集中维护受控文件、版本历史与审批状态，形成可审计的文件全生命周期工作区。"
        meta={
          <>
            <span>文件库更新至 2026-04-14</span>
            <span aria-hidden="true">·</span>
            <span>共 {categories.length} 个文件类别</span>
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={routePath("page:qa-traceability", "/qa-traceability")}>
                全链路追溯
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
            <Button className="hz-primary-action" onClick={() => toast.info("新建文件（模拟）")}>
              <Plus aria-hidden="true" />
              新建文件
            </Button>
          </>
        }
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={FileText} label="受控文件" value={docs.length} note="含草稿与历史作废版本" tone="brand" />
        <HorizonMetric Icon={Clock3} label="审核中" value={reviewCount} note="等待审核或评审" tone="warning" />
        <HorizonMetric Icon={CheckCircle2} label="已批准" value={approvedCount} note="可受控分发" tone="success" />
        <HorizonMetric Icon={ClipboardList} label="草稿" value={draftCount} note="尚未进入审批流程" tone="neutral" />
      </HorizonMetricGrid>

      <div className="grid min-w-0 gap-3 xl:grid-cols-[13.5rem_minmax(0,1fr)] 2xl:grid-cols-[13.5rem_minmax(0,1fr)_20rem]">
        <aside className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader Icon={FolderOpen} title="文件类别" description="按体系类型筛选文件库。" />
          <nav className="space-y-1 p-2" aria-label="质量文件类别">
            <CategoryButton
              label="全部文件"
              count={docs.length}
              active={!selectedCategory}
              Icon={FolderOpen}
              onClick={() => setSelectedCategory(null)}
            />
            {categories.map((category) => (
              <CategoryButton
                key={category}
                label={category}
                count={categoryCount(category)}
                active={selectedCategory === category}
                Icon={ChevronRight}
                onClick={() => setSelectedCategory(category === selectedCategory ? null : category)}
              />
            ))}
          </nav>
          <div className="mx-3 mb-3 rounded-xl border border-blue-100 bg-[#f7f9ff] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#002fa7]">
              <Shield className="size-3.5" aria-hidden="true" />
              受控提醒
            </div>
            <p className="mt-1.5 text-pretty text-xs leading-5 text-slate-500">审批完成后按受控分发范围使用最新有效版本。</p>
          </div>
        </aside>

        <section className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader
            Icon={FileText}
            title={selectedCategory ?? "全部文件"}
            description="选择文件后查看审批步骤与版本变更证据。"
            trailing={<span className="text-xs tabular-nums text-slate-500">{filteredDocs.length} 项</span>}
          />
          <div className="hz-toolbar border-b p-3">
            <Label htmlFor="dms-search" className="sr-only">搜索质量文件</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                id="dms-search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="bg-white pl-9"
                placeholder="搜索编号、名称、版本或审批人"
              />
            </div>
          </div>
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <caption className="sr-only">质量文件库及当前版本状态</caption>
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">文件编号</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">文件名称</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">版本</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">状态</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">修改日期</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">审批人</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDocs.length ? (
                  filteredDocs.map((doc) => {
                    const selectedRow = selectedId === doc.id;
                    const isVoid = doc.status === "已作废";
                    return (
                      <tr key={doc.id} className={cn(selectedRow && "bg-[#f7f9ff]", isVoid && "text-slate-400")}>
                        <td className="px-3 py-2.5 font-mono text-xs tabular-nums">{doc.code}</td>
                        <td className="px-3 py-2">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-auto max-w-64 justify-start rounded-lg px-2 py-1.5 text-left"
                            onClick={() => setSelectedId(doc.id)}
                            aria-current={selectedRow ? "true" : undefined}
                          >
                            <FileText className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                            <span className={cn("truncate font-semibold text-slate-800", isVoid && "line-through text-slate-400")}>{doc.name}</span>
                          </Button>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-slate-600">{doc.version}</td>
                        <td className="px-3 py-2.5">
                          <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold", statusConfig[doc.status].cls)}>
                            {statusConfig[doc.status].label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs tabular-nums text-slate-500">{doc.updatedAt}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">{doc.approver}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6}>
                      <HorizonEmptyState
                        Icon={Search}
                        title="未找到匹配文件"
                        description="调整搜索词或清除当前类别筛选。"
                        action={<Button type="button" variant="outline" size="sm" onClick={() => { setSearchQuery(""); setSelectedCategory(null); }}>清除筛选</Button>}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="hz-surface min-w-0 overflow-hidden xl:col-start-2 2xl:col-start-auto">
          {selected ? (
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "approval" | "history")} className="gap-0">
              <div className="border-b border-slate-100 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs tabular-nums text-slate-500">{selected.code}</span>
                  <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold", statusConfig[selected.status].cls)}>
                    {selected.status}
                  </span>
                </div>
                <h2 className="mt-2 text-balance text-base font-semibold text-slate-900">{selected.name}</h2>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span className="font-mono tabular-nums">{selected.version}</span>
                  <span>审批人：{selected.approver}</span>
                </div>
              </div>

              <TabsList className="mx-3 mt-3 grid w-auto grid-cols-2 bg-slate-100">
                <TabsTrigger value="approval">审批流程</TabsTrigger>
                <TabsTrigger value="history">版本历史</TabsTrigger>
              </TabsList>

              <TabsContent value="approval" className="p-4">
                <ol aria-label="文件审批流程" className="space-y-0">
                  {approvalSteps.map((step, index) => {
                    const current = stepIndex(selected.currentStep);
                    const done = index < current;
                    const active = index === current;
                    return (
                      <li key={step} className="relative flex min-h-12 gap-3">
                        {index < approvalSteps.length - 1 ? (
                          <span className={cn("absolute left-[13px] top-7 h-[calc(100%-4px)] w-px", done ? "bg-emerald-300" : "bg-slate-200")} aria-hidden="true" />
                        ) : null}
                        <span
                          className={cn(
                            "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                            done && "border-emerald-500 bg-emerald-500 text-white",
                            active && "border-[#002fa7] bg-[#002fa7] text-white",
                            !done && !active && "border-slate-200 bg-white text-slate-400",
                          )}
                          aria-current={active ? "step" : undefined}
                        >
                          {done ? <CheckCircle2 className="size-4" aria-hidden="true" /> : index + 1}
                        </span>
                        <div className="min-w-0 pb-3 pt-1">
                          <div className={cn("text-sm font-semibold", active ? "text-[#002fa7]" : done ? "text-emerald-700" : "text-slate-500")}>{step}</div>
                          {active ? <div className="mt-0.5 text-xs text-slate-500">当前节点 · {selected.approver}</div> : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>

                <ApprovalActions selected={selected} onRequest={setPendingAction} />

                <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <Shield className="mt-0.5 size-4 shrink-0 text-[#002fa7]" aria-hidden="true" />
                  <p className="text-pretty text-xs leading-5 text-slate-500">当前为模拟审批操作；正式电子签名效力与审计要求以已配置的受控系统为准。</p>
                </div>
              </TabsContent>

              <TabsContent value="history" className="p-4">
                {selected.history.length ? (
                  <ol className="space-y-3" aria-label="文件版本历史">
                    {selected.history.map((record) => (
                      <li key={`${record.version}-${record.date}`} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-sm font-semibold tabular-nums text-[#002fa7]">{record.version}</span>
                          <time className="text-xs tabular-nums text-slate-500">{record.date}</time>
                        </div>
                        <dl className="mt-3 grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-xs">
                          <dt className="text-slate-400">修改人</dt>
                          <dd className="text-slate-700">{record.editor}</dd>
                          <dt className="text-slate-400">修改原因</dt>
                          <dd className="text-slate-700">{record.reason}</dd>
                        </dl>
                        <p className="mt-3 text-pretty text-xs leading-5 text-slate-500">{record.summary}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <HorizonEmptyState
                    Icon={History}
                    title="暂无版本历史"
                    description="当前草稿还没有已发布的历史版本。"
                    action={<Button type="button" variant="outline" size="sm" onClick={() => toast.info("创建修订（模拟）")}>创建修订</Button>}
                  />
                )}
              </TabsContent>
            </Tabs>
          ) : (
            <HorizonEmptyState Icon={FileText} title="选择文件查看详情" description="从文件库选择一项以查看审批状态和版本历史。" />
          )}
        </aside>
      </div>

      <AlertDialog open={Boolean(pendingAction)} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent className="horizon-portal">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance">确认{pendingAction ? actionLabels[pendingAction] : "审批操作"}？</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              {negativeAction
                ? `该操作会中止当前文件的审批流转，请确认已核对 ${selected?.code ?? "当前文件"} 的问题与修改要求。`
                : `该操作会推进 ${selected?.code ?? "当前文件"} 的审批流程，并记录当前模拟审批信息。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className={cn(negativeAction ? "bg-red-600 text-white hover:bg-red-700" : "bg-[#002fa7] text-white hover:bg-[#002581]")} onClick={confirmAction}>
              确认{pendingAction ? actionLabels[pendingAction] : "操作"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CategoryButton({
  label,
  count,
  active,
  Icon,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "h-9 w-full justify-between rounded-lg px-3",
        active ? "bg-[#eef3ff] text-[#002fa7] hover:bg-[#eef3ff]" : "text-slate-600 hover:bg-slate-50",
      )}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
      <span className="rounded-full bg-white px-1.5 py-0.5 text-xs tabular-nums text-slate-500">{count}</span>
    </Button>
  );
}

function ApprovalActions({ selected, onRequest }: { selected: QualityDoc; onRequest: (action: ApprovalAction) => void }) {
  if (selected.status !== "审核中") {
    return (
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center text-xs text-slate-500">
        {selected.status === "已批准"
          ? "文件已批准，审批流程完成。"
          : selected.status === "草稿"
            ? "草稿提交审核后将进入审批流程。"
            : "文件已作废，不再参与审批流转。"}
      </div>
    );
  }

  if (selected.currentStep === "审核" || selected.currentStep === "评审") {
    return (
      <div className="mt-3 space-y-2">
        <div className="text-xs font-semibold text-slate-500">{selected.currentStep}人操作</div>
        <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
          <Button type="button" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => onRequest("pass")}>
            <ThumbsUp aria-hidden="true" />
            通过
          </Button>
          <Button type="button" variant="outline" className="border-amber-200 text-amber-700 hover:bg-amber-50" onClick={() => onRequest("reject")}>
            <RotateCcw aria-hidden="true" />
            打回修改
          </Button>
        </div>
      </div>
    );
  }

  if (selected.currentStep === "批准") {
    return (
      <div className="mt-3 space-y-2">
        <div className="text-xs font-semibold text-slate-500">批准人操作</div>
        <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
          <Button type="button" className="bg-[#002fa7] text-white hover:bg-[#002581]" onClick={() => onRequest("approve")}>
            <CheckCircle2 aria-hidden="true" />
            批准
          </Button>
          <Button type="button" variant="outline" className="border-red-200 text-red-600 hover:bg-red-50" onClick={() => onRequest("deny")}>
            <XCircle aria-hidden="true" />
            驳回
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 p-3 text-amber-800">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="text-pretty text-xs leading-5">当前节点无需人工审批操作。</p>
    </div>
  );
}
