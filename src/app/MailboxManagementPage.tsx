import React, { useEffect, useRef, useState } from "react";
import { Files, KeyRound, Mail, Pencil, Plus, Power, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Switch } from "./components/ui/switch";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table";
import { cn } from "./components/ui/utils";
import { MailboxItem, integrationManagementApi } from "./lib/integrationManagementApi";

const PAGE_SIZE = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatDate(value?: string | null) {
  if (!value) return "—";
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
type FormErrors = { email?: string; password?: string; form?: string };

export function MailboxManagementPage() {
  const dialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [rows, setRows] = useState<MailboxItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [jumpInput, setJumpInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedRow, setSelectedRow] = useState<MailboxItem | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState(true);

  async function loadRows(targetPage = page) {
    setLoading(true);
    setLoadError("");
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
      const message = error instanceof Error ? error.message : "读取邮箱管理列表失败";
      setLoadError(message);
      toast.error(message);
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
    setFormErrors({});
    setDeleteError("");
  }

  function openCreate(trigger?: HTMLButtonElement | null) {
    dialogTriggerRef.current = trigger ?? null;
    setSelectedRow(null);
    setEmail("");
    setPassword("");
    setEnabled(true);
    setFormErrors({});
    setDialogMode("create");
  }

  function openEdit(row: MailboxItem, trigger?: HTMLButtonElement | null) {
    dialogTriggerRef.current = trigger ?? null;
    setSelectedRow(row);
    setEmail(row.email);
    setPassword("");
    setEnabled(row.enabled);
    setFormErrors({});
    setDialogMode("edit");
  }

  function openDelete(row: MailboxItem, trigger?: HTMLButtonElement | null) {
    dialogTriggerRef.current = trigger ?? null;
    setSelectedRow(row);
    setDeleteError("");
    setDialogMode("delete");
  }

  async function handleSave() {
    const nextErrors: FormErrors = {};
    if (!email.trim()) {
      nextErrors.email = "请输入邮箱地址。";
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = "请输入有效的邮箱地址。";
    }
    if (dialogMode === "create" && !password.trim()) {
      nextErrors.password = "新增邮箱时必须设置密码。";
    }
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      document.getElementById(nextErrors.email ? "mailbox-email" : "mailbox-password")?.focus();
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
      const message = error instanceof Error ? error.message : "保存邮箱配置失败";
      setFormErrors({ form: message });
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedRow) return;

    setDeleting(true);
    setDeleteError("");
    try {
      await integrationManagementApi.deleteMailbox(selectedRow.id);
      toast.success("邮箱配置已删除");
      closeDialog();
      await loadRows();
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除邮箱配置失败";
      setDeleteError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleEnabled(row: MailboxItem, checked: boolean) {
    setTogglingId(row.id);
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
    } finally {
      setTogglingId(null);
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

  const enabledOnPage = rows.filter((row) => row.enabled).length;
  const passwordReadyOnPage = rows.filter((row) => row.has_password).length;

  return (
    <div className="horizon-theme hz-page">
      <div className="hz-page-inner space-y-3">
        <HorizonPageHeader
          Icon={Mail}
          eyebrow="SYSTEM GOVERNANCE · MAILBOXES"
          title="邮箱管理"
          description="统一维护业务邮箱凭证与启用状态，支持分页检索、快速编辑和安全删除。"
          meta={(
            <>
              <span>每页 {PAGE_SIZE} 条</span>
              <span>密码保存后不回显</span>
            </>
          )}
          actions={(
            <>
              <Button type="button" variant="outline" onClick={() => void loadRows()} disabled={loading || saving || deleting}>
                <RefreshCw className="size-4" aria-hidden="true" />
                {loading ? "读取中…" : "刷新"}
              </Button>
              <Button type="button" className="hz-primary-action" onClick={(event) => openCreate(event.currentTarget)}>
                <Plus className="size-4" aria-hidden="true" />
                新增邮箱
              </Button>
            </>
          )}
        />

        <HorizonMetricGrid className="!grid-cols-2 xl:!grid-cols-4">
          <HorizonMetric Icon={Files} label={keyword ? "匹配配置" : "邮箱配置"} value={total} note={keyword ? "当前检索结果" : "系统内配置总量"} tone="brand" />
          <HorizonMetric Icon={Power} label="当前页启用" value={enabledOnPage} note={`本页共 ${rows.length} 条`} tone={enabledOnPage > 0 ? "success" : "neutral"} />
          <HorizonMetric Icon={KeyRound} label="当前页凭据完整" value={passwordReadyOnPage} note="已设置邮箱密码" tone={passwordReadyOnPage === rows.length && rows.length > 0 ? "success" : "warning"} />
          <HorizonMetric Icon={Mail} label="分页位置" value={`${page}/${totalPages}`} note={`本页展示 ${rows.length} 条`} tone="neutral" />
        </HorizonMetricGrid>

        <section className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader
            Icon={Files}
            title="邮箱配置列表"
            description="按邮箱地址检索，直接调整启用状态，或进入编辑与删除流程。"
            trailing={<span className="text-xs font-semibold text-slate-500 tabular-nums">共 {total} 条</span>}
          />

          <div className="hz-toolbar flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Label htmlFor="mailbox-search" className="sr-only">搜索邮箱地址</Label>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="mailbox-search"
                name="mailbox-search"
                type="search"
                className="pl-9"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索邮箱地址…"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {keyword ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setKeyword("")}>
                清除筛选
              </Button>
            ) : null}
          </div>

          <div className="mailbox-table-scroll min-h-0 min-w-0 max-h-[min(46rem,max(18rem,calc(100dvh-25rem)))] overflow-auto [scrollbar-gutter:stable]">
          <Table className="min-w-[920px] text-left" containerClassName="overflow-visible">
            <TableCaption className="sr-only">邮箱配置列表，包含凭据状态、启用状态、创建及修改时间和操作信息。</TableCaption>
              <TableHeader className="sticky top-0 z-10 bg-slate-50/95">
              <TableRow>
                {["邮箱地址", "密码状态", "启用状态", "创建时间", "修改时间", "操作人", "操作"].map((title) => (
                  <TableHead key={title} scope="col" className={cn("h-11 px-4 text-xs font-semibold text-slate-600", title === "操作" && "text-right")}>
                    {title}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-36 px-4 text-center text-sm text-slate-500">
                    <span role="status" aria-live="polite">正在读取邮箱配置…</span>
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0 whitespace-normal">
                    {loadError ? (
                      <HorizonEmptyState
                        Icon={RefreshCw}
                        title="邮箱配置读取失败"
                        description={loadError}
                        action={<Button type="button" variant="outline" onClick={() => void loadRows()}>重新加载</Button>}
                      />
                    ) : keyword ? (
                      <HorizonEmptyState
                        Icon={Search}
                        title="没有匹配的邮箱配置"
                        description="请调整邮箱关键字，或清除筛选查看全部配置。"
                        action={<Button type="button" variant="outline" onClick={() => setKeyword("")}>清除筛选</Button>}
                      />
                    ) : (
                      <HorizonEmptyState
                        Icon={Mail}
                        title="尚未配置业务邮箱"
                        description="新增邮箱后即可维护凭证并控制是否启用。"
                        action={<Button type="button" className="hz-primary-action" onClick={(event) => openCreate(event.currentTarget)}><Plus className="size-4" aria-hidden="true" />新增邮箱</Button>}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[260px] px-4 py-3 font-medium text-slate-800">
                      <span className="block truncate" title={row.email}>{row.email}</span>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", row.has_password ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                        {row.has_password ? "已设置" : "未设置"}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={row.enabled}
                          onCheckedChange={(checked) => void handleToggleEnabled(row, checked)}
                          disabled={togglingId !== null || saving || deleting}
                          aria-label={`${row.enabled ? "停用" : "启用"}邮箱 ${row.email}`}
                        />
                        <span className="text-sm text-slate-600">{togglingId === row.id ? "更新中…" : row.enabled ? "启用" : "停用"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-slate-500 tabular-nums">{formatDate(row.created_at)}</TableCell>
                    <TableCell className="px-4 py-3 text-sm text-slate-500 tabular-nums">{formatDate(row.updated_at)}</TableCell>
                    <TableCell className="max-w-[160px] px-4 py-3 text-sm text-slate-700"><span className="block truncate" title={row.operator_name}>{row.operator_name || "—"}</span></TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button type="button" variant="ghost" size="icon" onClick={(event) => openEdit(row, event.currentTarget)} aria-label={`编辑邮箱 ${row.email}`} title="编辑邮箱">
                          <Pencil className="size-4" aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={(event) => openDelete(row, event.currentTarget)} aria-label={`删除邮箱 ${row.email}`} title="删除邮箱">
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-500 tabular-nums">
              共 {total} 条 · 第 {page} / {totalPages} 页
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1 || loading}>
                上一页
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages || loading}>
                下一页
              </Button>
              <div className="flex items-center gap-2">
                <Label htmlFor="mailbox-page-jump" className="sr-only">跳转页码</Label>
                <Input
                  id="mailbox-page-jump"
                  name="mailbox-page-jump"
                  className="h-8 w-20 text-center tabular-nums"
                  value={jumpInput}
                  onChange={(event) => setJumpInput(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && handleJump()}
                  placeholder="页码…"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label="跳转页码"
                />
                <Button type="button" variant="outline" size="sm" onClick={handleJump} disabled={loading}>跳转</Button>
              </div>
            </div>
          </div>
        </section>

        <Dialog
          open={dialogMode === "create" || dialogMode === "edit"}
          onOpenChange={(open) => {
            if (!open && !saving) closeDialog();
          }}
        >
          <DialogContent
            className="horizon-portal sm:max-w-lg"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const trigger = dialogTriggerRef.current;
              dialogTriggerRef.current = null;
              if (trigger?.isConnected) trigger.focus();
            }}
          >
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void handleSave();
              }}
            >
              <DialogHeader>
                <DialogTitle className="text-balance text-slate-900">{dialogMode === "edit" ? "编辑邮箱配置" : "新增邮箱配置"}</DialogTitle>
                <DialogDescription className="text-pretty">{dialogMode === "edit" ? "更新邮箱地址、凭证或启用状态；密码留空时保留原凭证。" : "填写邮箱地址和密码，保存后即可在业务流程中启用。"}</DialogDescription>
              </DialogHeader>

              <div className="space-y-5 py-5">
                {formErrors.form ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formErrors.form}</p> : null}
                <div>
                  <Label htmlFor="mailbox-email" className="mb-2 text-slate-700">邮箱地址</Label>
                  <Input
                    id="mailbox-email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      if (formErrors.email || formErrors.form) setFormErrors((current) => ({ ...current, email: undefined, form: undefined }));
                    }}
                    placeholder="name@example.com"
                    autoComplete="email"
                    spellCheck={false}
                    aria-invalid={Boolean(formErrors.email)}
                    aria-describedby={formErrors.email ? "mailbox-email-error" : "mailbox-email-help"}
                  />
                  {formErrors.email ? <p id="mailbox-email-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.email}</p> : <p id="mailbox-email-help" className="mt-1.5 text-xs text-slate-500">请输入用于系统业务通知或外发的完整邮箱地址。</p>}
                </div>
                <div>
                  <Label htmlFor="mailbox-password" className="mb-2 text-slate-700">邮箱密码</Label>
                  <Input
                    id="mailbox-password"
                    name="password"
                    type="password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (formErrors.password || formErrors.form) setFormErrors((current) => ({ ...current, password: undefined, form: undefined }));
                    }}
                    placeholder={dialogMode === "edit" ? "留空则保留原密码" : "输入邮箱密码"}
                    autoComplete="new-password"
                    aria-invalid={Boolean(formErrors.password)}
                    aria-describedby={formErrors.password ? "mailbox-password-error" : "mailbox-password-help"}
                  />
                  {formErrors.password ? <p id="mailbox-password-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.password}</p> : <p id="mailbox-password-help" className="mt-1.5 text-xs text-slate-500">{dialogMode === "edit" ? "出于安全考虑，已保存的密码不会回显；留空即可保留。" : "密码会通过现有安全接口提交，保存后不在页面回显。"}</p>}
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div>
                    <Label htmlFor="mailbox-enabled" className="text-slate-700">启用邮箱</Label>
                    <p id="mailbox-enabled-help" className="mt-1 text-pretty text-xs text-slate-500">停用后保留配置，但业务流程不会使用该邮箱。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600">{enabled ? "已启用" : "已停用"}</span>
                    <Switch id="mailbox-enabled" checked={enabled} onCheckedChange={setEnabled} aria-describedby="mailbox-enabled-help" aria-label="启用邮箱" />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog} disabled={saving}>取消</Button>
                <Button type="submit" className="hz-primary-action" disabled={saving}>
                  {saving ? "保存中…" : dialogMode === "edit" ? "保存修改" : "新增邮箱"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={dialogMode === "delete"}
          onOpenChange={(open) => {
            if (!open && !deleting) closeDialog();
          }}
        >
          <AlertDialogContent
            className="horizon-portal sm:max-w-md"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const trigger = dialogTriggerRef.current;
              dialogTriggerRef.current = null;
              if (trigger?.isConnected) trigger.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle className="text-balance text-slate-900">确认删除邮箱配置？</AlertDialogTitle>
              <AlertDialogDescription className="text-pretty leading-6">
                将永久删除“{selectedRow?.email ?? "—"}”及其已保存凭证。此操作无法撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{deleteError}</p> : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>保留配置</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={(event) => {
                  event.preventDefault();
                  void handleDelete();
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {deleting ? "删除中…" : "确认删除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
