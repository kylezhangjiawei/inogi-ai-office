import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, ChevronRight, CircleHelp, Info, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { GateNavigationGuard } from "./components/GateNavigationGuard";
import { Switch } from "./components/ui/switch";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./components/ui/alert-dialog";
import { electronicGateApi, GateApiError, type ElectronicGateApi, type GateCategory, type GateConfig, type GateField, type GateItem } from "./lib/electronicGateApi";
import { validateGateConfig as validate } from "./lib/electronicGateValidation";
import { FactoryQcProtocolPanel, FactoryQcConnectionStatus } from "./FactoryQcProtocolPanel";
import type { FactoryQcApi } from "./lib/factoryQcApi";
import "./electronic-gate.css";

type Tab = "rules" | "manual" | "connection" | "command" | "protocol";
type Errors = Record<string, string>;
const TABS: { id: Tab; label: string }[] = [
  { id: "rules", label: "检测规则" }, { id: "manual", label: "人工确认" },
  { id: "connection", label: "连接参数" }, { id: "protocol", label: "读取协议" }, { id: "command", label: "返工指令" },
];
const CATEGORY_LABEL: Record<GateCategory, string> = { critical: "重点检测", routine: "常规检测", manual: "人工确认", connection: "连接参数", command: "返工指令" };
const configOf = (item: GateItem) => item.draft ?? item.active ?? item.defaults;
const cloneConfig = (config: GateConfig): GateConfig => ({ ...config, values: { ...config.values } });
const sameConfig = (a: GateConfig, b: GateConfig) => a.enabled === b.enabled && a.model === b.model && a.market === b.market && a.displayName === b.displayName && a.helpText === b.helpText && a.failureAction === b.failureAction && Object.keys({ ...a.values, ...b.values }).every(key => (a.values[key] ?? "") === (b.values[key] ?? ""));

