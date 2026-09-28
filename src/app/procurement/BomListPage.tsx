import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AlertCircle, ArrowLeft, ArrowUpRight, CheckCircle2, ChevronDown, ChevronRight, Cpu, FolderPlus, FolderTree, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { useI18n } from "../lib/i18n";
import { getBomTree, saveBomNode, deleteBomNode, listMaterials, type BomNode, type BomNodeInput, type Material } from "../lib/procurementApi";
import { routePath } from "../lib/routePaths";
import { useProcCan } from "./components/common";
import { StockPlanSelect } from "./components/StockPlanControls";
import { bomDevices, isBomMaterial } from "./bomModel";
import { BomRevisionControls } from "./components/BomRevisionControls";
import "./bom.css";

type Editor = { kind: BomNodeInput["kind"]; node?: BomNode; parentId: string; productLine: string };

export function BomListPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const can = useProcCan();
  const canEdit = can("material:import");
  const [roots, setRoots] = useState<BomNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deviceQuery, setDeviceQuery] = useState("");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<BomNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const request = useRef(0);
  const deletingRequest = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  const devices = useMemo(() => bomDevices(roots), [roots]);
  const selected = devices.find((item) => item.productLine === params.get("productLine")) ?? devices[0];
  const visibleDevices = devices.filter((device) => `${device.productLine} ${device.name}`.toLowerCase().includes(deviceQuery.toLowerCase().trim()));
  const load = useCallback(async (signal?: AbortSignal) => {
    const ticket = ++request.current;
    setLoading(true); setError("");
    try {
      const result = await getBomTree(signal);
      if (!signal?.aborted && ticket === request.current) setRoots(result.roots);
    } catch (cause) {
      if (!signal?.aborted && ticket === request.current) setError(cause instanceof Error ? cause.message : t("BOM 加载失败"));
    } finally {
      if (!signal?.aborted && ticket === request.current) setLoading(false);
    }
  }, [t]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const selectDevice = (productLine: string) => { setParams({ productLine }, { replace: true }); setQuery(""); setCollapsed(new Set()); };
  const add = (kind: Editor["kind"], parentId = selected?.root?.id || "") => setEditor({ kind, parentId: kind === "device" ? "" : parentId, productLine: kind === "device" ? "" : selected?.productLine || "" });
  const edit = (node: BomNode) => setEditor({ kind: isBomMaterial(node) ? "material" : node.id === selected?.root?.id ? "device" : "group", node, parentId: node.parentId || "", productLine: node.productLine });
  const confirmDelete = async () => {
    if (!deleting || deletingRequest.current) return;
    deletingRequest.current = true;
    setBusy(true); setDeleteError("");
    try { await deleteBomNode(deleting.id, deleting.updatedAt); if (!mounted.current) return; setDeleting(null); toast.success(t("已移除 BOM 项")); await load(); }
    catch (cause) { if (mounted.current) setDeleteError(cause instanceof Error ? cause.message : t("删除失败")); }
    finally { deletingRequest.current = false; if (mounted.current) setBusy(false); }
  };
  const actions = (node: BomNode) => canEdit && <div className="bom-row-actions">
    <Button variant="ghost" size="icon" aria-label={t("编辑 {name}", { name: node.material?.name || node.name })} onClick={() => edit(node)}><Pencil aria-hidden="true" className="size-4" /></Button>
    <Button variant="ghost" size="icon" disabled={node.children.length > 0} title={node.children.length ? t("请先移除子项") : t("删除")} aria-label={t("删除 {name}", { name: node.material?.name || node.name })} onClick={() => { setDeleteError(""); setDeleting(node); }}><Trash2 aria-hidden="true" className="size-4" /></Button>
  </div>;
  const needle = query.trim().toLowerCase();
  function matches(node: BomNode): boolean {
    return `${node.name} ${node.material?.name || ""} ${node.code || ""} ${node.material?.spec || ""} ${node.remark || ""}`.toLowerCase().includes(needle) || node.children.some(matches);
  }
  function renderRows(nodes: BomNode[], depth = 0, parentMatch = false): React.ReactNode {
    return nodes.filter((node) => !needle || parentMatch || matches(node)).map((node) => {
      const material = isBomMaterial(node);
      const expanded = Boolean(needle) || !collapsed.has(node.id);
      const ownMatch = Boolean(needle) && `${node.name} ${node.code || ""}`.toLowerCase().includes(needle);
      return <Fragment key={node.id}><tr className={material ? "bom-material-row" : "bom-group-row"}>
        <td style={{ paddingLeft: `${16 + Math.min(depth, 5) * 18}px` }}>
          {material ? <><span className="bom-material-name">{node.material?.name || node.name}</span><span className="bom-code">{node.code || t("缺少物料编码")}</span></> : <Button variant="unstyled" type="button" className="bom-group-toggle" aria-expanded={expanded} onClick={() => setCollapsed((old) => { const next = new Set(old); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; })}>{expanded ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}<FolderTree aria-hidden="true" className="size-4" />{node.name}<span className="bom-group-count">{node.children.length}</span></Button>}
        </td>
        <td>{material ? node.material?.spec || t("未填写") : t("组件分类")}</td>
        <td className="bom-number">{material ? node.qtyPer ?? t("待填写") : ""}</td>
        <td>{material ? node.material?.unit || t("未填写") : ""}</td>
        <td className="bom-note">{node.remark || ""}</td>
        <td>{material && (!node.material || !node.qtyPer || !node.code) ? <span className="bom-warning"><AlertCircle aria-hidden="true" className="size-3.5" />{t(!node.material ? "待关联物料库" : "待完善用量")}</span> : material ? <span className="bom-linked"><CheckCircle2 aria-hidden="true" className="size-3.5" />{t("已关联")}</span> : null}</td>
        {canEdit && <td><div className="bom-row-actions">{!material && <Button variant="ghost" size="icon" aria-label={t("向 {name} 添加物料", { name: node.name })} onClick={() => add("material", node.id)}><Plus aria-hidden="true" className="size-4" /></Button>}{actions(node)}</div></td>}
      </tr>{!material && expanded ? renderRows(node.children, depth + 1, parentMatch || ownMatch) : null}</Fragment>;
    });
  }
  const tableRoots = selected?.root ? selected.root.children : selected?.roots || [];
  const hasResults = tableRoots.some(matches);
  return <div className="proc-horizon bom-page">
    <div className="bom-toolbar"><Button variant="outline" onClick={() => navigate(routePath("page:proc-materials", "/proc-materials"))}><ArrowLeft aria-hidden="true" className="size-4" />{t("返回物料库")}</Button><p>{t("按设备维护物料构成和单机用量，用于库存齐套核算。")}</p><Button variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw aria-hidden="true" className="size-4" />{t("刷新")}</Button>{canEdit && <Button disabled={loading || Boolean(error)} onClick={() => add("device")}><Plus aria-hidden="true" className="size-4" />{t("新增设备")}</Button>}</div>
    {error ? <div role="alert" className="bom-error"><AlertCircle aria-hidden="true" className="size-5" /><span>{error}</span><Button variant="outline" onClick={() => void load()}>{t("重试")}</Button></div> : loading ? <div className="bom-loading" role="status">{t("正在加载设备与 BOM 清单…")}</div> : <div className="bom-workspace">
      <aside className="bom-device-panel" aria-label={t("设备列表")}><div className="bom-rail-heading"><h2>{t("设备列表")}</h2><span>{devices.length}</span></div><div className="bom-search"><Search aria-hidden="true" className="size-4" /><Input aria-label={t("搜索设备")} placeholder={t("搜索设备名称或型号")} value={deviceQuery} onChange={(event) => setDeviceQuery(event.target.value)} /></div><div className="bom-device-list">{visibleDevices.map((device) => <Button variant="unstyled" key={device.productLine} className="bom-device" type="button" aria-pressed={selected?.productLine === device.productLine} onClick={() => selectDevice(device.productLine)}><Cpu aria-hidden="true" className="size-5" /><span><strong>{device.productLine}</strong>{device.name !== device.productLine && <span>{device.name}</span>}<small>{t("{count} 项物料", { count: device.materials.length })}{(!device.materials.length || device.incomplete > 0) && <em>{t("待完善")}</em>}</small></span><ChevronRight aria-hidden="true" className="size-4" /></Button>)}{!visibleDevices.length && <p className="bom-rail-empty">{t(devices.length ? "没有匹配的设备" : "尚未添加设备")}</p>}</div></aside>
      <section className="bom-main" aria-label={t("设备 BOM 清单")}>{selected ? <>
        <header className="bom-main-heading"><div><span className="bom-eyebrow">{t("设备 BOM")}</span><h1>{selected.productLine}<span>{selected.name !== selected.productLine ? selected.name : t("物料清单")}</span></h1><p>{t("{count} 项物料", { count: selected.materials.length })}<span>·</span>{t("单机用量 × 生产数量 = 物料需求量")}</p></div>{can("page:proc-inventory-readiness") && <Button variant="outline" onClick={() => navigate(`${routePath("page:proc-inventory-readiness", "/proc-inventory-readiness")}?${new URLSearchParams({ productLine: selected.productLine })}`)}>{t("查看库存齐套")}<ArrowUpRight aria-hidden="true" className="size-4" /></Button>}</header>
        {selected.root ? <BomRevisionControls key={selected.root.id} deviceId={selected.root.id} canPublish={can("bom:publish")} /> : <p className="bom-quality-note">{t("请先整理为唯一设备根节点，再确认归属与发布。")}</p>}
        {selected.incomplete > 0 && <div role="status" className="bom-quality-note"><AlertCircle aria-hidden="true" className="size-4" />{t("{count} 项物料待完善，请关联物料库并填写用量后再用于齐套核算。", { count: selected.incomplete })}</div>}
        <div className="bom-table-toolbar"><div className="bom-search"><Search aria-hidden="true" className="size-4" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("搜索物料名称、编码、规格或分类")} aria-label={t("搜索 BOM 物料")} /></div>{canEdit && <div className="bom-main-actions">{selected.root && actions(selected.root)}<Button variant="outline" onClick={() => add("group")}><FolderPlus aria-hidden="true" className="size-4" />{t("新增分类")}</Button><Button onClick={() => add("material")}><Plus aria-hidden="true" className="size-4" />{t("添加物料")}</Button></div>}</div>
        {tableRoots.length ? <div className="bom-table-scroll" tabIndex={0} role="region" aria-label={t("BOM 结构明细")}><table className="bom-table"><thead><tr>{["物料名称 / 编码", "材质 / 型号", "单机用量", "单位", "备注", "关联状态", ...(canEdit ? ["操作"] : [])].map((label) => <th key={label} scope="col">{t(label)}</th>)}</tr></thead><tbody>{renderRows(tableRoots)}{needle && !hasResults && <tr><td colSpan={canEdit ? 7 : 6} className="bom-empty-cell">{t("没有匹配的 BOM 物料")}</td></tr>}</tbody></table></div> : <div className="bom-empty"><FolderTree aria-hidden="true" className="size-9" /><h2>{t("BOM 待完善")}</h2><p>{t("从物料库添加该设备需要的物料，并填写每台设备的用量。")}</p>{canEdit && <Button onClick={() => add("material")}>{t("添加第一项物料")}</Button>}</div>}
        <footer className="bom-footer">{t("名称、规格和单位来自物料库；保存仅更新工作稿，正式计划引用已发布快照。")}</footer>
      </> : <div className="bom-empty"><Cpu aria-hidden="true" className="size-9" /><h1>{t("为设备建立第一份 BOM")}</h1><p>{t("先添加设备，再配置它的组件分类与物料用量。")}</p>{canEdit && <Button onClick={() => add("device")}>{t("新增设备")}</Button>}</div>}</section>
    </div>}
    {editor && <BomEditor editor={editor} nodes={selected?.nodes || []} onClose={() => setEditor(null)} onSaved={async (line) => { setEditor(null); selectDevice(line); toast.success(t("BOM 已保存")); await load(); }} />}
    <Dialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !busy) setDeleting(null); }}><DialogContent closeDisabled={busy} className="horizon-theme horizon-portal"><DialogHeader><DialogTitle>{t("移除 BOM 项")}</DialogTitle><DialogDescription>{t("确认从 BOM 中移除「{name}」？物料库中的原始物料会保留，齐套核算将采用更新后的清单。", { name: deleting?.material?.name || deleting?.name || "" })}</DialogDescription></DialogHeader>{deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>{t("取消")}</Button><Button variant="destructive" disabled={busy} onClick={() => void confirmDelete()}>{t(busy ? "正在移除…" : "确认移除")}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function BomEditor({ editor, nodes, onClose, onSaved }: { editor: Editor; nodes: BomNode[]; onClose: () => void; onSaved: (productLine: string) => Promise<void> }) {
  const { t } = useI18n();
  const [name, setName] = useState(editor.node?.name || "");
  const [productLine, setProductLine] = useState(editor.productLine);
  const [parentId, setParentId] = useState(editor.parentId);
  const [materialId, setMaterialId] = useState(editor.node?.material?.id || "");
  const [qty, setQty] = useState(String(editor.node?.qtyPer ?? 1));
  const [remark, setRemark] = useState(editor.node?.remark || "");
  const [sortOrder, setSortOrder] = useState(String(editor.node?.sortOrder ?? Math.max(-1, ...nodes.filter((node) => node.parentId === (editor.parentId || null)).map((node) => node.sortOrder)) + (editor.node ? 0 : 1)));
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialLoading, setMaterialLoading] = useState(editor.kind === "material");
  const [materialError, setMaterialError] = useState("");
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const close = () => { if (!submitting.current) onClose(); };
  useEffect(() => {
    if (editor.kind !== "material") return;
    const controller = new AbortController();
    setMaterialLoading(true); setMaterialError("");
    void listMaterials(controller.signal).then((items) => { if (!controller.signal.aborted) setMaterials(items); }).catch((cause) => { if (!controller.signal.aborted) setMaterialError(cause instanceof Error ? cause.message : t("物料库加载失败")); }).finally(() => { if (!controller.signal.aborted) setMaterialLoading(false); });
    return () => controller.abort();
  }, [editor.kind, retry, t]);
  const material = materials.find((item) => item.id === materialId);
  const groups = nodes.filter((node) => !isBomMaterial(node) && node.id !== editor.node?.id);
  const hasDeviceRoot = nodes.filter((node) => !node.parentId && !isBomMaterial(node)).length === 1;
  const title = editor.node ? t(editor.kind === "material" ? "编辑 BOM 物料" : editor.kind === "device" ? "编辑设备" : "编辑分类") : t(editor.kind === "material" ? "添加 BOM 物料" : editor.kind === "device" ? "新增设备" : "新增分类");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    if (materialLoading || materialError) return;
    if (editor.kind === "material" && (!material || !material.tpInventoryCode)) { setError(t("请选择具有库存编码的物料库物料")); return; }
    if (editor.kind === "material" && (!/^(?:\d+(?:\.\d{0,4})?|\.\d{1,4})$/.test(qty.trim()) || Number(qty) <= 0 || Number(qty) > 9999999999.9999)) { setError(t("单机用量须大于 0、不超过 9999999999.9999，最多四位小数")); return; }
    submitting.current = true; setBusy(true); setError("");
    try {
      await saveBomNode({ kind: editor.kind, productLine: productLine.trim(), name: name.trim(), parentId: parentId || null,
        ...(editor.kind === "material" ? { materialId, qtyPer: Number(qty) } : {}), remark, sortOrder: Number(sortOrder), baseUpdatedAt: editor.node?.updatedAt }, editor.node?.id);
      if (mounted.current) await onSaved(productLine.trim());
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : t("保存失败")); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent closeDisabled={busy} className="horizon-theme horizon-portal sm:max-w-xl"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{t(editor.kind === "device" ? "每个设备拥有独立 BOM，型号同时用于库存齐套中心的产品选择。" : "物料信息来自物料库，单机用量表示每台设备需要的数量。")}</DialogDescription></DialogHeader>
    <form className="bom-form" onSubmit={(event) => void submit(event)}><fieldset disabled={busy}>
      {editor.kind === "device" ? <><label>{t("设备型号")}<Input required maxLength={50} disabled={Boolean(editor.node)} value={productLine} placeholder={t("例如 Q8")} onChange={(event) => setProductLine(event.target.value)} /></label><label>{t("设备名称")}<Input required maxLength={200} value={name} placeholder={t("输入设备名称")} onChange={(event) => setName(event.target.value)} /></label></> : <>
        <p className="bom-form-device">{t("所属设备")} <strong>{productLine}</strong></p>
        <label>{t("所属分类")}<StockPlanSelect label={t("所属分类")} value={parentId} onValueChange={setParentId} options={groups.map((node) => ({ value: node.id, label: node.name }))} required={hasDeviceRoot} emptyLabel={hasDeviceRoot ? undefined : t("设备直属物料 / 分类")} disabled={busy || Boolean(editor.node?.children.length)} searchable /></label>
        {editor.kind === "group" ? <label>{t("分类名称")}<Input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></label> : <>
          <label>{t("物料库物料")}<StockPlanSelect label={t("物料库物料")} value={materialId} onValueChange={setMaterialId} options={materials.filter((item) => item.tpInventoryCode).map((item) => ({ value: item.id, label: `${item.tpInventoryCode} · ${item.name}${item.spec ? ` · ${item.spec}` : ""}` }))} emptyLabel={t(materialLoading ? "正在加载物料库…" : "搜索并选择已有物料")} disabled={busy || materialLoading || Boolean(materialError)} searchable /></label>
          {materialError && <div role="alert" className="bom-warning">{materialError}<Button type="button" variant="outline" onClick={() => setRetry((value) => value + 1)}>{t("重试")}</Button></div>}
          <p className="bom-form-help">{t("仅可选择物料库中有库存编码的物料；缺少物料时，请先在物料库建立档案。")}</p>
          {material && <div className="bom-material-preview"><span>{t("材质 / 型号")}<strong>{material.spec || t("未填写")}</strong></span><span>{t("单位")}<strong>{material.unit || t("未填写")}</strong></span></div>}
          <label>{t("单机用量")}<Input required type="number" min="0.0001" max="9999999999.9999" step="0.0001" value={qty} onChange={(event) => setQty(event.target.value)} /></label>
        </>}
      </>}
      <div className="bom-form-bottom"><label>{t("排序")}<Input required type="number" min={0} max={999999} step={1} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} /></label><label>{t("备注")}<Input maxLength={1000} value={remark} onChange={(event) => setRemark(event.target.value)} /></label></div>
    </fieldset>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>{t("取消")}</Button><Button type="submit" disabled={busy || materialLoading || Boolean(materialError)}>{t(busy ? "正在保存…" : "保存")}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
