// 场景2 · 采购工作台：状态 Tab + 来源筛选 + 需求列表 + 新建需求 + 打开需求详情抽屉。
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { AlertTriangle, ClipboardList, FileStack, FlaskConical, Plus, Search, ShoppingCart, Upload, Waypoints, X } from "lucide-react";
import { cn } from "../../components/ui/utils";
import { procActions, useProc } from "../store";
import type { ReqStatus } from "../data/types";
import { DemoControls, ImportModal, PageHeader, Pager, SourceTag, StatCard, StatusPill } from "../components/common";
import { RequirementDrawer } from "../components/RequirementDrawer";

const PAGE_SIZE = 8;
const REQ_IMPORT_COLUMNS = ["物料名称", "规格", "数量", "期望到货日期", "来源"];
const SAMPLE_REQ_ROWS = [
  { materialName: "冷凝器铜管", spec: "Φ8×0.5mm", quantity: 1200, expectedDate: "2026-08-10", source: "self" as const },
  { materialName: "控制板连接器", spec: "2.54mm 12P", quantity: 3000, expectedDate: "2026-08-12", source: "self" as const },
];

const TABS: Array<{ key: ReqStatus | "all"; label: string }> = [
  { key: "all", label: "全部" },
  { key: "draft", label: "草稿" },
  { key: "pending_inquiry", label: "待询价" },
  { key: "inquiring", label: "询价中" },
  { key: "pending_sample", label: "待到样" },
  { key: "testing", label: "测试中" },
  { key: "priced", label: "已定价" },
  { key: "pending_contract", label: "待签合同" },
];

const NEXT_ACTION_LABEL: Record<ReqStatus, string> = {
  draft: "提交",
  pending_inquiry: "录报价",
  inquiring: "选定要样",
  pending_sample: "样品已到",
  testing: "测试反馈",
  priced: "进入合同",
  pending_contract: "查看合同",
};

