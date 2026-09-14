import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { useAuth } from "../../auth";
import { Button } from "../../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useI18n } from "../../lib/i18n";
import { routePath } from "../../lib/routePaths";
import { buildStockPlanReturnPath } from "../../lib/stockPlanNavigation";
import { listProcStockPlans, type ProcurementTask, type ProcStockPlan } from "../../lib/procurementApi";
import { PROCUREMENT_REFRESH_EVENT } from "../data";
import { buildWorkspaceAggregation, partitionWorkspaceAggregation, type WorkspaceBusiness, type WorkspaceSourceRow } from "../procurementAggregationModel";
import { useProcCan } from "./common";

const businesses: Array<[WorkspaceBusiness, string, string]> = [["purchase", "普通采购", "任务"], ["sample", "样品采购", "任务"], ["stock", "相关备货", "计划"], ["arrival", "待到货", "订单行"]];
const EMPTY_PLANS: ProcStockPlan[] = [];
interface PlanSnapshot { scope: string; plans: ProcStockPlan[]; loadedAt: string | null; loading: boolean; error: string | null }
export interface WorkspacePlanOptions { userKey: string; products: string[]; suppliers: string[] }

export function ProcWorkspaceAggregation({ tasks, month, productId, supplier, loading, error, disabled, onSelectTask, onNavigate, onPlanOptions, selectedBusiness, onBusinessChange }: {
  tasks: ProcurementTask[]; month: string; productId: string; supplier: string; loading: boolean; error: string | null;
  disabled: boolean; onSelectTask: (id: string) => void; onNavigate: (path: string) => void;
  onPlanOptions?: (options: WorkspacePlanOptions) => void;
  selectedBusiness?: WorkspaceBusiness; onBusinessChange?: (business: WorkspaceBusiness) => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const can = useProcCan();
  const canReadPlans = can("page:proc-cockpit");
  const scope = JSON.stringify([user?.id, user?.name, user?.roleId, user?.departmentCode, [...(user?.permissions ?? [])].sort(), canReadPlans]);
  const [localBusiness, setLocalBusiness] = useState<WorkspaceBusiness>("purchase");
  const business = selectedBusiness ?? localBusiness;
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<PlanSnapshot>({ scope: "", plans: [], loadedAt: null, loading: false, error: null });
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener(PROCUREMENT_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(PROCUREMENT_REFRESH_EVENT, refresh);
  }, []);
  useEffect(() => {
    if (!user?.id || !canReadPlans) return;
    const controller = new AbortController();
    setSnapshot((previous) => ({ scope, plans: previous.scope === scope ? previous.plans : [], loadedAt: previous.scope === scope ? previous.loadedAt : null, loading: true, error: null }));
    void listProcStockPlans(controller.signal).then((plans) => {
      if (!controller.signal.aborted) setSnapshot({ scope, plans, loadedAt: new Date().toLocaleString(), loading: false, error: null });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setSnapshot((previous) => ({ ...previous, scope, loading: false, error: reason instanceof Error ? reason.message : "备货计划读取失败" }));
    });
    return () => controller.abort();
  }, [scope, revision, canReadPlans, user?.id]);
  const source = snapshot.scope === scope ? snapshot : { scope, plans: EMPTY_PLANS, loadedAt: null, loading: canReadPlans, error: null };
  const userKey = JSON.stringify(user);
  useEffect(() => {
    if (!onPlanOptions) return;
    const relevant = new Set(buildWorkspaceAggregation({ tasks, plans: canReadPlans ? source.plans : [], userId: user?.id, month, productId: "all", supplier: "all" }).filter((row) => row.planId).map((row) => row.planId));
    const plans = source.plans.filter((plan) => relevant.has(plan.id));
    onPlanOptions({ userKey, products: [...new Set(plans.flatMap((plan) => plan.productId ? [plan.productId] : []))], suppliers: [...new Set(plans.flatMap((plan) => plan.batches.map((batch) => batch.supplierName.trim()).filter(Boolean)))] });
  }, [source.plans, tasks, canReadPlans, user?.id, userKey, month, onPlanOptions]);
  const rows = useMemo(() => buildWorkspaceAggregation({ tasks, plans: canReadPlans ? source.plans : [], userId: user?.id, month, productId, supplier }), [tasks, source.plans, canReadPlans, user?.id, month, productId, supplier]);
  const groups = useMemo(() => partitionWorkspaceAggregation(rows, business), [rows, business]);
  const stockSelected = business === "stock";
  const unavailable = stockSelected ? !canReadPlans || (!source.loadedAt && (source.loading || Boolean(source.error))) : (loading || Boolean(error)) && !tasks.length;
  const stale = stockSelected ? Boolean(source.error || error) : Boolean(error);
  const incompletePlans = Boolean(error) || (loading && !tasks.length);
  const busy = disabled || loading || Boolean(error) || (stockSelected && (!canReadPlans || source.loading || Boolean(source.error)));
  const latestView = useRef({ scope, rows, busy });
  latestView.current = { scope, rows, busy };
  const unit = businesses.find(([key]) => key === business)![2];
  const openRow = (row: WorkspaceSourceRow) => {
    if (busy || latestView.current.busy || latestView.current.scope !== scope || latestView.current.rows !== rows || !rows.some((current) => current.key === row.key)) return;
    if (row.planId) {
      const path = buildStockPlanReturnPath({ planType: "all", month: "", keyword: "", status: "all", expanded: [row.planId], focusId: row.planId });
      if (path && canReadPlans) onNavigate(path);
    } else if (row.taskId) onSelectTask(row.taskId);
  };
  return <section aria-label={t("采购业务汇总")} className="rounded-xl border border-border bg-card p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-sm font-semibold">{t("本月业务来源")}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("按本人、产品和供应商汇总，状态与搜索不隐藏跨月待办。样品属于原采购任务；计划、订单行分开计数。")}</p></div><span className="text-xs tabular-nums text-muted-foreground">{month}</span></div>
    <Tabs value={business} onValueChange={(value) => { if (!businesses.some(([key]) => key === value)) return; if (onBusinessChange) onBusinessChange(value as WorkspaceBusiness); else setLocalBusiness(value as WorkspaceBusiness); }} className="mt-3">
      <TabsList className="proc-s01-business-tabs" aria-label={t("选择采购业务来源")}>{businesses.map(([key, label, measure]) => {
        const unknown = key === "stock" ? !canReadPlans || incompletePlans || (!source.loadedAt && (source.loading || Boolean(source.error))) : (loading || Boolean(error)) && !tasks.length;
        return <TabsTrigger key={key} value={key} disabled={disabled} className="min-h-11 gap-1.5 text-xs">{t(label)}<span className="tabular-nums">{unknown ? "—" : rows.filter((row) => row.business === key && row.period === "month").length}</span><span className="font-normal text-muted-foreground">{t(measure)}</span></TabsTrigger>;
      })}</TabsList>
    </Tabs>
    {stockSelected && <div className="mt-3 flex flex-wrap items-start justify-between gap-2 text-xs leading-5 text-muted-foreground"><p className="min-w-0 flex-1">{t(!canReadPlans ? "备货计划需要采购驾驶舱查看权限，当前未读取。" : "仅列关联本人采购任务或本人创建的计划；计划未提供采购经办字段，创建人不代表经办人。")}{canReadPlans && source.loadedAt && <span className="block tabular-nums">{t("上次成功读取")}：{source.loadedAt}</span>}</p>{canReadPlans && <Button type="button" variant="outline" size="sm" disabled={disabled || source.loading} onClick={() => setRevision((value) => value + 1)} className="min-h-9 gap-1"><RefreshCw className="size-3.5" aria-hidden="true" />{t(source.loading ? "读取中" : "重读备货")}</Button>}</div>}
    {stockSelected && source.error && canReadPlans && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-xs leading-5 text-rose-700">{t("备货读取失败")}：{source.error}{source.loadedAt ? t("。保留上次成功结果，重新读取成功后再打开来源。") : t("。尚无可用结果，不能判断为零。")}</p>}
    {stockSelected && canReadPlans && incompletePlans && <p role="status" className="mt-3 text-xs leading-5 text-amber-800">{t("采购任务来源尚未完整读取，相关备货范围待补全。当前只展示可确认的记录，数量不代表完整范围。")}</p>}
    {!stockSelected && error && <p role="status" className="mt-3 text-xs text-rose-700">{t(tasks.length ? "采购来源更新失败，当前显示上次读取结果。" : "采购来源读取失败，尚不能判断待办数量。")}</p>}
    {business === "arrival" && <p className="mt-3 text-xs leading-5 text-muted-foreground">{t("按订单预计到货日归月。未收量不是未验收量或可用库存；同一 ERP 订单行去重，数量冲突保留待核对。")}</p>}
    {business === "sample" && <p className="mt-3 text-xs leading-5 text-muted-foreground">{t("包含有样品要求或样品记录的未完采购任务，已验证样品不等于当前仍待测试。")}</p>}
    {!unavailable ? <div className="mt-3 space-y-3" aria-busy={stockSelected ? source.loading : loading}>
      <SourceGroup key={`${business}:month`} title="所选月待办" rows={groups.month} unit={unit} disabled={busy} onOpen={openRow} stale={stale} incomplete={stockSelected && incompletePlans} collapsible />
      <div className="proc-s01-exception-groups">
        <SourceGroup key={`${business}:carryover`} title="跨月未完成" rows={groups.carryover} unit={unit} disabled={busy} onOpen={openRow} stale={stale} incomplete={stockSelected && incompletePlans} />
        <SourceGroup key={`${business}:undated`} title="日期待确认" rows={groups.undated} unit={unit} disabled={busy} onOpen={openRow} stale={stale} incomplete={stockSelected && incompletePlans} />
      </div>
      {groups.future.length > 0 && <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs text-muted-foreground">{t("未来月份")} · {groups.future.length} {t(unit)}</summary><div className="mt-3"><SourceGroup key={`${business}:future`} title="未来待办" rows={groups.future} unit={unit} disabled={busy} onOpen={openRow} stale={stale} /></div></details>}
    </div> : (stockSelected ? canReadPlans && source.loading : loading) && <p role="status" className="mt-3 text-xs text-muted-foreground">{t("正在读取业务来源…")}</p>}
    {business === "sample" && can("page:proc-cockpit") && <Button type="button" variant="link" disabled={busy} onClick={() => onNavigate(`${routePath("page:proc-cockpit", "/proc-cockpit")}?tab=samples`)} className="mt-2 h-auto min-h-9 px-0 text-xs">{t("打开样品协同")}<ArrowUpRight className="ml-1 size-3.5" aria-hidden="true" /></Button>}
  </section>;
}

function SourceGroup({ title, rows, unit, disabled, onOpen, stale, incomplete = false, collapsible = false }: { title: string; rows: WorkspaceSourceRow[]; unit: string; disabled: boolean; onOpen: (row: WorkspaceSourceRow) => void; stale: boolean; incomplete?: boolean; collapsible?: boolean }) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(collapsible ? 4 : 2);
  const count = <span className="text-xs tabular-nums text-muted-foreground">{incomplete ? `${t("已知")} ` : ""}{rows.length} {t(unit)}{stale ? ` · ${t("上次结果")}` : ""}</span>;
  const content = <>
    {!rows.length ? <p className="mt-2 text-xs text-muted-foreground">{t(incomplete ? "当前已知结果未包含记录，范围尚未完整。" : stale ? "上次读取结果暂无记录。" : "当前范围暂无记录")}</p> : <ul className="mt-2 divide-y divide-border">{rows.slice(0, limit).map((row) => <li key={row.key} className="proc-s01-source-row py-2.5">
      <div className="min-w-0"><p className="break-words text-sm font-medium">{row.title}</p><p className="mt-1 break-all text-xs text-muted-foreground">{row.code}</p><p className="mt-1 break-words text-xs text-muted-foreground">{t(row.detail)}</p></div>
      <div className="min-w-0 text-xs leading-5 text-muted-foreground"><p>{t(row.dateLabel)} · <span className="tabular-nums">{row.period === "undated" ? t("待确认") : row.date.slice(0, 10)}</span></p><p className="break-words">{t(row.relation)}</p></div>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onOpen(row)} className="min-h-9 shrink-0 text-xs" aria-label={t("查看来源：{code}", { code: row.code })}>{t(row.planId ? "打开计划" : row.arrival ? "查看关联任务" : "查看任务")}</Button>
    </li>)}</ul>}
    {limit < rows.length && <Button type="button" variant="ghost" size="sm" onClick={() => setLimit((value) => value + 10)} className="mt-1 min-h-9 text-xs">{t("显示更多")} · {rows.length - limit}</Button>}
  </>;
  if (collapsible) return <details className="rounded-lg border border-border px-3"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold"><span>{t(title)} · {t("来源明细")}</span><span className="float-right pl-3">{count}</span></summary>{content}</details>;
  return <div className="min-w-0 rounded-lg border border-border px-3 py-2.5"><div className="flex items-center justify-between gap-3"><h3 className="text-xs font-semibold">{t(title)}</h3>{count}</div>{content}</div>;
}
