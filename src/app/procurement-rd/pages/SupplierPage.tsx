// 基础数据 · 供应商档案（可维护）：列表 + KPI + 新增/编辑 + 删除 + 详情抽屉（含关联报价/合同）。
import { useEffect, useState } from "react";
import { BadgeCheck, Building2, Pencil, Plus, ShieldCheck, Star, Trash2, Upload, Users, X } from "lucide-react";
import { cn } from "../../components/ui/utils";
import { procActions, useProc } from "../store";
import type { Supplier } from "../data/types";
import { DemoControls, ImportModal, PageHeader, Pager, PersonAvatar, StatCard, fmtMoney } from "../components/common";

const PAGE_SIZE = 8;
const SUPPLIER_IMPORT_COLUMNS = ["供应商名称", "供货类别", "联系人", "联系电话", "地址", "评级", "资质有效期", "合作年限", "状态", "主要供货物料", "备注"];
const SAMPLE_SUPPLIER_ROWS: Supplier[] = [
  { id: "", name: "杭州精工", category: "金属结构件", contact: "何静", phone: "138-0000-2001", address: "浙江省杭州市余杭区", rating: 4, certExpiry: "2027-07-31", cooperationYears: 2, status: "active", materials: ["无油活塞环"], note: "示例导入数据" },
  { id: "", name: "南京密封", category: "橡胶 / 密封件", contact: "许伟", phone: "138-0000-2002", address: "江苏省南京市江宁区", rating: 3, certExpiry: "2026-12-31", cooperationYears: 1, status: "review", materials: ["密封圈"], note: "示例导入数据" },
];
const STATUS_FROM_TEXT = (t: string): Supplier["status"] => (t.includes("停") ? "disabled" : t.includes("评") ? "review" : "active");

const STATUS_META: Record<Supplier["status"], { label: string; cls: string }> = {
  active: { label: "启用", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  review: { label: "待评估", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  disabled: { label: "停用", cls: "border-slate-200 bg-slate-50 text-slate-500" },
};

function Rating({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("h-3.5 w-3.5", i <= value ? "fill-amber-400 text-amber-400" : "text-slate-200")} />
      ))}
    </span>
  );
}

const EMPTY: Supplier = { id: "", name: "", category: "", contact: "", phone: "", address: "", rating: 4, certExpiry: "2027-12-31", cooperationYears: 1, status: "active", materials: [], note: "" };

