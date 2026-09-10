import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FileSearch, History, Loader2, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";
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
function ResultBadge({ value }: { value: unknown }) {
  const result = displayedResult(value);
  return <span className={`dir-result dir-result--${result === "PASS" ? "pass" : result === "NG" ? "ng" : "pending"}`}>{result}</span>;
}
function Loading({ label = "正在读取记录…" }: { label?: string }) {
  return <div className="dir-state" role="status"><Loader2 size={22} className="dir-spin" /><span>{label}</span></div>;
}
function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <div className="dir-state dir-state--error" role="alert"><AlertCircle size={24} /><span>{message}</span><button className="dir-button" onClick={retry}><RefreshCw size={14} />重试</button></div>;
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
  return <div className="dir-hex"><label>{label}</label><div><code>{text || "未保存原始报文"}</code>
    <button type="button" title={copied ? "已复制" : `复制${label}`} aria-label={copied ? "已复制" : `复制${label}`} disabled={!text} onClick={() => void copy()}>
      {copied ? <Check size={16} /> : <Copy size={16} />}</button></div><span className="dir-sr-only" aria-live="polite">{copied ? "报文已复制" : ""}</span></div>;
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
    <div className="dir-section-title"><h3>当次标准与版本</h3><button className="dir-link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "收起规则快照" : "查看完整规则快照"}<ChevronRight size={14} className={open ? "dir-rotate" : ""} /></button></div>
    <dl className="dir-facts">
      <div><dt>判定方式</dt><dd>{textValue(evidence.condition, textValue(item.expectedValue, "未记录标准"))}</dd></div>
      <div><dt>规则来源</dt><dd>{source}<small>{textValue(evidence.version, textValue(record.ruleVersion, "未记录版本"))}</small></dd></div>
      <div><dt>协议版本</dt><dd>{textValue(objectValue(item.readEvidence).protocolVersion, textValue(record.protocolVersion))}</dd></div>
      <div><dt>固件构建标识</dt><dd>{textValue(record.snapshot.firmwareBuildId, "未登记")}</dd></div>
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
    <div className="dir-section-title"><h3><History size={16} />同台设备前次记录</h3><button className="dir-icon-button" aria-label="关闭历史对比" onClick={onClose}><X size={17} /></button></div>
    {loading ? <Loading label="正在查找同台设备的前次记录…" /> : error ? <ErrorState message={error} retry={() => setAttempt(attempt + 1)} /> : notice ? <p className="dir-muted">{notice}</p> : previous && <>
      <div className="dir-comparison-heading"><p>前次：{previous.testId} · {formatTime(previous.collectionAt)}<br />客户端 {textValue(previous.recordAppVersion)} / 固件 {textValue(previous.firmwareVersion)}</p>
        <label><input type="checkbox" checked={onlyChanged} onChange={event => setOnlyChanged(event.target.checked)} />仅看变化</label></div>
      <div className="dir-comparison-table"><table><thead><tr><th>检测项目</th><th>前次实测 / 结果</th><th>本次实测 / 结果</th><th>变化</th></tr></thead><tbody>
        {rows.filter(row => !onlyChanged || row.changed).map(row => <tr key={row.id}><td>{row.name}</td><td>{row.previous}<ResultBadge value={row.previousResult} /><small className="dir-compare-state">{row.previousReadState}</small></td><td>{row.current}<ResultBadge value={row.currentResult} /><small className="dir-compare-state">{row.currentReadState}</small></td><td>{row.missing ? "项目集合不同" : row.standardChanged ? "标准有变化" : row.readingChanged ? "读取状态变化" : row.changed ? "读数或结果变化" : "一致"}</td></tr>)}
        {onlyChanged && !rows.some(row => row.changed) && <tr><td colSpan={4} className="dir-muted">两次记录的读数、结果和标准一致。</td></tr>}
      </tbody></table></div><p className="dir-footnote">两列分别展示当次结果；标准变化时不按新标准重算前次记录。</p>
    </>}
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
  if (!item) return <div className="dir-state"><FileSearch size={24} /><span>本次记录没有检测项明细。</span><button className="dir-button" onClick={() => downloadRecord(record)}>导出原始记录</button></div>;
  const evidence = objectValue(item.readEvidence); const status = readState(item); const result = itemResult(item, record);
  const fields = Array.isArray(evidence.fields) ? evidence.fields.map(objectValue) : [];
  const request = textValue(evidence.requestHex, ""); const command = request.trim().split(/\s+/)[3];
  return <div className="dir-evidence" id={`evidence-${id}`}>
    <div className="dir-evidence-heading"><h3>{item.name} · 本次证据</h3><label>检测项目<select aria-label="查看检测项证据" value={selectedId} onChange={event => setSelectedId(event.target.value)}>{items.map(value => <option key={value.id} value={value.id}>{value.id.replace("QC-", "")} · {value.name} · {itemResult(value, record)}</option>)}</select></label></div>
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
    </ol><div className="dir-evidence-actions"><button className="dir-button dir-button--primary" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><History size={15} />{historyOpen ? "收起前次记录" : "查看同台前次记录"}</button><button className="dir-button" onClick={() => downloadRecord(record)}><Download size={15} />导出排查资料</button></div></div>
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
      <div className="dir-tabs" aria-label="记录范围"><button aria-pressed={!abnormalOnly} onClick={() => { setAbnormalOnly(false); setPage(1); }}>全部记录</button><button aria-pressed={abnormalOnly} onClick={() => { setAbnormalOnly(true); setPage(1); }}>异常记录</button><button className="dir-refresh" title="刷新记录" aria-label="刷新记录" disabled={loading} onClick={() => setAttempt(attempt + 1)}><RefreshCw size={16} className={loading ? "dir-spin" : ""} /></button></div>
      <div className="dir-filters"><label className="dir-search">UID / SN / 检测编号<div><Search size={17} /><input aria-label="UID / SN / 检测编号" maxLength={128} value={search} placeholder="请输入 UID / SN / 检测编号" onChange={event => setSearch(event.target.value)} />{search && <button aria-label="清空搜索" onClick={() => setSearch("")}><X size={15} /></button>}</div></label>
        <label>检测时间<div className="dir-date-select"><CalendarDays size={16} /><select value={preset} onChange={event => { setPreset(event.target.value); setPage(1); }}><option value="all">全部时间</option><option value="today">今天</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="custom">自定义日期</option></select></div></label>
        <label>检测项目<select value={itemId} onChange={event => { setItemId(event.target.value); setPage(1); }}><option value="">全部项目</option>{ITEM_OPTIONS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>读取状态<select value={readStatus} onChange={event => { setReadStatus(event.target.value); setPage(1); }}><option value="">全部状态</option><option value="WaitingMeasurement">测量未完成</option><option value="ReadError">读取无效</option><option value="Interrupted">通信中断</option><option value="ValidityUnknown">有效性未知</option><option value="ReadComplete">已读取</option><option value="Unsupported">未支持</option><option value="MissingRule">缺少标准</option></select></label>
        <button className="dir-link dir-reset" onClick={reset}>重置</button>
        {preset === "custom" && <div className="dir-custom-dates"><label>开始日期<input type="date" value={fromDate} max={toDate || undefined} onChange={event => { setFromDate(event.target.value); setPage(1); }} /></label><span>至</span><label>结束日期<input type="date" value={toDate} min={fromDate || undefined} onChange={event => { setToDate(event.target.value); setPage(1); }} /></label>{range.error && <span role="alert">{range.error}</span>}</div>}
      </div>
      <div className="dir-table-scroll"><table className="dir-record-table"><thead><tr><th>检测编号</th><th>检测时间</th><th>设备</th><th>检测结果</th><th>异常项目</th><th>客户端 / 固件</th><th>接收状态</th><th>操作</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={8}><Loading /></td></tr> : error ? <tr><td colSpan={8}><ErrorState message={error} retry={() => setAttempt(attempt + 1)} /></td></tr> : range.error ? <tr><td colSpan={8}><div className="dir-state">请选择有效的检测时间范围。</div></td></tr> : !data.items.length ? <tr><td colSpan={8}><div className="dir-state"><FileSearch size={32} /><strong>{filtered ? "没有符合筛选条件的记录" : "暂无设备检测记录"}</strong><span>{filtered ? "调整筛选条件后重试。" : "Windows 客户端上传并收到后台确认后，记录会显示在这里。"}</span>{filtered && <button className="dir-button" onClick={() => { reset(); setAbnormalOnly(false); }}>查看全部记录</button>}</div></td></tr>
          : data.items.map(record => { const open = openId === record.id; return <Fragment key={record.id}><tr className={`dir-record-row${open ? " dir-record-row--open" : ""}`}>
            <td><button className="dir-record-toggle" aria-expanded={open} aria-controls={open ? `evidence-${record.id}` : undefined} onClick={() => setOpenId(open ? null : record.id)}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<span title={record.testId}>{record.testId}</span></button></td>
            <td><time dateTime={record.collectionAt}>{formatTime(record.collectionAt)}</time></td><td><div className="dir-device"><strong>{textValue(record.model)}{record.uidShort ? ` ··· ${record.uidShort}` : ""}</strong><small title={record.uid || undefined}>UID: {record.uidShort ? `··· ${record.uidShort}` : "未记录"}</small><small>SN: {textValue(record.serialNumber)}</small>{record.uid && !record.uidVerified && <small className="dir-warning">UID 未核验</small>}</div></td>
            <td><ResultBadge value={record.inspectionResult} /></td><td><span className="dir-abnormal-items">{record.abnormalItems.length ? record.abnormalItems.map(item => item.name).join(" · ") : "无"}</span></td>
            <td><span className="dir-client-version">{textValue(record.recordAppVersion, "未记录")} / {textValue(record.firmwareVersion, "未记录")}</span></td><td><span className="dir-received">已接收</span></td>
            <td><button className="dir-link" aria-label={`${open ? "收起" : "查看"}检测记录 ${record.testId}`} aria-expanded={open} onClick={() => setOpenId(open ? null : record.id)}>{open ? "收起" : "查看"}{open ? <ChevronDown size={14} className="dir-up" /> : <ChevronRight size={14} />}</button></td>
          </tr>{open && <tr className="dir-expanded-row"><td colSpan={8}><RecordEvidence id={record.id} api={api} preferredItem={itemId} /></td></tr>}</Fragment>; })}
      </tbody></table></div>
      <div className="dir-pagination"><span aria-live="polite">{loading ? "正在读取…" : error || range.error ? "记录暂不可用" : `共 ${data.total} 条记录`}</span><div><button className="dir-icon-button" aria-label="上一页" disabled={loading || page <= 1 || Boolean(error || range.error)} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button><span className="dir-page-index">{page}</span><span className="dir-page-total">/ {totalPages}</span><button className="dir-icon-button" aria-label="下一页" disabled={loading || page >= totalPages || Boolean(error || range.error)} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button><select aria-label="每页条数" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10 条/页</option><option value={25}>25 条/页</option><option value={50}>50 条/页</option></select></div></div>
    </section>
  </div>;
}
