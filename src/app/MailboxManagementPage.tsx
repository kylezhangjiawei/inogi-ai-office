import React, { useEffect, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { toast } from "sonner";

import { Switch } from "./components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { MailboxItem, integrationManagementApi } from "./lib/integrationManagementApi";

const PAGE_SIZE = 8;

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

type DialogMode = "create" | "edit" | "delete" | null;

export function MailboxManagementPage() {
  const [rows, setRows] = useState<MailboxItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [jumpInput, setJumpInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedRow, setSelectedRow] = useState<MailboxItem | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState(true);

  async function loadRows(targetPage = page) {
    setLoading(true);
    try {
      const response = await integrationManagementApi.listMailboxes({
        page: targetPage,
        pageSize: PAGE_SIZE,
        keyword,
      });
      setRows(response.items);
      setTotal(response.total);
      setTotalPages(response.total_pages);
      if (targetPage > response.total_pages) {
        setPage(response.total_pages);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取邮箱管理列表失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPage(1);
  }, [keyword]);

  useEffect(() => {
    void loadRows();
  }, [page, keyword]);

  function closeDialog() {
    setDialogMode(null);
    setSelectedRow(null);
    setEmail("");
    setPassword("");
    setEnabled(true);
  }

  function openCreate() {
    setSelectedRow(null);
    setEmail("");
    setPassword("");
    setEnabled(true);
    setDialogMode("create");
  }

  function openEdit(row: MailboxItem) {
    setSelectedRow(row);
    setEmail(row.email);
    setPassword("");
    setEnabled(row.enabled);
    setDialogMode("edit");
  }

  function openDelete(row: MailboxItem) {
    setSelectedRow(row);
    setDialogMode("delete");
  }

  async function handleSave() {
    if (!email.trim()) {
      toast.error("请先填写邮箱地址");
      return;
    }
    if (dialogMode === "create" && !password) {
      toast.error("请先填写邮箱密码");
      return;
    }

    setSaving(true);
    try {
      await integrationManagementApi.saveMailbox({
        id: selectedRow?.id,
        email: email.trim(),
        password,
        enabled,
      });
      toast.success(dialogMode === "edit" ? "邮箱配置已更新" : "邮箱配置已新增");
      closeDialog();
      if (page !== 1) {
        setPage(1);
      } else {
        await loadRows(1);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存邮箱配置失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedRow) return;

    setDeleting(true);
    try {
      await integrationManagementApi.deleteMailbox(selectedRow.id);
      toast.success("邮箱配置已删除");
      closeDialog();
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除邮箱配置失败");
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleEnabled(row: MailboxItem, checked: boolean) {
    try {
      const saved = await integrationManagementApi.saveMailbox({
        id: row.id,
        email: row.email,
        enabled: checked,
      });
      setRows((current) => current.map((item) => (item.id === row.id ? saved : item)));
      if (selectedRow?.id === row.id) {
        setSelectedRow(saved);
      }
      toast.success(checked ? "邮箱已启用" : "邮箱已停用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新邮箱启用状态失败");
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="material-chip bg-blue-50 text-blue-700">Mailbox Management</span>
            <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">邮箱管理</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">统一维护业务邮箱地址与密码，支持表格化增删改查和快速检索。</p>
          </div>
          <button className="material-button-primary w-fit" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            新增邮箱
          </button>
        </div>
      </section>

      <section className="material-card p-6">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="material-input pl-11"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索邮箱地址..."
            />
          </div>
          <div className="text-sm text-slate-500">共 {total} 条邮箱配置</div>
        </div>

        <Table className="min-w-full text-left">
          <TableHeader className="bg-slate-50">
            <TableRow>
                {["邮箱地址", "密码状态", "启用", "创建时间", "修改时间", "操作人", "操作"].map((title) => (
                  <TableHead key={title} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {title}
                  </TableHead>
                ))}
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-slate-100">
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                    正在加载邮箱配置...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                    暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} className="hover:bg-slate-50/70">
                    <TableCell className="px-4 py-3 text-sm font-medium text-slate-800">{row.email}</TableCell>
                    <TableCell className="px-4 py-3 text-sm text-slate-700">{row.has_password ? "已设置" : "未设置"}</TableCell>
                    <TableCell className="px-4 py-3 text-sm text-slate-700">
                      <div className="flex items-center gap-2">
                        <Switch checked={row.enabled} onCheckedChange={(checked) => void handleToggleEnabled(row, checked)} />
                        <span>{row.enabled ? "启用" : "停用"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-slate-500">{formatDate(row.created_at)}</TableCell>
                    <TableCell className="px-4 py-3 text-sm text-slate-500">{formatDate(row.updated_at)}</TableCell>
                    <TableCell className="px-4 py-3 text-sm text-slate-700">{row.operator_name}</TableCell>
                    <TableCell className="px-4 py-3 text-sm">
                      <div className="flex gap-2">
                        <button className="material-button-secondary !px-3 !py-2" onClick={() => openEdit(row)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button className="material-button-secondary !px-3 !py-2 text-red-500 hover:border-red-200 hover:bg-red-50" onClick={() => openDelete(row)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
          </TableBody>
        </Table>

        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
          <div className="text-sm text-slate-500">
            共 {total} 条，当前第 {page} / {totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            <button className="material-button-secondary !px-3 !py-2" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1 || loading}>
              上一页
            </button>
            <button className="material-button-secondary !px-3 !py-2" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages || loading}>
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
              <button className="material-button-secondary !px-3 !py-2" onClick={handleJump} disabled={loading}>
                GO
              </button>
            </span>
          </div>
        </div>
      </section>

      <Dialog open={dialogMode === "create" || dialogMode === "edit"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>{dialogMode === "edit" ? "编辑邮箱配置" : "新增邮箱配置"}</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-4 pt-1">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">邮箱地址</label>
              <input className="material-input w-full" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="example@domain.com" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">邮箱密码</label>
              <input className="material-input w-full" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={dialogMode === "edit" ? "留空则保留原密码，不会回显旧密码" : "输入密码"} />
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <span className="text-sm text-slate-700">{enabled ? "已启用" : "已停用"}</span>
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog} disabled={saving}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={() => void handleSave()} disabled={saving}>
            确认
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "delete"} onClose={closeDialog} fullWidth maxWidth="xs">
        <DialogTitle>删除邮箱配置</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm text-slate-600">确认删除邮箱配置 “{selectedRow?.email ?? "-"}” 吗？此操作不可撤销。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog} disabled={deleting}>
            取消
          </button>
          <button type="button" className="material-button-primary !bg-red-500 hover:!bg-red-600" onClick={() => void handleDelete()} disabled={deleting}>
            删除
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
