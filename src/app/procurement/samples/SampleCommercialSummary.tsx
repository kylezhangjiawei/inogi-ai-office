import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { useAuth } from "../../auth";
import { Button } from "../../components/ui/button";
import { useAnyPermission } from "../../hooks/usePermission";
import { i18nLocale, useI18n } from "../../lib/i18n";
import { listQuotations, type ProcurementTask } from "../../lib/procurementApi";
import { commercialPrice, sampleCommercialFacts, type SampleCommercialFacts } from "./sampleCommercialModel";
import "./sampleCommercial.css";

export interface SampleCommercialSummaryProps {
  task: ProcurementTask;
  /** Prevent operations/new reads while keeping a same-scope successful snapshot visible. */
  disabled?: boolean;
  /** Parent task source is loading/failed: hide old facts and invalidate pending reads. */
  unavailable?: boolean;
  revision?: string | number;
  onOpenTask: () => void;
}
interface QuoteSnapshot { scope: number; facts: SampleCommercialFacts; readAt: string }

export function SampleCommercialSummary({ task, disabled = false, unavailable = false, revision, onOpenTask }: SampleCommercialSummaryProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const permitted = useAnyPermission("page:proc-cockpit", "page:proc-my-workspace", "page:proc-materials");
  const scopeKey = JSON.stringify([user?.id, user?.name, user?.roleId, user?.departmentCode, [...(user?.permissions ?? [])].sort(),
    task.id, task.materialId, task.updatedAt, task.selectedQuotationId, task.status, task.quantity, unavailable, permitted, revision]);
  const scope = useRef({ key: scopeKey, generation: 0 });
  if (scope.current.key !== scopeKey) scope.current = { key: scopeKey, generation: scope.current.generation + 1 };
  const generation = scope.current.generation;
  const operations = useRef({ generation, disabled, unavailable, permitted });
  operations.current = { generation, disabled, unavailable, permitted };
  const request = useRef(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<QuoteSnapshot | null>(null);
  const [failure, setFailure] = useState<{ scope: number; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const hasTaskIdentity = Boolean(user?.id && task.id?.trim());
  const canRead = hasTaskIdentity && permitted && !unavailable;
  const current = canRead && snapshot?.scope === generation ? snapshot : null;
  const error = canRead && failure?.scope === generation ? failure.message : null;

  useEffect(() => {
    const token = ++request.current;
    if (!canRead || disabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isCurrent = () => alive && request.current === token && scope.current.generation === generation;
    setLoading(true); setSnapshot(null); setFailure(null);
    void Promise.race([
      listQuotations({ taskId: task.id }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(t("采购条件读取超时，请重试。"))), 30_000); }),
    ]).then((rows) => {
      if (!isCurrent()) return;
      const facts = sampleCommercialFacts(task, rows);
      setSnapshot({ scope: generation, facts, readAt: new Date().toISOString() });
    }).catch((cause: unknown) => {
      if (isCurrent()) setFailure({ scope: generation, message: cause instanceof Error ? cause.message : t("采购条件读取失败，请重试。") });
    }).finally(() => {
      if (timer) clearTimeout(timer);
      if (isCurrent()) setLoading(false);
    });
    return () => { alive = false; request.current += 1; if (timer) clearTimeout(timer); };
  }, [canRead, disabled, generation, refreshVersion, task.id, t]);

  const busy = canRead && !disabled && (loading || (!current && !error));
  const refresh = () => {
    const latest = operations.current;
    if (latest.generation !== generation || latest.disabled || latest.unavailable || !latest.permitted || !canRead) return;
    setRefreshVersion((value) => value + 1);
  };
  const openTask = () => {
    const latest = operations.current;
    if (latest.generation !== generation || latest.disabled || latest.unavailable || !latest.permitted || !hasTaskIdentity) return;
    onOpenTask();
  };
  const unknown = unavailable ? "样品来源正在更新或暂不可用，采购条件待重新读取。" : !permitted ? "暂无采购报价查看权限，未读取价格条件。"
    : !hasTaskIdentity ? "账号或任务标识缺失，暂不能读取采购条件。" : disabled && !current ? "当前操作期间暂停读取采购条件。" : null;

  return <section className="sample-commercial-summary" aria-label={t("已确认采购条件")} aria-busy={busy}>
    <header className="sample-commercial-heading"><div><h3>{t("已确认采购条件")}</h3><p>{t("来自原采购任务的已选报价快照，不代表本轮样品的成交或收货结果。")}</p></div>
      <Button type="button" variant="outline" size="sm" disabled={!canRead || disabled || busy} onClick={refresh} className="min-h-10 gap-1.5 text-xs"><RefreshCw className="size-3.5" aria-hidden="true" />{t("重读采购条件")}</Button>
    </header>
    {unknown ? <p role="status" className="sample-commercial-notice">{t(unknown)}</p> : error ? <div role="alert" className="sample-commercial-error"><p>{error}</p><p>{t("读取失败，尚不能判断是否已有报价。重新读取成功后再核对。")}</p><Button type="button" variant="outline" disabled={disabled || busy} onClick={refresh} className="mt-2 min-h-10 text-xs">{t("重试采购条件")}</Button></div>
      : busy ? <p role="status" className="sample-commercial-notice">{t("正在读取已确认报价…")}</p>
        : current && current.facts.kind !== "ready" ? <p role="status" className="sample-commercial-notice">{t(current.facts.message)}</p>
          : current?.facts.kind === "ready" ? <>
            {current.facts.quotes.length > 1 && <p className="sample-commercial-notice">{t("当前有 {count} 条已选采购明细，以下逐条展示，不合并供应商、价格或币种。", { count: current.facts.quotes.length })}</p>}
            <ul className="sample-commercial-quotes">{current.facts.quotes.map((quote) => <li key={quote.id}>
              <div className="sample-commercial-quote-heading"><h4>{quote.supplierName || t("供应商待核对")}</h4><span>{commercialPrice(quote) || t("单价或币种待核对")}<small>{t("报价单价")}</small></span></div>
              <p className="sample-commercial-material">{t("报价物料")}：{quote.materialName || t("名称未记录")}{quote.materialId && <span>{t("物料标识")}：{quote.materialId}</span>}</p>
              {quote.materialCheck !== "matched" && <p className="sample-commercial-material-warning">{t(quote.materialCheck === "conflict" ? "报价物料标识与当前任务物料冲突，请核对原采购任务后确认适用条件。" : "此报价按原任务关联，尚未核对为同一物料；不按名称匹配或合并条件。")}</p>}
              <dl><div><dt>{t("报价交期")}</dt><dd>{quote.leadTimeDays === null ? t("待补充 / 核对") : t("{count} 天", { count: quote.leadTimeDays })}</dd></div><div><dt>{t("起订量")}</dt><dd>{quote.minOrderQty === null ? t("待补充 / 核对") : quote.minOrderQty.toLocaleString()}</dd></div><div><dt>{t("报价日期")}</dt><dd>{quote.quoteDate || t("待补充 / 核对")}</dd></div><div><dt>{t("报价有效期至")}</dt><dd>{quote.validUntil || t("待补充 / 核对")}</dd></div></dl>
              {quote.note && <details className="sample-commercial-note"><summary>{t("查看原报价说明")}</summary><p>{quote.note}</p></details>}
            </li>)}</ul>
            <p className="sample-commercial-boundary">{t("交期天数未注明起算日，不推算承诺到货。单位、税费、付款及运输条件请核对原报价说明，未明确部分待补充确认。")}</p>
          </> : null}
    {current && !unknown && <p className="sample-commercial-read-at">{t("本次读取")} · {new Date(current.readAt).toLocaleString(i18nLocale())}</p>}
    <footer><Button type="button" variant="link" disabled={disabled || unavailable || !permitted || !hasTaskIdentity} onClick={openTask} className="min-h-10 px-0 text-xs">{t("核对原采购任务")}<ArrowUpRight className="size-3.5" aria-hidden="true" /></Button></footer>
  </section>;
}