export function SupplierPage() {
  const { suppliers, requirements, contracts } = useProc();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(1);

  const detail = suppliers.find((s) => s.id === detailId) ?? null;
  const paged = suppliers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => {
    if ((page - 1) * PAGE_SIZE >= suppliers.length && page > 1) setPage(1);
  }, [suppliers.length, page]);

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4">
      <DemoControls />
      <PageHeader
        Icon={Building2}
        badge="Supplier Master · 基础数据"
        title="供应商档案"
        description="采购询价 / 报价 / 合同引用的供应商主数据，支持新增、编辑、导入、停用与资质到期管理。"
        right={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setImporting(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm">
              <Upload className="h-4 w-4" />
              导入
            </button>
            <button type="button" onClick={() => setEditing({ ...EMPTY })} className="material-button-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm">
              <Plus className="h-4 w-4" />
              新增供应商
            </button>
          </div>
        }
      />

      <div className="mb-3 grid grid-cols-4 gap-3">
        <StatCard label="供应商总数" value={suppliers.length} hint="全部在册供应商" Icon={Users} />
        <StatCard label="启用中" value={suppliers.filter((s) => s.status === "active").length} tone="emerald" Icon={BadgeCheck} />
        <StatCard label="待评估" value={suppliers.filter((s) => s.status === "review").length} tone="amber" hint="含资质临近到期" Icon={ShieldCheck} />
        <StatCard label="平均评级" value={(suppliers.reduce((a, s) => a + s.rating, 0) / (suppliers.length || 1)).toFixed(1)} tone="indigo" Icon={Star} />
      </div>

      <div className="material-card overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1.4fr)_1.2fr_1fr_120px_minmax(0,1.6fr)_110px_80px_90px] gap-3 bg-slate-50/60 px-5 py-2 text-xs font-medium text-slate-400">
          <span>供应商</span>
          <span>供货类别</span>
          <span>联系人</span>
          <span>评级</span>
          <span>主要供货物料</span>
          <span>资质有效期</span>
          <span>状态</span>
          <span>操作</span>
        </div>
        <div className="divide-y divide-slate-100">
          {paged.map((s) => (
            <div key={s.id} onClick={() => setDetailId(s.id)} className="grid cursor-pointer grid-cols-[minmax(0,1.4fr)_1.2fr_1fr_120px_minmax(0,1.6fr)_110px_80px_90px] items-center gap-3 px-5 py-3 text-sm transition hover:bg-slate-50/70">
              <span className="flex items-center gap-2 font-medium text-slate-800">
                <PersonAvatar name={s.name} />
                {s.name}
              </span>
              <span className="text-slate-600">{s.category}</span>
              <span className="text-slate-600">{s.contact}</span>
              <Rating value={s.rating} />
              <span className="flex flex-wrap gap-1">
                {s.materials.slice(0, 3).map((m) => (
                  <span key={m} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{m}</span>
                ))}
              </span>
              <span className="tabular-nums text-slate-500">{s.certExpiry}</span>
              <span>
                <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_META[s.status].cls)}>{STATUS_META[s.status].label}</span>
              </span>
              <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                <button type="button" onClick={() => setEditing({ ...s })} className="rounded p-1 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600" title="编辑">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => procActions.deleteSupplier(s.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="删除">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          ))}
        </div>
        <Pager page={page} pageSize={PAGE_SIZE} total={suppliers.length} onPage={setPage} />
      </div>

      {detail && <SupplierDetail supplier={detail} requirements={requirements} contracts={contracts} onClose={() => setDetailId(null)} onEdit={() => setEditing({ ...detail })} />}
      {editing && <SupplierForm initial={editing} onClose={() => setEditing(null)} />}
      {importing && (
        <ImportModal
          title="供应商"
          templateColumns={SUPPLIER_IMPORT_COLUMNS}
          onClose={() => setImporting(false)}
          onSample={() => procActions.importSuppliers(SAMPLE_SUPPLIER_ROWS)}
          onImport={(rows) =>
            procActions.importSuppliers(
              rows
                .filter((r) => (r["供应商名称"] ?? "").trim())
                .map((r) => ({
                  id: "",
                  name: r["供应商名称"] ?? "",
                  category: r["供货类别"] ?? "",
                  contact: r["联系人"] ?? "",
                  phone: r["联系电话"] ?? "",
                  address: r["地址"] ?? "",
                  rating: Number(r["评级"]) || 3,
                  certExpiry: r["资质有效期"] || "2027-12-31",
                  cooperationYears: Number(r["合作年限"]) || 1,
                  status: STATUS_FROM_TEXT(r["状态"] ?? ""),
                  materials: (r["主要供货物料"] ?? "").split(/[、,，]/).map((x) => x.trim()).filter(Boolean),
                  note: r["备注"] || undefined,
                })),
            )
          }
        />
      )}
    </div>
  );
}

