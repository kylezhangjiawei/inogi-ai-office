import React, { useEffect, useState } from "react";
import { Pencil, Plus, Search, Trash2, Wifi } from "lucide-react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { toast } from "sonner";

import { Switch } from "./components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { AiModelItem, integrationManagementApi } from "./lib/integrationManagementApi";
import { cn } from "./components/ui/utils";

const PAGE_SIZE = 8;

type DialogMode = "create" | "edit" | "delete" | null;

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

const statusToneMap: Record<string, string> = {
  运行正常: "bg-emerald-50 text-emerald-700",
  连接异常: "bg-rose-50 text-rose-700",
  未配置: "bg-slate-100 text-slate-600",
};

export function AiModelManagementPage() {
  const [rows, setRows] = useState<AiModelItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [jumpInput, setJumpInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedRow, setSelectedRow] = useState<AiModelItem | null>(null);

  const [name, setName] = useState("");
  const [provider, setProvider] = useState("OpenAI");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [isDefaultEnabled, setIsDefaultEnabled] = useState(true);
  const [dialogError, setDialogError] = useState("");

  async function loadRows(targetPage = page) {
    setLoading(true);
    try {
      const response = await integrationManagementApi.listAiModels({
        page: targetPage,
        pageSize: PAGE_SIZE,
        keyword,
      });
      setRows(response.items);
      setTotal(response.total);
      setTotalPages(Math.max(1, response.total_pages));
      if (targetPage > response.total_pages) {
        setPage(Math.max(1, response.total_pages));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取 AI 模型列表失败");
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

  function resetForm() {
    setName("");
    setProvider("OpenAI");
    setModel("");
    setBaseUrl("");
    setApiKey("");
    setEnabled(true);
    setIsDefaultEnabled(true);
    setDialogError("");
  }

  function closeDialog() {
    setDialogMode(null);
    setSelectedRow(null);
    resetForm();
  }

  function openCreate() {
    setSelectedRow(null);
    resetForm();
    setDialogMode("create");
  }

  function openEdit(row: AiModelItem) {
    setSelectedRow(row);
    setName(row.name);
    setProvider(row.provider || "OpenAI");
    setModel(row.model);
    setBaseUrl(row.base_url || "");
    setApiKey("");
    setEnabled(row.enabled);
    setIsDefaultEnabled(row.is_default_enabled);
    setDialogMode("edit");
  }

  function openDelete(row: AiModelItem) {
    setSelectedRow(row);
    setDialogMode("delete");
  }

  async function handleSave() {
    if (!name.trim() || !provider.trim() || !model.trim()) {
      toast.error("请先填写模型名称、服务商和模型标识");
      return;
    }

    setDialogError("");
    setSaving(true);
    try {
      await integrationManagementApi.saveAiModel({
        id: selectedRow?.id,
        name: name.trim(),
        provider: provider.trim(),
        model: model.trim(),
        base_url: baseUrl.trim() || undefined,
        api_key: apiKey.trim() || undefined,
        enabled,
        current_status: selectedRow?.current_status ?? "未配置",
        is_default_enabled: isDefaultEnabled,
      });
      toast.success(dialogMode === "edit" ? "AI 模型已更新" : "AI 模型已新增");
      closeDialog();
      if (page !== 1) {
        setPage(1);
      } else {
        await loadRows(1);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存 AI 模型失败";
      setDialogError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    if (!model.trim()) {
      toast.error("请先填写模型标识");
      return;
    }

    setDialogError("");
    setTestingConnection(true);
    try {
      const result = await integrationManagementApi.testAiModelConnection({
        id: selectedRow?.id,
        provider: provider.trim(),
        model: model.trim(),
        base_url: baseUrl.trim() || undefined,
        api_key: apiKey.trim() || undefined,
      });

      if (result.success) {
        toast.success(
          `测试成功${typeof result.duration_ms === "number" ? `，耗时 ${result.duration_ms} ms` : ""}`,
        );
      } else {
        toast.error(result.message);
      }

      await loadRows(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 连通性测试失败";
      setDialogError(message);
      toast.error(message);
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleToggleEnabled(row: AiModelItem, checked: boolean) {
    try {
      const saved = await integrationManagementApi.saveAiModel({
        id: row.id,
        name: row.name,
        provider: row.provider,
        model: row.model,
        base_url: row.base_url || undefined,
        enabled: checked,
        current_status: row.current_status,
        is_default_enabled: row.is_default_enabled,
      });
      setRows((current) => current.map((item) => (item.id === row.id ? saved : item)));
      if (selectedRow?.id === row.id) {
        setSelectedRow(saved);
      }
      toast.success(checked ? "AI 模型已启用" : "AI 模型已停用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新 AI 模型启用状态失败");
    }
  }

  async function handleDelete() {
    if (!selectedRow) return;

    setDeleting(true);
    try {
      await integrationManagementApi.deleteAiModel(selectedRow.id);
      toast.success("AI 模型已删除");
      closeDialog();
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除 AI 模型失败");
    } finally {
      setDeleting(false);
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
            <span className="material-chip bg-blue-50 text-blue-700">AI Model Management</span>
            <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">AI 模型管理</h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
              维护模型服务商、Base URL、运行状态、延迟和自动统计信息，支持按不同模型独立切换网关或代理地址。
            </p>
          </div>
          <button className="material-button-primary w-fit" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            新增模型
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
              placeholder="搜索模型名称、服务商、模型标识..."
            />
          </div>
          <div className="text-sm text-slate-500">共 {total} 个模型配置</div>
        </div>

        <Table className="min-w-[1440px] text-left">
          <TableHeader className="bg-slate-50">
            <TableRow>
              {[
                "模型名称",
                "服务商",
                "启用",
                "当前状态",
                "最近成功时间",
                "最近失败时间",
                "最近延迟",
                "今日请求数",
                "今日 Token",
                "今日预估费用",
                "当前余额/额度",
                "默认启用",
                "操作人",
                "操作",
              ].map((title) => (
                <TableHead key={title} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {title}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-slate-100">
            {loading ? (
              <TableRow>
                <TableCell colSpan={14} className="px-4 py-8 text-center text-sm text-slate-400">
                  正在加载 AI 模型...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={14} className="px-4 py-8 text-center text-sm text-slate-400">
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-slate-50/70">
                  <TableCell className="px-4 py-3 text-sm font-medium text-slate-800">
                    <div>{row.name}</div>
                    <div className="mt-1 text-xs text-slate-400">{row.model}</div>
                    <div
                      className="mt-1 max-w-[280px] truncate text-xs text-slate-400"
                      title={row.base_url || "未配置 Base URL，默认走官方地址"}
                    >
                      {row.base_url || "默认官方地址"}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-slate-700">{row.provider}</TableCell>
                  <TableCell className="px-4 py-3 text-sm text-slate-700">
                    <div className="flex items-center gap-2">
                      <Switch checked={row.enabled} onCheckedChange={(checked) => void handleToggleEnabled(row, checked)} />
                      <span>{row.enabled ? "启用" : "停用"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm">
                    <div className="space-y-2">
                      <span className={cn("material-chip", statusToneMap[row.current_status] ?? "bg-slate-100 text-slate-600")}>
                        {row.current_status}
                      </span>
                      {row.last_error_message ? (
                        <div className="max-w-[220px] truncate text-xs text-rose-500" title={row.last_error_message}>
                          {row.last_error_message}
                        </div>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-slate-500">{formatDate(row.last_success_at)}</TableCell>
                  <TableCell className="px-4 py-3 text-sm text-slate-500">{formatDate(row.last_failure_at)}</TableCell>
                  <TableCell className="px-4 py-3 text-sm text-slate-700">
                    {typeof row.last_latency_ms === "number" ? `${row.last_latency_ms} ms` : "-"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-slate-700">{row.today_requests}</TableCell>
                  <TableCell className="px-4 py-3 text-sm text-slate-700">{row.today_tokens}</TableCell>
                  <TableCell className="px-4 py-3 text-sm text-slate-700">{row.today_estimated_cost.toFixed(4)}</TableCell>
                  <TableCell className="px-4 py-3 text-sm text-slate-700">{row.current_balance_or_quota || "-"}</TableCell>
                  <TableCell className="px-4 py-3 text-sm text-slate-700">{row.is_default_enabled ? "是" : "否"}</TableCell>
                  <TableCell className="px-4 py-3 text-sm text-slate-700">{row.operator_name}</TableCell>
                  <TableCell className="px-4 py-3 text-sm">
                    <div className="flex gap-2">
                      <button className="material-button-secondary !px-3 !py-2" onClick={() => openEdit(row)} title="编辑">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="material-button-secondary !px-3 !py-2 text-red-500 hover:border-red-200 hover:bg-red-50"
                        onClick={() => openDelete(row)}
                        title="删除"
                      >
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

      <Dialog open={dialogMode === "create" || dialogMode === "edit"} onClose={closeDialog} fullWidth maxWidth="md">
        <DialogTitle>{dialogMode === "edit" ? "编辑 AI 模型" : "新增 AI 模型"}</DialogTitle>
        <DialogContent dividers>
          <div className="grid gap-4 pt-1 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">模型名称</label>
              <input className="material-input w-full" value={name} onChange={(event) => setName(event.target.value)} placeholder="如：GPT-5 主模型" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">服务商</label>
              <input className="material-input w-full" value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="如：OpenAI" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">模型标识</label>
              <input className="material-input w-full" value={model} onChange={(event) => setModel(event.target.value)} placeholder="如：gpt-5" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">API Key</label>
              <input
                className="material-input w-full"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={dialogMode === "edit" && selectedRow?.has_api_key ? "留空则保留原 API Key" : "请输入 API Key"}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Base URL</label>
              <input
                className="material-input w-full"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="如：https://api.openai.com/v1 或你的代理/网关地址"
              />
              <p className="mt-1.5 text-xs leading-5 text-slate-400">
                不填写时默认走后端环境中的官方地址；如果浏览器能通、服务端不能通，优先在这里配置代理或网关地址。
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <span className="text-sm text-slate-700">{enabled ? "已启用" : "已停用"}</span>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <input id="is_default_enabled" type="checkbox" checked={isDefaultEnabled} onChange={(event) => setIsDefaultEnabled(event.target.checked)} />
              <label htmlFor="is_default_enabled" className="text-sm text-slate-700">
                默认启用
              </label>
            </div>
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-500 md:col-span-2">
              当前状态、最近成功时间、最近失败时间、最近延迟、今日请求数、今日 Token、今日预估费用、当前余额/额度都由系统自动获取或自动计算。
            </div>
            {dialogError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700 md:col-span-2">
                {dialogError}
              </div>
            ) : null}
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog} disabled={saving || testingConnection}>
            取消
          </button>
          <button type="button" className="material-button-secondary" onClick={() => void handleTestConnection()} disabled={saving || testingConnection}>
            <Wifi className="h-4 w-4" />
            {testingConnection ? "测试中..." : "测试连通性"}
          </button>
          <button type="button" className="material-button-primary" onClick={() => void handleSave()} disabled={saving || testingConnection}>
            {saving ? "保存中..." : "确认"}
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "delete"} onClose={closeDialog} fullWidth maxWidth="xs">
        <DialogTitle>删除 AI 模型</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm text-slate-600">确认删除 AI 模型“{selectedRow?.name ?? "-"}”吗？此操作不可撤销。</p>
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