export function WorkbenchPage() {
  const { requirements } = useProc();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<ReqStatus | "all">("all");
  const [source, setSource] = useState<"all" | "rd" | "self">("all");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ materialName: "", spec: "", quantity: "" });

  const openId = params.get("req");
  const setOpenId = (id: string | null) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (id) p.set("req", id);
        else p.delete("req");
        return p;
      },
      { replace: true },
    );
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: requirements.length };
    for (const r of requirements) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [requirements]);

  const filtered = requirements.filter((r) => (tab === "all" || r.status === tab) && (source === "all" || r.source === source));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => {
    setPage(1);
  }, [tab, source]);

  const submitNew = () => {
    if (!form.materialName || !form.spec || !form.quantity) return;
    procActions.createRequirement({ materialName: form.materialName, spec: form.spec, quantity: Number(form.quantity) || 0 });
    setCreating(false);
    setForm({ materialName: "", spec: "", quantity: "" });
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4">
      <DemoControls />
      <PageHeader
        Icon={ShoppingCart}
        badge="Procurement Workbench"
        title="采购工作台"
        description="统一管理采购需求的询价、打样、测试、定价全流程；研发流转需求带紫色标识，可按状态与来源筛选。"
      />
      <div className="mb-3 grid grid-cols-4 gap-3">
        <StatCard label="需求总数" value={requirements.length} hint="全部采购需求" Icon={FileStack} />
        <StatCard label="研发流转" value={requirements.filter((r) => r.source === "rd").length} tone="violet" hint="由研发任务转入" Icon={Waypoints} />
        <StatCard label="询价/打样/测试中" value={requirements.filter((r) => ["inquiring", "pending_sample", "testing"].includes(r.status)).length} tone="indigo" hint="流程进行中" Icon={FlaskConical} />
        <StatCard label="已定价/待签合同" value={requirements.filter((r) => ["priced", "pending_contract"].includes(r.status)).length} tone="emerald" hint="进入合同环节" Icon={ClipboardList} />
      </div>
      <div className="material-card overflow-hidden">
        {/* 顶部：状态 Tab + 搜索 + 新建 */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                  tab === t.key ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                )}
              >
                {t.label}
                <span className={cn("rounded-full px-1.5 text-[10px]", tab === t.key ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-400")}>
                  {counts[t.key] ?? 0}
                </span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-400">
              <Search className="h-4 w-4" />
              <span>搜索需求…</span>
            </div>
            <button type="button" onClick={() => setImporting(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm">
              <Upload className="h-4 w-4" />
              导入需求
            </button>
            <button type="button" onClick={() => setCreating(true)} className="material-button-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm">
              <Plus className="h-4 w-4" />
              新建需求
            </button>
          </div>
        </div>

        {/* 来源筛选 */}
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-2.5 text-xs">
          <span className="text-slate-400">来源</span>
          {(["all", "rd", "self"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={cn("rounded-full border px-2.5 py-1 font-medium transition", source === s ? "border-violet-300 bg-violet-50 text-violet-600" : "border-slate-200 text-slate-500 hover:bg-slate-50")}
            >
              {s === "all" ? "全部" : s === "rd" ? "研发流转" : "采购自建"}
            </button>
          ))}
        </div>

        {/* 列表 */}
        <div className="divide-y divide-slate-100">
          <div className="grid grid-cols-[110px_minmax(0,1fr)_70px_110px_90px_90px_80px_100px_90px] gap-3 bg-slate-50/60 px-5 py-2 text-xs font-medium text-slate-400">
            <span>需求编号</span>
            <span>物料 · 规格</span>
            <span>数量</span>
            <span>期望日期</span>
            <span>来源</span>
            <span>状态</span>
            <span>责任人</span>
            <span>下一步</span>
            <span>更新时间</span>
          </div>
          {filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-400">该状态下暂无需求</div>
          ) : (
            paged.map((r) => (
              <div
                key={r.id}
                onClick={() => setOpenId(r.id)}
                className="grid cursor-pointer grid-cols-[110px_minmax(0,1fr)_70px_110px_90px_90px_80px_100px_90px] items-center gap-3 px-5 py-3 text-sm transition hover:bg-slate-50/70"
              >
                <span className="flex items-center gap-1 font-medium text-slate-700">
                  {r.status === "draft" && <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
                  {r.code.replace("PR-20260703-", "…")}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{r.materialName}</span>
                  <span className="block truncate text-xs text-slate-400">{r.spec}</span>
                </span>
                <span className="tabular-nums text-slate-600">{r.quantity}</span>
                <span className="tabular-nums text-slate-500">{r.expectedDate}</span>
                <span>
                  <SourceTag source={r.source} />
                </span>
                <span>
                  <StatusPill status={r.status} />
                </span>
                <span className="text-slate-600">{r.owner}</span>
                <span onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => setOpenId(r.id)} className="rounded-lg border border-indigo-200 bg-white px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50">
                    {NEXT_ACTION_LABEL[r.status]}
                  </button>
                </span>
                <span className="text-xs text-slate-400">{r.updatedAt}</span>
              </div>
            ))
          )}
        </div>
        {filtered.length > 0 && <Pager page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />}
      </div>

      {openId && <RequirementDrawer reqId={openId} onClose={() => setOpenId(null)} />}

      {importing && (
        <ImportModal
          title="采购需求"
          templateColumns={REQ_IMPORT_COLUMNS}
          onClose={() => setImporting(false)}
          onSample={() => procActions.importRequirements(SAMPLE_REQ_ROWS)}
          onImport={(rows) =>
            procActions.importRequirements(
              rows.map((r) => ({
                materialName: r["物料名称"] ?? "",
                spec: r["规格"] ?? "",
                quantity: Number(r["数量"]) || 0,
                expectedDate: r["期望到货日期"] || undefined,
                source: r["来源"]?.includes("研发") ? "rd" : "self",
              })),
            )
          }
        />
      )}

      {/* 新建需求（3 必填项，非主线） */}
      {creating && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/40 p-6" onClick={() => setCreating(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-base font-bold text-slate-900">新建采购需求</h3>
              <button type="button" onClick={() => setCreating(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 px-6 py-5">
              {[
                { k: "materialName" as const, label: "物料名称", ph: "如 减震垫 DZ-950" },
                { k: "spec" as const, label: "规格", ph: "如 50×20mm 橡胶" },
                { k: "quantity" as const, label: "数量", ph: "如 50" },
              ].map((f) => (
                <label key={f.k} className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {f.label}
                    <span className="ml-0.5 text-rose-500">*</span>
                  </span>
                  <input value={form[f.k]} onChange={(e) => setForm((p) => ({ ...p, [f.k]: e.target.value }))} placeholder={f.ph} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
              <button type="button" onClick={() => setCreating(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                取消
              </button>
              <button type="button" onClick={submitNew} className="material-button-primary px-4 py-2 text-sm">
                创建草稿
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
