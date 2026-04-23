import React, { useEffect, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Dialog, DialogActions, DialogContent, DialogTitle, FormControl, MenuItem, Select, SelectChangeEvent } from "@mui/material";
import { toast } from "sonner";

import { cn } from "./components/ui/utils";
import {
  DictionaryType,
  EmailDictionaryItem,
  GenericDictionaryItem,
  dictionaryApi,
} from "./lib/dictionaryApi";

const PAGE_SIZE = 5;

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

type DialogMode =
  | "add-type"
  | "edit-type"
  | "delete-type"
  | "add-email"
  | "edit-email"
  | "add-generic"
  | "edit-generic"
  | "delete-row"
  | null;

export function DictionaryList() {
  const [dictTypes, setDictTypes] = useState<DictionaryType[]>([]);
  const [activeTypeId, setActiveTypeId] = useState("");
  const [items, setItems] = useState<(EmailDictionaryItem | GenericDictionaryItem)[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [operators, setOperators] = useState<string[]>([]);
  const [showPwd, setShowPwd] = useState<Record<string, boolean>>({});

  const [loadingTypes, setLoadingTypes] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [savingType, setSavingType] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [deletingType, setDeletingType] = useState(false);
  const [deletingItem, setDeletingItem] = useState(false);

  const [keyword, setKeyword] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [jumpInput, setJumpInput] = useState("");

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [editTypeId, setEditTypeId] = useState<string | null>(null);
  const [editEmailId, setEditEmailId] = useState<string | null>(null);
  const [editGenericId, setEditGenericId] = useState<string | null>(null);
  const [deleteTypeId, setDeleteTypeId] = useState<string | null>(null);
  const [deleteRowId, setDeleteRowId] = useState<string | null>(null);

  const [fTypeLabel, setFTypeLabel] = useState("");
  const [fAccount, setFAccount] = useState("");
  const [fPassword, setFPassword] = useState("");
  const [fCode, setFCode] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [fRemark, setFRemark] = useState("");

  const activeType = dictTypes.find((item) => item.id === activeTypeId) ?? null;
  const emailRows = (items as EmailDictionaryItem[]) ?? [];
  const genericRows = (items as GenericDictionaryItem[]) ?? [];

  async function loadTypes(preferredTypeId?: string | null) {
    setLoadingTypes(true);
    try {
      const response = await dictionaryApi.listTypes();
      setDictTypes(response);
      setActiveTypeId((current) => {
        if (preferredTypeId && response.some((item) => item.id === preferredTypeId)) {
          return preferredTypeId;
        }
        if (current && response.some((item) => item.id === current)) {
          return current;
        }
        return response[0]?.id ?? "";
      });
      if (!response.length) {
        setItems([]);
        setTotal(0);
        setTotalPages(1);
        setOperators([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取字典类型失败");
    } finally {
      setLoadingTypes(false);
    }
  }

  async function loadItems(targetTypeId = activeTypeId, targetPage = page) {
    if (!targetTypeId) {
      setItems([]);
      setTotal(0);
      setTotalPages(1);
      setOperators([]);
      return;
    }

    setLoadingItems(true);
    try {
      const response = await dictionaryApi.listItems(targetTypeId, {
        page: targetPage,
        pageSize: PAGE_SIZE,
        keyword,
        operator: operatorFilter,
      });
      setItems(response.items);
      setTotal(response.total);
      setTotalPages(response.total_pages);
      setOperators(response.operators);
      if (targetPage > response.total_pages) {
        setPage(response.total_pages);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取字典条目失败");
    } finally {
      setLoadingItems(false);
    }
  }

  useEffect(() => {
    void loadTypes();
  }, []);

  useEffect(() => {
    setKeyword("");
    setOperatorFilter("ALL");
    setPage(1);
    setJumpInput("");
    setShowPwd({});
  }, [activeTypeId]);

  useEffect(() => {
    setPage(1);
  }, [keyword, operatorFilter]);

  useEffect(() => {
    void loadItems();
  }, [activeTypeId, page, keyword, operatorFilter]);

  function closeDialog() {
    setDialogMode(null);
  }

  function openAddType() {
    setFTypeLabel("");
    setEditTypeId(null);
    setDialogMode("add-type");
  }

  function openEditType(type: DictionaryType, event: React.MouseEvent) {
    event.stopPropagation();
    setEditTypeId(type.id);
    setFTypeLabel(type.label);
    setDialogMode("edit-type");
  }

  function openDeleteType(typeId: string, event: React.MouseEvent) {
    event.stopPropagation();
    setDeleteTypeId(typeId);
    setDialogMode("delete-type");
  }

  async function submitType() {
    const label = fTypeLabel.trim();
    if (!label) return;

    setSavingType(true);
    try {
      const saved = await dictionaryApi.saveType({
        id: editTypeId ?? undefined,
        label,
      });
      toast.success(editTypeId ? "字典类型已更新" : "字典类型已新增");
      closeDialog();
      await loadTypes(saved.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存字典类型失败");
    } finally {
      setSavingType(false);
    }
  }

  async function confirmDeleteType() {
    if (!deleteTypeId) return;

    const currentIndex = dictTypes.findIndex((item) => item.id === deleteTypeId);
    const fallbackTypeId =
      dictTypes[currentIndex + 1]?.id ??
      dictTypes[currentIndex - 1]?.id ??
      "";

    setDeletingType(true);
    try {
      await dictionaryApi.deleteType(deleteTypeId);
      toast.success("字典类型已删除");
      closeDialog();
      await loadTypes(fallbackTypeId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除字典类型失败");
    } finally {
      setDeletingType(false);
    }
  }

  function openAddEmail() {
    setFAccount("");
    setFPassword("");
    setEditEmailId(null);
    setDialogMode("add-email");
  }

  function openEditEmail(row: EmailDictionaryItem) {
    setFAccount(row.account);
    setFPassword(row.password);
    setEditEmailId(row.id);
    setDialogMode("edit-email");
  }

  function openAddGeneric() {
    setFCode("");
    setFLabel("");
    setFRemark("");
    setEditGenericId(null);
    setDialogMode("add-generic");
  }

  function openEditGeneric(row: GenericDictionaryItem) {
    setFCode(row.code);
    setFLabel(row.label);
    setFRemark(row.remark);
    setEditGenericId(row.id);
    setDialogMode("edit-generic");
  }

  function openDeleteRow(itemId: string) {
    setDeleteRowId(itemId);
    setDialogMode("delete-row");
  }

  async function submitEmail() {
    if (!activeTypeId) return;

    setSavingItem(true);
    try {
      await dictionaryApi.saveItem(activeTypeId, {
        id: editEmailId ?? undefined,
        account: fAccount.trim(),
        password: fPassword,
      });
      toast.success(editEmailId ? "邮箱账号已更新" : "邮箱账号已新增");
      closeDialog();
      if (page !== 1) {
        setPage(1);
      } else {
        await loadItems(activeTypeId, 1);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存邮箱账号失败");
    } finally {
      setSavingItem(false);
    }
  }

  async function submitGeneric() {
    if (!activeTypeId) return;

    setSavingItem(true);
    try {
      await dictionaryApi.saveItem(activeTypeId, {
        id: editGenericId ?? undefined,
        code: fCode.trim(),
        label: fLabel.trim(),
        remark: fRemark.trim(),
      });
      toast.success(editGenericId ? "字典条目已更新" : "字典条目已新增");
      closeDialog();
      if (page !== 1) {
        setPage(1);
      } else {
        await loadItems(activeTypeId, 1);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存字典条目失败");
    } finally {
      setSavingItem(false);
    }
  }

  async function confirmDeleteRow() {
    if (!deleteRowId) return;

    setDeletingItem(true);
    try {
      await dictionaryApi.deleteItem(deleteRowId);
      toast.success("已删除");
      closeDialog();
      await loadItems();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除字典条目失败");
    } finally {
      setDeletingItem(false);
    }
  }

  function handleJump() {
    const value = Number.parseInt(jumpInput, 10);
    if (Number.isNaN(value)) {
      setJumpInput("");
      return;
    }
    setPage(Math.min(totalPages, Math.max(1, value)));
    setJumpInput("");
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-blue-50 text-blue-700">Data Dictionary</span>
        <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">字典列表</h2>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">维护系统全局枚举字典，左侧选择字典类型，右侧管理对应条目。</p>
      </section>

      <section className="grid grid-cols-[220px_minmax(0,1fr)] gap-6">
        <div className="material-card overflow-hidden">
          <div className="px-3 py-3">
            <button
              type="button"
              className="material-button-secondary w-full justify-center gap-1.5"
              onClick={openAddType}
              disabled={savingType}
            >
              <Plus className="h-3.5 w-3.5" />
              新增类型
            </button>
          </div>
          <div className="py-1">
            {loadingTypes && !dictTypes.length ? (
              <div className="px-3 py-6 text-center text-sm text-slate-400">正在加载类型...</div>
            ) : dictTypes.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-slate-400">暂无字典类型</div>
            ) : (
              dictTypes.map((type) => (
                <div
                  key={type.id}
                  className={cn(
                    "group mx-2 flex cursor-pointer items-center justify-between rounded-2xl border px-3 py-2.5 text-sm transition-colors",
                    activeTypeId === type.id
                      ? "border-blue-100 bg-[linear-gradient(135deg,#edf4ff_0%,#e1efff_72%,#eefaf8_100%)] font-semibold text-primary shadow-[0_14px_28px_rgba(25,118,210,0.14)]"
                      : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/85",
                  )}
                  onClick={() => setActiveTypeId(type.id)}
                >
                  <span className="truncate">{type.label}</span>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-slate-200/70"
                      onClick={(event) => openEditType(type, event)}
                    >
                      <Pencil className="h-3 w-3 text-slate-500" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-red-100"
                      onClick={(event) => openDeleteType(type.id, event)}
                    >
                      <Trash2 className="h-3 w-3 text-red-400" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="material-card p-6">
          <div className="mb-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-slate-900">{activeType?.label ?? "请选择字典类型"}</h3>
              <button
                className="material-button-primary"
                disabled={!activeType}
                onClick={() => {
                  if (!activeType) return;
                  if (activeType.kind === "email") {
                    openAddEmail();
                    return;
                  }
                  openAddGeneric();
                }}
              >
                <Plus className="h-4 w-4" />
                新增
              </button>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="material-input pl-11"
                  placeholder={activeType?.kind === "email" ? "搜索账号、操作人..." : "搜索编码、标签、备注..."}
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  disabled={!activeType}
                />
              </div>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <Select
                  value={operatorFilter}
                  onChange={(event: SelectChangeEvent) => setOperatorFilter(event.target.value)}
                  displayEmpty
                  disabled={!activeType}
                >
                  <MenuItem value="ALL">全部操作人</MenuItem>
                  {operators.map((operator) => (
                    <MenuItem key={operator} value={operator}>
                      {operator}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </div>
          </div>

          {!activeType ? (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-16 text-center text-sm text-slate-400">
              先在左侧创建一个字典类型，再维护条目。
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                {activeType.kind === "email" ? (
                  <table className="min-w-full text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        {["账号", "密码", "操作时间", "操作人", "操作"].map((header) => (
                          <th key={header} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loadingItems ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                            正在加载数据...
                          </td>
                        </tr>
                      ) : emailRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                            暂无数据
                          </td>
                        </tr>
                      ) : (
                        emailRows.map((row) => (
                          <tr key={row.id} className="hover:bg-slate-50/70">
                            <td className="px-4 py-3 text-sm text-slate-800">{row.account}</td>
                            <td className="px-4 py-3 text-sm text-slate-700">
                              <span className="font-mono">{showPwd[row.id] ? row.password : "••••••••"}</span>
                              <button
                                type="button"
                                className="ml-2 text-xs text-slate-400 hover:text-slate-600"
                                onClick={() => setShowPwd((current) => ({ ...current, [row.id]: !current[row.id] }))}
                              >
                                {showPwd[row.id] ? "隐藏" : "显示"}
                              </button>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-500">{formatDate(row.updated_at)}</td>
                            <td className="px-4 py-3 text-sm text-slate-700">{row.updated_by}</td>
                            <td className="px-4 py-3 text-sm">
                              <div className="flex gap-2">
                                <button className="material-button-secondary !px-3 !py-2" onClick={() => openEditEmail(row)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  className="material-button-secondary !px-3 !py-2 text-red-500 hover:border-red-200 hover:bg-red-50"
                                  onClick={() => openDeleteRow(row.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                ) : (
                  <table className="min-w-full text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        {["编码", "标签", "备注", "操作时间", "操作人", "操作"].map((header) => (
                          <th key={header} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loadingItems ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                            正在加载数据...
                          </td>
                        </tr>
                      ) : genericRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                            暂无数据
                          </td>
                        </tr>
                      ) : (
                        genericRows.map((row) => (
                          <tr key={row.id} className="hover:bg-slate-50/70">
                            <td className="px-4 py-3 text-xs font-mono text-slate-500">{row.code}</td>
                            <td className="px-4 py-3 text-sm font-medium text-slate-800">{row.label}</td>
                            <td className="px-4 py-3 text-sm text-slate-500">{row.remark || "—"}</td>
                            <td className="px-4 py-3 text-sm text-slate-500">{formatDate(row.updated_at)}</td>
                            <td className="px-4 py-3 text-sm text-slate-700">{row.updated_by}</td>
                            <td className="px-4 py-3 text-sm">
                              <div className="flex gap-2">
                                <button className="material-button-secondary !px-3 !py-2" onClick={() => openEditGeneric(row)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  className="material-button-secondary !px-3 !py-2 text-red-500 hover:border-red-200 hover:bg-red-50"
                                  onClick={() => openDeleteRow(row.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <div className="text-sm text-slate-500">
                  共 {total} 条，第 {page} / {totalPages} 页
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="material-button-secondary !px-3 !py-2"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page === 1 || loadingItems}
                  >
                    上一页
                  </button>
                  <button
                    className="material-button-secondary !px-3 !py-2"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={page === totalPages || loadingItems}
                  >
                    下一页
                  </button>
                  <span className="flex items-center gap-1.5 text-sm text-slate-500">
                    跳转
                    <input
                      className="material-input w-14 text-center"
                      value={jumpInput}
                      onChange={(event) => setJumpInput(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && handleJump()}
                      placeholder={String(page)}
                    />
                    页
                    <button className="material-button-secondary !px-3 !py-2" onClick={handleJump} disabled={loadingItems}>
                      GO
                    </button>
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      <Dialog open={dialogMode === "add-type" || dialogMode === "edit-type"} onClose={closeDialog} fullWidth maxWidth="xs">
        <DialogTitle>{editTypeId === null ? "新增字典类型" : "编辑字典类型"}</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-4 pt-1">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">类型名称</label>
              <input className="material-input w-full" placeholder="如：产品系列" value={fTypeLabel} onChange={(event) => setFTypeLabel(event.target.value)} />
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog} disabled={savingType}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={submitType} disabled={savingType || !fTypeLabel.trim()}>
            确认
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "delete-type"} onClose={closeDialog} fullWidth maxWidth="xs">
        <DialogTitle>删除字典类型</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm text-slate-600">删除后该类型下所有条目将一并移除，此操作不可撤销。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog} disabled={deletingType}>
            取消
          </button>
          <button type="button" className="material-button-primary !bg-red-500 hover:!bg-red-600" onClick={confirmDeleteType} disabled={deletingType}>
            删除
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "add-email" || dialogMode === "edit-email"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>{editEmailId === null ? "新增邮箱账号" : "编辑邮箱账号"}</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-4 pt-1">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">账号</label>
              <input className="material-input w-full" placeholder="example@domain.com" value={fAccount} onChange={(event) => setFAccount(event.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">密码</label>
              <input className="material-input w-full" type="password" placeholder="输入密码" value={fPassword} onChange={(event) => setFPassword(event.target.value)} />
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog} disabled={savingItem}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={submitEmail} disabled={savingItem || !fAccount.trim() || !fPassword}>
            确认
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "add-generic" || dialogMode === "edit-generic"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>{editGenericId === null ? `新增 · ${activeType?.label ?? ""}` : `编辑 · ${activeType?.label ?? ""}`}</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-4 pt-1">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">编码</label>
              <input className="material-input w-full font-mono" placeholder="如 XX-001" value={fCode} onChange={(event) => setFCode(event.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">标签</label>
              <input className="material-input w-full" placeholder="显示名称" value={fLabel} onChange={(event) => setFLabel(event.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">备注</label>
              <input className="material-input w-full" placeholder="（可选）" value={fRemark} onChange={(event) => setFRemark(event.target.value)} />
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog} disabled={savingItem}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={submitGeneric} disabled={savingItem || !fCode.trim() || !fLabel.trim()}>
            确认
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "delete-row"} onClose={closeDialog} fullWidth maxWidth="xs">
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm text-slate-600">此操作不可撤销，确定要删除这条记录吗？</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog} disabled={deletingItem}>
            取消
          </button>
          <button type="button" className="material-button-primary !bg-red-500 hover:!bg-red-600" onClick={confirmDeleteRow} disabled={deletingItem}>
            删除
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