function SupplierDetail({ supplier, requirements, contracts, onClose, onEdit }: { supplier: Supplier; requirements: ReturnType<typeof useProc>["requirements"]; contracts: ReturnType<typeof useProc>["contracts"]; onClose: () => void; onEdit: () => void }) {
  const relatedQuotes = requirements.flatMap((r) => r.quotes.filter((q) => q.supplier === supplier.name).map((q) => ({ req: r, q })));
  const relatedContracts = contracts.filter((c) => c.supplier === supplier.name);
  const info: Array<[string, React.ReactNode]> = [
    ["供货类别", supplier.category],
    ["联系人", supplier.contact],
    ["联系电话", supplier.phone],
    ["地址", supplier.address],
    ["资质有效期", supplier.certExpiry],
    ["合作年限", `${supplier.cooperationYears} 年`],
  ];
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/30" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex h-full w-[640px] flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <PersonAvatar name={supplier.name} size="md" />
            <div>
              <h3 className="text-lg font-bold text-slate-900">{supplier.name}</h3>
              <div className="mt-0.5 flex items-center gap-2 text-sm">
                <Rating value={supplier.rating} />
                <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_META[supplier.status].cls)}>{STATUS_META[supplier.status].label}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onEdit} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">编辑</button>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="mb-1 text-sm font-semibold text-slate-700">基本信息</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {info.map(([k, v]) => (
                <div key={k} className="flex gap-2 py-0.5 text-sm">
                  <span className="w-20 shrink-0 text-slate-400">{k}</span>
                  <span className="text-slate-700">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {supplier.materials.map((m) => (
                <span key={m} className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-600">{m}</span>
              ))}
            </div>
            {supplier.note && <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">{supplier.note}</div>}
          </div>

          <div className="rounded-xl border border-slate-100 p-4">
            <div className="mb-2 text-sm font-semibold text-slate-700">关联报价（{relatedQuotes.length}）</div>
            {relatedQuotes.length === 0 ? (
              <div className="text-xs text-slate-400">暂无报价记录</div>
            ) : (
              <ul className="space-y-1.5">
                {relatedQuotes.map(({ req, q }) => (
                  <li key={q.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{req.materialName}</span>
                    <span className="tabular-nums text-slate-500">{fmtMoney(q.unitPrice)} · 交期{q.leadDays}天{q.selected ? " · 已选定" : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-slate-100 p-4">
            <div className="mb-2 text-sm font-semibold text-slate-700">关联合同（{relatedContracts.length}）</div>
            {relatedContracts.length === 0 ? (
              <div className="text-xs text-slate-400">暂无合同记录</div>
            ) : (
              <ul className="space-y-1.5">
                {relatedContracts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{c.code} · {c.materialName}</span>
                    <span className="tabular-nums text-slate-500">{fmtMoney(c.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SupplierForm({ initial, onClose }: { initial: Supplier; onClose: () => void }) {
  const [f, setF] = useState<Supplier>({ ...initial, materials: [...initial.materials] });
  const [materialsText, setMaterialsText] = useState(initial.materials.join("、"));
  const isNew = !initial.id;
  const set = <K extends keyof Supplier>(k: K, v: Supplier[K]) => setF((p) => ({ ...p, [k]: v }));

  const save = () => {
    if (!f.name.trim()) return;
    procActions.upsertSupplier({ ...f, materials: materialsText.split(/[、,，]/).map((x) => x.trim()).filter(Boolean) });
    onClose();
  };
  const text = (k: keyof Supplier, label: string, ph = "") => (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input value={String(f[k] ?? "")} onChange={(e) => set(k, e.target.value as never)} placeholder={ph} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
    </label>
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-bold text-slate-900">{isNew ? "新增供应商" : `编辑供应商 · ${initial.name}`}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid max-h-[70vh] grid-cols-2 gap-3 overflow-y-auto px-6 py-4">
          {text("name", "供应商名称")}
          {text("category", "供货类别")}
          {text("contact", "联系人")}
          {text("phone", "联系电话")}
          <label className="col-span-2 block">
            <span className="text-xs font-medium text-slate-500">地址</span>
            <input value={f.address} onChange={(e) => set("address", e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">评级</span>
            <select value={f.rating} onChange={(e) => set("rating", Number(e.target.value))} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} 星</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">状态</span>
            <select value={f.status} onChange={(e) => set("status", e.target.value as Supplier["status"])} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">
              <option value="active">启用</option>
              <option value="review">待评估</option>
              <option value="disabled">停用</option>
            </select>
          </label>
          {text("certExpiry", "资质有效期")}
          <label className="block">
            <span className="text-xs font-medium text-slate-500">合作年限</span>
            <input value={f.cooperationYears} onChange={(e) => set("cooperationYears", Number(e.target.value) || 0)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
          </label>
          <label className="col-span-2 block">
            <span className="text-xs font-medium text-slate-500">主要供货物料（顿号/逗号分隔）</span>
            <input value={materialsText} onChange={(e) => setMaterialsText(e.target.value)} placeholder="如 减震垫 DZ-950、硅胶管 φ6" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
          </label>
          <label className="col-span-2 block">
            <span className="text-xs font-medium text-slate-500">备注</span>
            <textarea value={f.note} onChange={(e) => set("note", e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
          <button type="button" onClick={save} className="material-button-primary px-4 py-2 text-sm">{isNew ? "创建" : "保存"}</button>
        </div>
      </div>
    </div>
  );
}
