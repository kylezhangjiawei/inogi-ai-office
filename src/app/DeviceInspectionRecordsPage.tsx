import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FileSearch, History, Loader2, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Checkbox } from "./components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import { deviceInspectionRecordsApi } from "./lib/deviceInspectionRecordsApi";
import { compareItems, dateRange, displayedResult, gearText, ITEM_OPTIONS, itemResult, measuredText, objectValue, readState, sameDevicePrevious, snapshotItems, textValue,
  type DeviceInspectionRecordsApi, type FrozenItem, type InspectionRecordDetail, type InspectionRecordSummary, type RecordPage } from "./lib/deviceInspectionRecords";
import "./device-inspection-records.css";

const formatTime = (value: string | null | undefined, short = false) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "未记录";
  return new Date(value).toLocaleString("zh-CN", short
    ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }
    : { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
};
const errorText = (error: unknown) => error instanceof Error ? error.message : "暂时无法读取记录，请稍后重试。";
function FullText({ text, children }: { text: string; children: React.ReactElement }) {
  return <Tooltip delayDuration={250}><TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent className="dir-text-tooltip rounded-lg border border-border bg-popover text-popover-foreground shadow-md [&>svg]:hidden" side="top" sideOffset={6} collisionPadding={12}>{text}</TooltipContent>
  </Tooltip>;
}
function RecordText({ text, fullText = text, lines = 1 }: { text: string; fullText?: string; lines?: 1 | 2 }) {
  return <FullText text={fullText}><span tabIndex={0} className={`dir-text-preview dir-text-preview--${lines}`}>{text}</span></FullText>;
}
function ResultBadge({ value }: { value: unknown }) {
  const result = displayedResult(value);
  return <span className={`dir-result dir-result--${result === "PASS" ? "pass" : result === "NG" ? "ng" : "pending"}`}>{result}</span>;
}
function Loading({ label = "正在读取记录…" }: { label?: string }) {
  return <div className="dir-state" role="status"><Loader2 size={22} className="dir-spin" /><span>{label}</span></div>;
}
function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <div className="dir-state dir-state--error" role="alert"><AlertCircle size={24} /><span>{message}</span><Button variant="outline" onClick={retry}><RefreshCw size={14} />重试</Button></div>;
}
function CopyHex({ label, value }: { label: string; value: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = textValue(value, "");
  useEffect(() => { setCopied(false); }, [text]);
  useEffect(() => { if (!copied) return; const timer = window.setTimeout(() => setCopied(false), 1800); return () => clearTimeout(timer); }, [copied]);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { toast.error("复制失败，请选中报文后手动复制。"); }
  }
  return <div className="dir-hex"><label>{label}</label><div><code tabIndex={0} aria-label={label}>{text || "未保存原始报文"}</code>
    <Button variant="ghost" size="icon" className="size-7 shrink-0" type="button" title={copied ? "已复制" : `复制${label}`} aria-label={copied ? "已复制" : `复制${label}`} disabled={!text} onClick={() => void copy()}>
      {copied ? <Check size={16} /> : <Copy size={16} />}</Button></div><span className="dir-sr-only" aria-live="polite">{copied ? "报文已复制" : ""}</span></div>;
}
function downloadRecord(record: InspectionRecordDetail) {
  // Export the complete received document, including untouched historical snapshots.
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${record.testId.replace(/[^\p{L}\p{N}._-]/gu, "_")}-检测证据.json`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function FrozenRules({ record, item }: { record: InspectionRecordDetail; item: FrozenItem }) {
  const [open, setOpen] = useState(false);
  const evidence = objectValue(item.qcRuleEvidence); const config = objectValue(evidence.config);
  const source = evidence.source === "builtin" || evidence.source === "local" ? "本地默认" : evidence.source === "remote" ? "后台发布" : evidence.source === "cache" ? "缓存规则" : textValue(evidence.source, "未记录");
  return <section className="dir-rule-block" aria-label="当次标准与版本">
    <div className="dir-section-title"><h3>当次标准与版本</h3><Button variant="link" className="h-auto p-0 text-xs" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "收起规则快照" : "查看完整规则快照"}<ChevronRight size={14} className={open ? "dir-rotate" : ""} /></Button></div>
    <dl className="dir-facts">
      <div><dt>判定方式</dt><dd><RecordText lines={2} text={textValue(evidence.condition, textValue(item.expectedValue, "未记录标准"))} /></dd></div>
      <div><dt>规则来源</dt><dd>{source}<small><RecordText text={textValue(evidence.version, textValue(record.ruleVersion, "未记录版本"))} /></small></dd></div>
      <div><dt>协议版本</dt><dd><RecordText text={textValue(objectValue(item.readEvidence).protocolVersion, textValue(record.protocolVersion))} /></dd></div>
      <div><dt>固件构建标识</dt><dd><RecordText text={textValue(record.snapshot.firmwareBuildId, "未登记")} /></dd></div>
    </dl>
    {open && <div className="dir-rule-json"><p>以下为本次记录保存的规则，历史结果不会按后台当前规则重算。</p>
      <pre tabIndex={0}>{JSON.stringify({ deviceIdentity: { uid: record.uid, uidVerified: record.uidVerified, serialNumber: record.serialNumber, model: record.model }, itemEvidence: evidence, config, rulesSnapshot: record.snapshot.qcRulesSnapshot ?? null,
        protocolProfileId: record.snapshot.protocolProfileId ?? null, protocolFingerprint: record.snapshot.protocolFingerprint ?? null }, null, 2)}</pre></div>}
  </section>;
}
function PreviousComparison({ current, api, onClose }: { current: InspectionRecordDetail; api: DeviceInspectionRecordsApi; onClose: () => void }) {
  const [previous, setPrevious] = useState<InspectionRecordDetail | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0); const [onlyChanged, setOnlyChanged] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(""); setNotice(""); setPrevious(null);
    async function load() {
      try {
        let page = 1;
        while (!controller.signal.aborted) {
          const history = await api.history(current.id, page, 100, controller.signal);
          if (controller.signal.aborted) return;
          if (!history.available) { setNotice(history.reason || "本次没有已核验的完整 UID，无法关联同台设备。"); return; }
          const found = sameDevicePrevious(current, history.items);
          if (found) {
            const detail = await api.detail(found.id, controller.signal);
            if (controller.signal.aborted) return;
            if (!detail.uidVerified || detail.uid !== current.uid) throw new Error("历史记录的设备标识不一致，无法比较。");
            setPrevious(detail); return;
          }
          if (!history.items.length || page * history.pageSize >= history.total) { setNotice("这台设备没有更早的检测记录。"); return; }
          page += 1;
        }
      } catch (cause) { if (!controller.signal.aborted) setError(errorText(cause)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [current, api, attempt]);
  const rows = previous ? compareItems(current, previous) : [];
  return <section className="dir-comparison" aria-label="同台设备前次记录对比">
    <div className="dir-section-title"><h3><History size={16} />同台设备前次记录</h3><Button variant="outline" size="icon" className="size-8 rounded-lg" aria-label="关闭历史对比" onClick={onClose}><X size={17} /></Button></div>
    {loading ? <Loading label="正在查找同台设备的前次记录…" /> : error ? <ErrorState message={error} retry={() => setAttempt(attempt + 1)} /> : notice ? <p className="dir-muted">{notice}</p> : previous && <>
      <div className="dir-comparison-heading"><p>前次：{previous.testId} · {formatTime(previous.collectionAt)}<br />客户端 {textValue(previous.recordAppVersion)} / 固件 {textValue(previous.firmwareVersion)}</p>
        <label><Checkbox checked={onlyChanged} onCheckedChange={checked => setOnlyChanged(checked === true)} aria-label="仅看变化" />仅看变化</label></div>
      <div className="dir-comparison-table"><table><thead><tr><th>检测项目</th><th>前次实测 / 结果</th><th>本次实测 / 结果</th><th>变化</th></tr></thead><tbody>
        {rows.filter(row => !onlyChanged || row.changed).map(row => <tr key={row.id}><td>{row.name}</td><td>{row.previous}<ResultBadge value={row.previousResult} /><small className="dir-compare-state">{row.previousReadState}</small></td><td>{row.current}<ResultBadge value={row.currentResult} /><small className="dir-compare-state">{row.currentReadState}</small></td><td>{row.missing ? "项目集合不同" : row.standardChanged ? "标准有变化" : row.readingChanged ? "读取状态变化" : row.changed ? "读数或结果变化" : "一致"}</td></tr>)}
        {onlyChanged && !rows.some(row => row.changed) && <tr><td colSpan={4} className="dir-muted">两次记录的读数、结果和标准一致。</td></tr>}
      </tbody></table></div><p className="dir-footnote">两列分别展示当次结果；标准变化时不按新标准重算前次记录。</p>
    </>}
  </section>;
}
function RecordStaff({ record }: { record: InspectionRecordSummary }) {
  return <div className="dir-staff"><RecordText text={`工位：${textValue(record.station, "未记录")}`} /><small><RecordText text={`操作员：${textValue(record.operator, "未记录")}`} /></small></div>;
}
function ManualConfirmations({ record }: { record: InspectionRecordDetail }) {
  const checks = Array.isArray(record.snapshot.manualChecks) ? record.snapshot.manualChecks.map(objectValue) : [];
  return <section className="dir-manual-checks" aria-label="人工确认项">
    <div className="dir-section-title"><h3>人工确认项</h3><span>本次保存的确认结果</span></div>
    {!checks.length ? <p className="dir-muted">该记录未包含人工确认信息。</p> : <div className="dir-manual-table"><table>
      <thead><tr><th>人工确认项目</th><th>结果</th><th>原因 / 备注</th><th>确认人</th><th>确认时间</th></tr></thead>
      <tbody>{checks.map((check, index) => {
        const result = check.result === "Pass" ? "合格" : check.result === "Fail" ? "不合格" : check.result === "NotChecked" ? "未确认" : "未记录";
        const tone = check.result === "Pass" ? "pass" : check.result === "Fail" ? "ng" : "pending";
        const at = typeof check.confirmedAt === "string" && Number.isFinite(Date.parse(check.confirmedAt)) ? check.confirmedAt : null;
        return <tr key={textValue(check.id, "manual") + "-" + index}>
          <td>{textValue(check.name, "未记录")}</td><td><span className={"dir-result dir-result--" + tone}>{result}</span></td>
          <td>{textValue(check.reason, "—")}</td><td>{textValue(check.operator, "未记录")}</td>
          <td><time dateTime={at ?? undefined}>{at ? new Date(at).toLocaleString("zh-CN", { hour12: false }) : "未记录"}</time></td>
        </tr>;
      })}</tbody>
    </table></div>}
  </section>;
}
function RecordEvidence({ id, api, preferredItem }: { id: string; api: DeviceInspectionRecordsApi; preferredItem: string }) {
  const [record, setRecord] = useState<InspectionRecordDetail | null>(null); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(""); const [attempt, setAttempt] = useState(0); const [selectedId, setSelectedId] = useState(""); const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(""); setHistoryOpen(false);
    api.detail(id, controller.signal).then(detail => {
      if (controller.signal.aborted) return;
      setRecord(detail); const items = snapshotItems(detail);
      setSelectedId(items.find(item => item.id === preferredItem)?.id ?? items.find(item => detail.abnormalItems.some(abnormal => abnormal.id === item.id))?.id ?? items[0]?.id ?? "");
    }).catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, api, attempt, preferredItem]);
  if (loading) return <Loading label="正在读取当次证据…" />;
  if (error) return <ErrorState message={error} retry={() => setAttempt(attempt + 1)} />;
  if (!record) return null;
  const items = snapshotItems(record); const item = items.find(value => value.id === selectedId);
  if (!item) return <><ManualConfirmations record={record} /><div className="dir-state"><FileSearch size={24} /><span>本次记录没有检测项明细。</span><Button variant="outline" size="sm" className="rounded-lg" onClick={() => downloadRecord(record)}>导出原始记录</Button></div></>;
  const evidence = objectValue(item.readEvidence); const status = readState(item); const result = itemResult(item, record);
  const fields = Array.isArray(evidence.fields) ? evidence.fields.map(objectValue) : [];
  const request = textValue(evidence.requestHex, ""); const command = request.trim().split(/\s+/)[3];
  return <div className="dir-evidence" id={`evidence-${id}`}>
    <ManualConfirmations record={record} />
    <div className="dir-evidence-heading"><h3>{item.name} · 本次证据</h3><div className="dir-evidence-select"><span>检测项目</span><Select value={selectedId} onValueChange={setSelectedId}>
      <SelectTrigger aria-label="查看检测项证据" className="w-72 max-w-full rounded-lg bg-card text-xs"><SelectValue /></SelectTrigger>
      <SelectContent className="rounded-lg shadow-md">{items.map(value => <SelectItem key={value.id} value={value.id}>{value.id.replace("QC-", "")} · {value.name} · {itemResult(value, record)}</SelectItem>)}</SelectContent>
    </Select></div></div>
    <div className="dir-evidence-grid"><section className="dir-reading-block" aria-label="本次检测项读数与报文">
      <div className="dir-reading-banner"><strong className={`dir-read-state${["ReadError", "WaitingMeasurement", "Interrupted", "ValidityUnknown"].includes(item.status || "") ? " dir-read-state--warning" : ""}`}>{status}</strong><p>{textValue(item.qcConditionExplanation, textValue(item.detail, "此记录未保存补充说明。"))}</p></div>
      <div className="dir-reading-data"><dl className="dir-facts"><div><dt>指令</dt><dd className="dir-mono">{command || textValue(evidence.readingId)}</dd></div><div><dt>实测值</dt><dd>{measuredText(item)}</dd></div>

        {item.id === "QC-009" && <div><dt>当前档位</dt><dd>{gearText(record, item)}</dd></div>}<div><dt>判定结果</dt><dd><ResultBadge value={result} /></dd></div></dl>
        <div className="dir-hexes"><CopyHex label="请求报文（Hex）" value={evidence.requestHex} /><CopyHex label="应答报文（Hex）" value={evidence.responseHex} /></div>
      </div>
      {fields.length > 0 && <details className="dir-fields"><summary>查看原始字段与完整说明</summary><table><thead><tr><th>字段</th><th>读数</th><th>原始 Hex</th></tr></thead><tbody>{fields.map((field, index) => <tr key={`${textValue(field.id)}-${index}`}><td>{textValue(field.name, textValue(field.id))}</td><td>{textValue(field.value, textValue(field.numericValue))} {textValue(field.unit, "")}</td><td className="dir-mono">{textValue(field.rawHex)}</td></tr>)}</tbody></table><p>{textValue(item.detail, "无补充说明")}</p></details>}
    </section><FrozenRules key={selectedId} record={record} item={item} /></div>
    <div className="dir-evidence-footer"><ol className="dir-timeline" aria-label="本次证据时间线">
      {[{ label: "采集", at: record.collectionAt }, { label: "本地保存", at: record.saveAt }, { label: "后台接收", at: record.receivedAt }].map((step, index) => <li key={step.label}><span className="dir-timeline-dot" /><span>{step.label}<time title={formatTime(step.at)}>{formatTime(step.at, true)}</time></span>{index < 2 && <ArrowRight size={21} aria-hidden="true" />}</li>)}
    </ol><div className="dir-evidence-actions"><Button size="sm" className="rounded-lg" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><History size={15} />{historyOpen ? "收起前次记录" : "查看同台前次记录"}</Button><Button variant="outline" size="sm" className="rounded-lg" onClick={() => downloadRecord(record)}><Download size={15} />导出排查资料</Button></div></div>
    {historyOpen && <PreviousComparison current={record} api={api} onClose={() => setHistoryOpen(false)} />}
  </div>;
}

export function DeviceInspectionRecordsPage({ api = deviceInspectionRecordsApi, demo = false }: { api?: DeviceInspectionRecordsApi; demo?: boolean }) {
  const [abnormalOnly, setAbnormalOnly] = useState(demo); const [search, setSearch] = useState(""); const [debouncedSearch, setDebouncedSearch] = useState("");
  const [preset, setPreset] = useState(demo ? "7" : "all"); const [fromDate, setFromDate] = useState(""); const [toDate, setToDate] = useState("");
  const [itemId, setItemId] = useState(demo ? "QC-009" : ""); const [readStatus, setReadStatus] = useState(demo ? "WaitingMeasurement" : ""); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<RecordPage>({ items: [], total: 0, page: 1, pageSize: 10 }); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0); const [openId, setOpenId] = useState<string | null>(null);
  const requestEpoch = useRef(0); const initialOpen = useRef(demo);
  useEffect(() => { const timer = window.setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  const range = useMemo(() => dateRange(preset, fromDate, toDate), [preset, fromDate, toDate, attempt]);
  useEffect(() => {
    const epoch = ++requestEpoch.current; const controller = new AbortController(); setOpenId(null);
    if (range.error) { setLoading(false); return; }
    setLoading(true); setError("");
    api.list({ page, pageSize, search: debouncedSearch, abnormalOnly, itemId, readStatus, from: range.from, to: range.to }, controller.signal)
      .then(result => {
        if (controller.signal.aborted || epoch !== requestEpoch.current) return;
        if (result.total > 0 && page > Math.ceil(result.total / pageSize)) { setPage(Math.ceil(result.total / pageSize)); return; }
        setData(result); if (initialOpen.current) { setOpenId(result.items[0]?.id ?? null); initialOpen.current = false; }
      }).catch(cause => { if (!controller.signal.aborted && epoch === requestEpoch.current) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted && epoch === requestEpoch.current) setLoading(false); });
    return () => controller.abort();
  }, [api, page, pageSize, debouncedSearch, abnormalOnly, itemId, readStatus, range, attempt]);
  function reset() { setSearch(""); setDebouncedSearch(""); setPreset("all"); setFromDate(""); setToDate(""); setItemId(""); setReadStatus(""); setPage(1); }
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const filtered = Boolean(debouncedSearch || itemId || readStatus || preset !== "all" || abnormalOnly);
  return <div className="dir-page">
    <div className="dir-intro"><p>按异常定位记录，查看当次证据。</p>{demo && <strong className="dir-demo-label">本地演示 · 合成数据</strong>}</div>
    <section className="dir-card" aria-label="设备检测记录">
      <Tabs className="gap-0" value={abnormalOnly ? "abnormal" : "all"} onValueChange={value => { setAbnormalOnly(value === "abnormal"); setPage(1); }}>
      <div className="dir-tabs"><TabsList className="h-12 gap-6 rounded-none bg-transparent p-0" aria-label="记录范围"><TabsTrigger className="h-12 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 font-medium shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="all">全部记录</TabsTrigger><TabsTrigger className="h-12 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 font-medium shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="abnormal">异常记录</TabsTrigger></TabsList><Button variant="ghost" size="icon" className="ml-auto size-8 rounded-lg text-muted-foreground" title="刷新记录" aria-label="刷新记录" disabled={loading} onClick={() => setAttempt(attempt + 1)}><RefreshCw size={16} className={loading ? "dir-spin" : ""} /></Button></div>
      <TabsContent value={abnormalOnly ? "abnormal" : "all"}>
      <div className="dir-filters"><div className="dir-filter-field dir-search"><label htmlFor="dir-search">UID / SN / 检测编号</label><div className="relative"><Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input id="dir-search" className="h-10 rounded-lg bg-card pl-9 pr-10 text-sm" maxLength={128} value={search} placeholder="请输入 UID / SN / 检测编号" onChange={event => setSearch(event.target.value)} />{search && <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 size-7 -translate-y-1/2" aria-label="清空搜索" onClick={() => setSearch("")}><X size={15} /></Button>}</div></div>
        <div className="dir-filter-field"><label htmlFor="dir-preset">检测时间</label><Select value={preset} onValueChange={value => { setPreset(value); setPage(1); }}>
          <SelectTrigger id="dir-preset" className="rounded-lg bg-card text-sm data-[size=default]:h-10"><SelectValue /></SelectTrigger><SelectContent className="rounded-lg shadow-md"><SelectItem value="all">全部时间</SelectItem><SelectItem value="today">今天</SelectItem><SelectItem value="7">最近 7 天</SelectItem><SelectItem value="30">最近 30 天</SelectItem><SelectItem value="custom">自定义日期</SelectItem></SelectContent>
        </Select></div>
        <div className="dir-filter-field"><label htmlFor="dir-item">检测项目</label><Select value={itemId || "all"} onValueChange={value => { setItemId(value === "all" ? "" : value); setPage(1); }}>
          <SelectTrigger id="dir-item" className="rounded-lg bg-card text-sm data-[size=default]:h-10"><SelectValue /></SelectTrigger><SelectContent className="rounded-lg shadow-md"><SelectItem value="all">全部项目</SelectItem>{ITEM_OPTIONS.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent>
        </Select></div>
        <div className="dir-filter-field"><label htmlFor="dir-read-status">读取状态</label><Select value={readStatus || "all"} onValueChange={value => { setReadStatus(value === "all" ? "" : value); setPage(1); }}>
          <SelectTrigger id="dir-read-status" className="rounded-lg bg-card text-sm data-[size=default]:h-10"><SelectValue /></SelectTrigger><SelectContent className="rounded-lg shadow-md"><SelectItem value="all">全部状态</SelectItem><SelectItem value="WaitingMeasurement">测量未完成</SelectItem><SelectItem value="ReadError">读取无效</SelectItem><SelectItem value="Interrupted">通信中断</SelectItem><SelectItem value="ValidityUnknown">有效性未知</SelectItem><SelectItem value="ReadComplete">已读取</SelectItem><SelectItem value="Unsupported">未支持</SelectItem><SelectItem value="MissingRule">缺少标准</SelectItem></SelectContent>
        </Select></div>
        <Button variant="ghost" className="h-10 rounded-lg px-2 text-xs text-muted-foreground" onClick={reset}>重置</Button>
        {preset === "custom" && <div className="dir-custom-dates"><label>开始日期<Input className="h-10 rounded-lg bg-card" type="date" value={fromDate} max={toDate || undefined} onChange={event => { setFromDate(event.target.value); setPage(1); }} /></label><span>至</span><label>结束日期<Input className="h-10 rounded-lg bg-card" type="date" value={toDate} min={fromDate || undefined} onChange={event => { setToDate(event.target.value); setPage(1); }} /></label>{range.error && <span role="alert">{range.error}</span>}</div>}
      </div>
      <div className="dir-table-scroll" tabIndex={0} aria-label="设备检测记录表格"><table className="dir-record-table"><thead><tr><th>检测编号</th><th>检测时间</th><th>设备</th><th>工位 / 操作员</th><th>检测结果</th><th>异常项目</th><th>客户端 / 固件</th><th>接收状态</th><th>操作</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={9}><Loading /></td></tr> : error ? <tr><td colSpan={9}><ErrorState message={error} retry={() => setAttempt(attempt + 1)} /></td></tr> : range.error ? <tr><td colSpan={9}><div className="dir-state">请选择有效的检测时间范围。</div></td></tr> : !data.items.length ? <tr><td colSpan={9}><div className="dir-state"><FileSearch size={32} /><strong>{filtered ? "没有符合筛选条件的记录" : "暂无设备检测记录"}</strong><span>{filtered ? "调整筛选条件后重试。" : "Windows 客户端上传并收到后台确认后，记录会显示在这里。"}</span>{filtered && <Button variant="outline" onClick={() => { reset(); setAbnormalOnly(false); }}>查看全部记录</Button>}</div></td></tr>
          : data.items.map(record => { const open = openId === record.id; return <Fragment key={record.id}><tr className={`dir-record-row${open ? " dir-record-row--open" : ""}`}>
            <td><FullText text={record.testId}><Button variant="ghost" className="dir-record-toggle h-auto justify-start rounded-sm p-0 font-normal hover:bg-transparent" aria-expanded={open} aria-controls={open ? `evidence-${record.id}` : undefined} onClick={() => setOpenId(open ? null : record.id)}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<span className="dir-text-preview dir-text-preview--2">{record.testId}</span></Button></FullText></td>
            <td><time dateTime={record.collectionAt}>{formatTime(record.collectionAt)}</time></td><td><div className="dir-device"><strong><RecordText text={`${textValue(record.model)}${record.uidShort ? ` ··· ${record.uidShort}` : ""}`} /></strong><small><RecordText text={`UID: ${record.uidShort ? `··· ${record.uidShort}` : "未记录"}`} fullText={`UID: ${record.uid || "未记录"}`} /></small><small><RecordText text={`SN: ${textValue(record.serialNumber)}`} /></small>{record.uid && !record.uidVerified && <small className="dir-warning">UID 未核验</small>}</div></td>
            <td><RecordStaff record={record} /></td><td><ResultBadge value={record.inspectionResult} /></td><td><span className="dir-abnormal-items"><RecordText lines={2} text={record.abnormalItems.length ? record.abnormalItems.map(item => item.name).join(" · ") : "无"} /></span></td>
            <td><div className="dir-client-version"><RecordText text={`客户端 ${textValue(record.recordAppVersion, "未记录")}`} /><small><RecordText text={`固件 ${textValue(record.firmwareVersion, "未记录")}`} /></small></div></td><td><span className="dir-received"><Check size={12} aria-hidden="true" />已接收</span></td>
            <td><Button variant="link" className="h-auto p-0 text-xs" aria-label={`${open ? "收起" : "查看"}检测记录 ${record.testId}`} aria-expanded={open} onClick={() => setOpenId(open ? null : record.id)}>{open ? "收起" : "查看"}{open ? <ChevronDown size={14} className="dir-up" /> : <ChevronRight size={14} />}</Button></td>
          </tr>{open && <tr className="dir-expanded-row"><td colSpan={9}><RecordEvidence id={record.id} api={api} preferredItem={itemId} /></td></tr>}</Fragment>; })}
      </tbody></table></div>
      <div className="dir-pagination"><span aria-live="polite">{loading ? "正在读取…" : error || range.error ? "记录暂不可用" : `共 ${data.total} 条记录`}</span><div><Button variant="outline" size="icon" className="size-8 rounded-lg" aria-label="上一页" disabled={loading || page <= 1 || Boolean(error || range.error)} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></Button><span className="dir-page-index">{page}</span><span className="dir-page-total">/ {totalPages}</span><Button variant="outline" size="icon" className="size-8 rounded-lg" aria-label="下一页" disabled={loading || page >= totalPages || Boolean(error || range.error)} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></Button><Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1); }}><SelectTrigger size="sm" className="w-28 shrink-0 rounded-lg bg-card text-xs" aria-label="每页条数"><SelectValue /></SelectTrigger><SelectContent className="rounded-lg shadow-md">{[10, 25, 50].map(size => <SelectItem key={size} value={String(size)}>{size} 条/页</SelectItem>)}</SelectContent></Select></div></div>
      </TabsContent></Tabs>
    </section>
  </div>;
}