function summary(item: GateItem, config: GateConfig | null) {
  if (!config) return "待配置";
  const parts = item.fields.filter(field => config.values[field.key]?.trim()).slice(0, 3).map(field => {
    const value = config.values[field.key];
    const label = field.options?.find(option => option.value === value)?.label ?? value;
    return `${label}${field.unit ? ` ${field.unit}` : ""}`;
  });
  return parts.join(" · ") || "条件待补充";
}
function dateLabel(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
function Status({ item, dirty }: { item: GateItem; dirty?: boolean }) {
  const state = dirty ? "unsaved" : item.draft ? "draft" : item.active ? (item.active.enabled ? "published" : "disabled") : "pending";
  const labels = { unsaved: "未保存", draft: item.active ? "有更新草稿" : "草稿 · 待确认", published: "已发布", disabled: "已发布 · 停用", pending: "待配置" };
  return <span className={`eg-status eg-status--${state}`}><span aria-hidden="true" />{labels[state]}</span>;
}
function Field({ id, label, error, help, children, wide = false }: { id: string; label: string; error?: string; help?: string; children: React.ReactNode; wide?: boolean }) {
  return <div className={`eg-field${wide ? " eg-field--wide" : ""}`}>
    <label htmlFor={id}>{label}</label>{children}
    {error ? <span id={`${id}-error`} className="eg-field-error" role="alert">{error}</span> : help ? <span id={`${id}-help`} className="eg-field-help">{help}</span> : null}
  </div>;
}
function ValueField({ item, field, config, errors, onChange, disabled }: { item: GateItem; field: GateField; config: GateConfig; errors: Errors; onChange: (value: string) => void; disabled: boolean }) {
  const id = `eg-${item.id}-${field.key}`;
  const help = field.key === "readbackSource" ? undefined : field.help;
  const props = { id, disabled, value: config.values[field.key] ?? "", "aria-invalid": !!errors[field.key], "aria-describedby": errors[field.key] ? `${id}-error` : help ? `${id}-help` : undefined, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange(event.target.value) };
  return <Field id={id} label={field.label} error={errors[field.key]} help={help} wide={field.type === "textarea"}>
    <div className="eg-value-control">
      {field.type === "select" ? <select {...props}><option value="">请选择</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : field.type === "textarea" ? <Textarea {...props} rows={2} maxLength={2000} placeholder={`填写${field.label}`} />
          : <Input {...props} type="text" inputMode={field.type === "number" ? "decimal" : undefined} maxLength={500} placeholder={`填写${field.label}`} />}
      {field.unit && <span className="eg-unit">{field.unit}</span>}
    </div>
  </Field>;
}

export function ElectronicGatePage({ api = electronicGateApi, factoryApi }: { api?: ElectronicGateApi; factoryApi?: FactoryQcApi }) {
  const [items, setItems] = useState<GateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("rules");
  const [group, setGroup] = useState<"critical" | "routine">("critical");
  const [search, setSearch] = useState("");
  const [protocolDirty, setProtocolDirty] = useState(false);
  const [protocolVisited, setProtocolVisited] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, GateConfig>>({});
  const [errors, setErrors] = useState<Record<string, Errors>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, { message: string; conflict: boolean }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "publish" | "reload"; id: string } | null>(null);
  const requestEpoch = useRef(0);
  const mutationBusy = useRef(false);
  const currentCategory: GateCategory = tab === "rules" ? group : tab === "protocol" ? "connection" : tab;

  const load = useCallback(async () => {
    const epoch = ++requestEpoch.current;
    setLoading(true); setLoadError("");
    try {
      const response = await api.list();
      if (epoch !== requestEpoch.current) return;
      setItems(response.items);
      setOpenId(response.items.find(item => item.category === "critical" && Number(item.number) === 16)?.id ?? null);
    } catch (error) {
      if (epoch === requestEpoch.current) setLoadError(error instanceof Error ? error.message : "暂时无法读取配置，请稍后重试。");
    } finally { if (epoch === requestEpoch.current) setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); return () => { requestEpoch.current++; }; }, [load]);
  const dirtyIds = useMemo(() => items.filter(item => edits[item.id] && !sameConfig(edits[item.id], configOf(item))).map(item => item.id), [items, edits]);
  useEffect(() => {
    if (!dirtyIds.length && !protocolDirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirtyIds.length, protocolDirty]);

  const counts = useMemo(() => items.reduce((result, item) => { result[item.category]++; return result; }, { critical: 0, routine: 0, manual: 0, connection: 0, command: 0 }), [items]);
  const visibleItems = useMemo(() => {
    const filtered = items.filter(item => item.category === currentCategory && `${item.number} ${item.title} ${configOf(item).displayName}`.toLowerCase().includes(search.trim().toLowerCase()));
    if (currentCategory !== "critical") return filtered;
    // Keep the selected design's frequently edited default setting near the top.
    const order = [22, 6, 16, 8, 9, 10, 11, 12, 13, 14, 15];
    return [...filtered].sort((a, b) => order.indexOf(Number(a.number)) - order.indexOf(Number(b.number)));
  }, [items, currentCategory, search]);
  const unpublished = items.filter(item => ["critical", "routine"].includes(item.category) && !item.active).length;

  function change(item: GateItem, patch: Partial<GateConfig>) {
    setEdits(prev => ({ ...prev, [item.id]: { ...cloneConfig(prev[item.id] ?? configOf(item)), ...patch, ...(item.category === "connection" ? { enabled: true } : {}) } }));
    setErrors(prev => ({ ...prev, [item.id]: {} }));
    setSaveErrors(prev => ({ ...prev, [item.id]: undefined }));
  }
  function discard(item: GateItem) {
    setEdits(prev => { const next = { ...prev }; delete next[item.id]; return next; });
    setErrors(prev => ({ ...prev, [item.id]: {} })); setSaveErrors(prev => ({ ...prev, [item.id]: undefined }));
    setOpenId(null);
  }
  function updateSaved(item: GateItem) {
    setItems(prev => prev.map(current => current.id === item.id ? item : current));
    setEdits(prev => { const next = { ...prev }; delete next[item.id]; return next; });
    setErrors(prev => ({ ...prev, [item.id]: {} }));
    setSaveErrors(prev => ({ ...prev, [item.id]: undefined }));
  }
  function showErrors(item: GateItem, fieldErrors: Errors) {
    setErrors(prev => ({ ...prev, [item.id]: fieldErrors }));
    const key = Object.keys(fieldErrors)[0];
    if (key) requestAnimationFrame(() => {
      const input = document.getElementById(`eg-${item.id}-${key}`);
      const details = input?.closest("details");
      if (details) details.open = true;
      input?.focus();
    });
  }
  async function save(item: GateItem) {
    if (mutationBusy.current) return;
    const config = cloneConfig(edits[item.id] ?? configOf(item));
    if (item.category === "connection") config.enabled = true;
    const fieldErrors = validate(item, config);
    if (Object.keys(fieldErrors).length) { showErrors(item, fieldErrors); return; }
    mutationBusy.current = true; setBusyId(item.id);
    try { updateSaved(await api.saveDraft(item.id, item.revision, config)); toast.success(`${item.title}：本项草稿已保存`); }
    catch (error) { saveFailed(item, error); }
    finally { mutationBusy.current = false; setBusyId(null); }
  }
  function saveFailed(item: GateItem, error: unknown) {
    const conflict = error instanceof GateApiError && error.status === 409;
    setSaveErrors(prev => ({ ...prev, [item.id]: { conflict, message: conflict ? "本项已被其他人更新。你的修改仍保留，请核对最新配置后再保存。" : error instanceof Error ? error.message : "保存失败，请稍后重试。你的修改仍保留。" } }));
  }
  function startPublish(item: GateItem) {
    if (!item.draft || dirtyIds.includes(item.id)) return;
    const fieldErrors = validate(item, item.draft, true);
    if (Object.keys(fieldErrors).length) { showErrors(item, fieldErrors); return; }
    setDialog({ kind: "publish", id: item.id });
  }
  async function confirmDialog() {
    if (!dialog || mutationBusy.current) return;
    const item = items.find(current => current.id === dialog.id);
    if (!item) return;
    mutationBusy.current = true; setBusyId(item.id);
    try {
      if (dialog.kind === "publish") {
        updateSaved(await api.publish(item.id, item.revision));
        toast.success(`${item.title}：本项配置已发布`);
      } else {
        const response = await api.list();
        const latest = response.items.find(current => current.id === item.id);
        if (!latest) throw new Error("未找到本项配置，请重新打开页面。");
        updateSaved(latest); toast.success("已重新加载本项配置");
      }
      setDialog(null);
    } catch (error) { setDialog(null); saveFailed(item, error); }
    finally { mutationBusy.current = false; setBusyId(null); }
  }
  const dialogItem = dialog && items.find(item => item.id === dialog.id);

  return <div className="eg-page horizon-theme hz-page" aria-label="电子闸门配置">
    <GateNavigationGuard when={dirtyIds.length > 0 || protocolDirty} />
    {loading ? <div className="eg-state hz-surface" role="status"><Loader2 className="eg-spin" size={24} /><h2>正在读取配置</h2><p>读取检测规则、人工确认项和设备连接参数。</p></div>
      : loadError ? <div className="eg-state eg-state--error hz-surface" role="alert"><AlertCircle size={28} /><h2>暂时无法读取电子闸门配置</h2><p>{loadError}</p><Button onClick={() => void load()}><RefreshCw size={16} />重新加载</Button></div>
        : <>
          <nav className="eg-tabs" aria-label="电子闸门配置分类">{TABS.map(item => <button key={item.id} type="button" aria-current={tab === item.id ? "page" : undefined} onClick={() => { setTab(item.id); setSearch(""); if (item.id === "protocol") setProtocolVisited(true); }}>{item.label}{item.id !== "protocol" && <span>{item.id === "rules" ? counts.critical + counts.routine : counts[item.id]}</span>}</button>)}</nav>
          {protocolVisited && <div hidden={tab !== "protocol"}><FactoryQcProtocolPanel api={factoryApi} onDirtyChange={setProtocolDirty} /></div>}
          <div hidden={tab === "protocol"}>
          {tab === "connection" && <FactoryQcConnectionStatus api={factoryApi} refreshKey={items.reduce((total, item) => total + item.revision, 0)} onChanged={() => { void api.list().then(response => setItems(current => response.items.map(item => dirtyIds.includes(item.id) ? current.find(previous => previous.id === item.id) ?? item : item))).catch(error => toast.error(error instanceof Error ? error.message : "刷新配置失败")); }} />}
          {tab === "rules" && <div className={`eg-notice${unpublished ? "" : " eg-notice--neutral"}`}><AlertCircle size={21} aria-hidden="true" /><div><strong>{unpublished ? "必检规则未就绪时，不可放行。" : "配置按项独立发布。"}</strong><span>{unpublished ? `还有 ${unpublished} 项检测标准未发布，请逐项确认标准与适用范围。` : "放行须结合适用规则与实际检测结果判断。"}</span></div></div>}
          {dirtyIds.length > 0 && <p className="eg-unsaved-note" role="status">有 {dirtyIds.length} 项未保存的修改，切换分类后仍会保留。离开页面前请分别保存。</p>}
          <section className="eg-list hz-surface" aria-label={`${CATEGORY_LABEL[currentCategory]}配置列表`}>
            <div className="eg-toolbar">{tab === "rules" ? <div className="eg-groups" aria-label="检测分组">{(["critical", "routine"] as const).map(value => <button key={value} type="button" aria-pressed={group === value} onClick={() => setGroup(value)}>{CATEGORY_LABEL[value]}<span>{counts[value]}</span></button>)}</div> : <div className="eg-section-label">{CATEGORY_LABEL[currentCategory]}<span>{counts[currentCategory]} 项 · 分别配置和保存</span></div>}
              <label className="eg-search"><Search size={17} aria-hidden="true" /><input aria-label="搜索配置项名称或编号" value={search} onChange={event => setSearch(event.target.value)} placeholder={tab === "rules" ? "搜索规则名称或编号" : "搜索配置项名称或编号"} />{search && <button type="button" onClick={() => setSearch("")} aria-label="清空搜索">清空</button>}</label>
            </div>
            {tab === "connection" && <p className="eg-category-help">12 项分别保存并发布，全部就绪后生成完整下载版本。未单独配置工位地址时，同一地址下的工位共用这套参数。</p>}
            {tab === "command" && <p className="eg-category-help">维护返工指令的参数、执行前提与完成验证；这里不会向设备执行指令。</p>}
            {tab === "manual" && <p className="eg-category-help">每个人工确认项分别配置检查内容与确认要求，供检测人员逐项核验。</p>}
            <div className="eg-column-head" aria-hidden="true"><span>序号</span><span>{tab === "rules" ? "规则名称" : "配置项"}</span><span>{tab === "connection" ? "配置内容" : "主要判定条件"}</span><span>状态</span><span>操作</span></div>
            {!visibleItems.length && <div className="eg-state eg-empty"><Search size={26} /><h2>{search ? "没有找到匹配的配置项" : "暂无配置项"}</h2><p>{search ? "试试其他名称或编号，或清空搜索查看全部。" : "当前分类还没有可配置项目。"}</p>{search && <Button variant="outline" onClick={() => setSearch("")}>清空搜索</Button>}</div>}
            {visibleItems.map(item => {
              const expanded = openId === item.id;
              const config = edits[item.id] ?? configOf(item);
              const dirty = dirtyIds.includes(item.id);
              const fieldErrors = errors[item.id] ?? {};
              const saveError = saveErrors[item.id];
              const busy = busyId === item.id;
              const fieldId = (key: string) => `eg-${item.id}-${key}`;
              return <article className={`eg-item${expanded ? " eg-item--open" : ""}`} key={item.id}>
                <div className="eg-row"><span className="eg-number">{item.number}</span><button type="button" className="eg-item-title" title={item.description} aria-expanded={expanded} aria-controls={`eg-panel-${item.id}`} onClick={() => setOpenId(expanded ? null : item.id)}>{item.title}{expanded && <span className={`eg-category-tag eg-category-tag--${item.category}`}>{CATEGORY_LABEL[item.category]}</span>}</button><div className="eg-row-summary"><span className="eg-summary" title={summary(item, item.draft ?? item.active)}>{summary(item, item.draft ?? item.active)}</span>{expanded && tab !== "connection" && <label className="eg-row-toggle" htmlFor={fieldId("enabled")}><span>{tab === "command" ? "启用本项" : "参与检测"}</span><Switch id={fieldId("enabled")} checked={config.enabled} onCheckedChange={enabled => change(item, { enabled })} disabled={busy} aria-description="保存并发布后应用" /></label>}</div><Status item={item} dirty={dirty} /><button type="button" className="eg-configure" aria-label={`${expanded ? "收起" : "配置"}${item.title}`} aria-expanded={expanded} aria-controls={`eg-panel-${item.id}`} onClick={() => setOpenId(expanded ? null : item.id)}>{expanded ? "收起" : "配置"}{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></div>
                {expanded && <form id={`eg-panel-${item.id}`} className="eg-editor" onSubmit={event => { event.preventDefault(); void save(item); }} aria-label={`${item.title}配置表单`}>
                  <fieldset disabled={busy} className="eg-form-fields"><legend className="sr-only">本项配置</legend><div className="eg-form-grid">
                    {tab !== "connection" && <><Field id={fieldId("model")} label="适用机型" error={fieldErrors.model}><Input id={fieldId("model")} value={config.model} onChange={event => change(item, { model: event.target.value })} aria-invalid={!!fieldErrors.model} aria-describedby={fieldErrors.model ? `${fieldId("model")}-error` : undefined} maxLength={100} placeholder="填写适用机型" /></Field>
                    <Field id={fieldId("market")} label="发货市场 / 区域" error={fieldErrors.market}><Input id={fieldId("market")} value={config.market} onChange={event => change(item, { market: event.target.value })} aria-invalid={!!fieldErrors.market} aria-describedby={fieldErrors.market ? `${fieldId("market")}-error` : undefined} maxLength={100} placeholder="填写发货市场 / 区域" /></Field></>}
                    {item.fields.filter(field => field.key !== "evidence").sort((a, b) => a.key === "expected" ? -1 : b.key === "expected" ? 1 : 0).map(field => <ValueField key={field.key} item={item} field={field} config={config} errors={fieldErrors} disabled={busy} onChange={value => change(item, { values: { ...config.values, [field.key]: value } })} />)}
                    {tab !== "connection" && <Field id={fieldId("failureAction")} label="不通过时"><select id={fieldId("failureAction")} value={config.failureAction} onChange={event => change(item, { failureAction: event.target.value as GateConfig["failureAction"] })}><option value="block">阻止放行</option><option value="warn">记录并提示</option></select></Field>}
                  </div>
                  {tab !== "connection" && <div className="eg-evidence-note"><Info size={17} aria-hidden="true" /><div><strong>{item.id === "default-sensitivity" || item.id === "default-gear" ? "回读证据缺失时不可判定通过。" : "未确认的标准保留为草稿。"}</strong><p>{item.id === "default-sensitivity" ? "7F 直接读取 EEPROM 灵敏度设置；修改后需完全断电、重新上电回读验证。" : item.id === "default-gear" ? "86 读取 RAM 当前档位；单次读到 3 不能证明掉电保存，需完全断电、重新上电验证。" : "请核对配置依据和适用范围；示例参数不代表已确认的出厂标准。"}</p></div></div>}
                  <div className="eg-copy-grid"><Field id={fieldId("displayName")} label={tab === "connection" ? "后台显示名称" : "显示名称（用于产线提示）"} error={fieldErrors.displayName}><Input id={fieldId("displayName")} value={config.displayName} onChange={event => change(item, { displayName: event.target.value })} maxLength={100} aria-invalid={!!fieldErrors.displayName} aria-describedby={fieldErrors.displayName ? `${fieldId("displayName")}-error` : undefined} /></Field><Field id={fieldId("helpText")} label={tab === "connection" ? "后台说明（不下发）" : "帮助说明（用于产线提示）"}><Input id={fieldId("helpText")} value={config.helpText} onChange={event => change(item, { helpText: event.target.value })} maxLength={500} placeholder={tab === "connection" ? "填写后台参数说明" : "填写检测人员需要看到的说明"} /></Field></div>
                  {item.fields.filter(field => field.key === "evidence").map(field => <details className="eg-evidence-details" key={field.key}><summary>配置依据<span>{config.values.evidence?.trim() ? "已填写" : tab === "connection" ? "可选，记录参数变更依据" : "发布前请填写已确认的规范或验证记录"}</span></summary><ValueField item={item} field={field} config={config} errors={fieldErrors} disabled={busy} onChange={value => change(item, { values: { ...config.values, [field.key]: value } })} /></details>)}
                  </fieldset>
                  {item.active && <div className="eg-active-summary"><Check size={15} aria-hidden="true" /><span>当前已发布：{summary(item, item.active)} {tab !== "connection" && <> · {item.active.model} / {item.active.market} · {item.active.enabled ? "启用" : "停用"}</>}</span></div>}
                  {saveError && <div className="eg-save-error" role="alert"><AlertCircle size={17} /><span>{saveError.message}</span><button type="button" disabled={!!busyId} onClick={() => setDialog({ kind: "reload", id: item.id })}>重新加载本项</button></div>}
                  <footer className="eg-editor-footer"><div><div className="eg-footer-status">状态：<Status item={item} dirty={dirty} />{item.updatedAt && <span>{item.updatedBy || "管理员"} · {dateLabel(item.updatedAt)}</span>}</div><p>{item.active ? "保存草稿不会改变当前已发布配置。" : "保存后保留草稿，确认后可单独发布本项。"}</p></div><div className="eg-form-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => discard(item)}>取消</Button>{item.draft && <Button type="button" variant="outline" disabled={!!busyId || dirty} title={dirty ? "请先保存本项修改" : "检查并发布已保存草稿"} onClick={() => startPublish(item)}>发布本项</Button>}<Button type="submit" disabled={!!busyId || (!dirty && !!item.draft)}>{busy ? <Loader2 size={16} className="eg-spin" /> : null}{busy ? "处理中…" : "保存本项草稿"}</Button></div></footer>
                </form>}
              </article>;
            })}
            {visibleItems.length > 0 && <div className="eg-list-footer">显示 {visibleItems.length} / {counts[currentCategory]} 项<span>{CATEGORY_LABEL[currentCategory]} · 每项独立配置</span></div>}
          </section><p className="eg-bottom-note"><CircleHelp size={16} aria-hidden="true" />每个配置项独立保存；本项的修改不会覆盖其他配置。</p></div>
        </>}
    <AlertDialog open={!!dialog} onOpenChange={open => { if (!open && !busyId) setDialog(null); }}><AlertDialogContent className="horizon-portal"><AlertDialogHeader><AlertDialogTitle>{dialog?.kind === "reload" ? "重新加载本项配置" : "发布本项配置"}</AlertDialogTitle><AlertDialogDescription>{dialog?.kind === "reload" ? "重新加载会舍弃本项尚未保存的修改，获取后台最新配置；其他项的修改会继续保留。" : dialogItem?.category === "connection" ? "发布本项后，后台汇总 12 项已发布参数生成完整版本，不会带入其他草稿。通信参数变化时，Windows 工位在同步后可能断开并重新连接。" : "发布会更新本项的后台已发布检测标准。当前 Windows 版本尚未接入完整质检规则与放行流程，这些标准不会被混入只读协议下载。"}</AlertDialogDescription></AlertDialogHeader>{dialogItem && <div className="eg-dialog-summary"><strong>{dialogItem.title}</strong><p>{dialog?.kind === "publish" ? dialogItem.category === "connection" ? "更新共享地址下的串口连接参数" : `${dialogItem.draft?.model} / ${dialogItem.draft?.market} · ${dialogItem.draft?.enabled ? "启用" : "停用"}` : "仅重新加载此项"}</p>{dialog?.kind === "publish" && <p>{summary(dialogItem, dialogItem.draft)}</p>}</div>}<AlertDialogFooter><AlertDialogCancel disabled={!!busyId}>取消</AlertDialogCancel><Button disabled={!!busyId} onClick={() => void confirmDialog()}>{busyId ? "处理中…" : dialog?.kind === "reload" ? "舍弃修改并重新加载" : "确认发布本项"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
