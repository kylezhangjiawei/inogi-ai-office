/**
 * 翻译管理页（自建轻量版 Crowdin，方案 docs/i18n-双语方案.md §3）。
 * 三列表：中文原文 / 英文（行内编辑）/ 所属页面 + 状态标记（AI 初翻 / 已人工校准 / 缺失）。
 * 动作：搜索、按模块/状态过滤、单条 AI 重翻、AI 翻译全部缺失、导出 / 导入 JSON。
 * 字典存服务端 KV，保存即时生效（在线用户切语言或刷新即见），不需要发版。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, Download, Languages, Loader2, Pencil, RefreshCw, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { authFetch } from "./lib/authSession";
import { reloadI18nDict } from "./lib/i18n";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { cn } from "./components/ui/utils";

type Row = { zh: string; en: string; status: "ai" | "human" | "missing"; module: string; updatedAt: string };

const STATUS_META: Record<Row["status"], { label: string; cls: string }> = {
  human: { label: "已人工校准", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  ai: { label: "AI 初翻", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  missing: { label: "缺英文", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(path, init);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(Array.isArray(err.message) ? err.message.join("; ") : (err.message ?? "请求失败"));
  }
  return res.json() as Promise<T>;
}

export function I18nManagementPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [translatingKey, setTranslatingKey] = useState<string | null>(null);
  const [bulkTranslating, setBulkTranslating] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await api<{ total: number; rows: Row[] }>("/api/i18n/overview/en");
      setRows(data.rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const modules = useMemo(
    () => [...new Set(rows.map((r) => r.module).filter(Boolean))].sort(),
    [rows],
  );
  const missingCount = useMemo(() => rows.filter((r) => r.status === "missing").length, [rows]);

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (moduleFilter !== "all" && r.module !== moduleFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (kw && !r.zh.toLowerCase().includes(kw) && !r.en.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [rows, keyword, moduleFilter, statusFilter]);

  const saveEntry = useCallback(async (zh: string, en: string) => {
    setSavingKey(zh);
    try {
      await api(`/api/i18n/dict/en`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [zh]: en.trim() || null }),
      });
      await reloadI18nDict();
      setRows((prev) =>
        prev.map((r) =>
          r.zh === zh
            ? { ...r, en: en.trim(), status: en.trim() ? "human" : "missing", updatedAt: new Date().toISOString() }
            : r,
        ),
      );
      setEditingKey(null);
      toast.success("已保存，即时生效");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingKey(null);
    }
  }, []);

  const translateOne = useCallback(async (zh: string) => {
    setTranslatingKey(zh);
    try {
      const result = await api<{ translated: number }>(`/api/i18n/translate/en`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [zh] }),
      });
      if (result.translated > 0) {
        toast.success("AI 已重翻该条");
        await reloadI18nDict();
        await load(true);
      } else {
        toast.error("AI 翻译失败，请重试");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI 翻译失败");
    } finally {
      setTranslatingKey(null);
    }
  }, [load]);

  const translateMissing = useCallback(async () => {
    setBulkTranslating(true);
    try {
      const result = await api<{ translated: number; failed: number }>(`/api/i18n/translate/en`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      toast.success(`AI 初翻完成：成功 ${result.translated} 条${result.failed ? `，失败 ${result.failed} 条` : ""}`);
      await reloadI18nDict();
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量翻译失败");
    } finally {
      setBulkTranslating(false);
    }
  }, [load]);

  const exportJson = useCallback(() => {
    const dict = Object.fromEntries(rows.filter((r) => r.en).map((r) => [r.zh, r.en]));
    const blob = new Blob([JSON.stringify(dict, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `i18n-en-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows]);

  const importJson = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text()) as Record<string, string>;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON 须为 { 中文: 英文 } 对象");
        await api(`/api/i18n/dict/en`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        });
        toast.success(`已导入 ${Object.keys(parsed).length} 条（merge）`);
        await reloadI18nDict();
        await load(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "导入失败");
      }
    };
    input.click();
  }, [load]);

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="material-card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <Languages className="h-5 w-5 text-indigo-600" />
            翻译管理
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            界面双语字典（中文原文即 key）。改完即时生效，不需要发版；共 {rows.length} 条，缺英文 {missingCount} 条。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} className="h-9 rounded-lg text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
          <Button type="button" variant="outline" onClick={exportJson} className="h-9 rounded-lg text-xs">
            <Download className="h-3.5 w-3.5" />
            导出 JSON
          </Button>
          <Button type="button" variant="outline" onClick={importJson} className="h-9 rounded-lg text-xs">
            <Upload className="h-3.5 w-3.5" />
            导入 JSON
          </Button>
          <Button
            type="button"
            onClick={() => void translateMissing()}
            disabled={bulkTranslating || missingCount === 0}
            className="h-9 rounded-lg bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            {bulkTranslating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
            AI 翻译缺失（{missingCount}）
          </Button>
        </div>
      </div>

      {/* 过滤条 */}
      <div className="material-card flex flex-wrap items-center gap-2 p-4">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索中文或英文…"
            className="h-9 rounded-lg pl-9 text-sm"
          />
        </div>
        <Select value={moduleFilter} onValueChange={setModuleFilter}>
          <SelectTrigger className="h-9 w-auto min-w-40 rounded-lg text-xs" data-size="default">
            <SelectValue placeholder="全部模块" />
          </SelectTrigger>
          <SelectContent className="max-h-72 rounded-xl">
            <SelectItem value="all">全部模块</SelectItem>
            {modules.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-auto min-w-32 rounded-lg text-xs" data-size="default">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="missing">缺英文</SelectItem>
            <SelectItem value="ai">AI 初翻</SelectItem>
            <SelectItem value="human">已人工校准</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs tabular-nums text-slate-400">{visible.length} / {rows.length}</span>
      </div>

      {/* 表格 */}
      <div className="material-card overflow-hidden">
        <div className="material-scrollbar max-h-[62vh] overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="border-b border-slate-100 px-4 py-2.5">中文原文</th>
                <th className="border-b border-slate-100 px-4 py-2.5">英文</th>
                <th className="border-b border-slate-100 px-4 py-2.5 w-44">所属页面</th>
                <th className="border-b border-slate-100 px-4 py-2.5 w-28">状态</th>
                <th className="border-b border-slate-100 px-4 py-2.5 w-28">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-slate-400">没有匹配的条目。P1 铺量后运行 extract-i18n-keys 脚本登记文案 key。</td></tr>
              ) : (
                visible.map((row) => {
                  const editing = editingKey === row.zh;
                  const meta = STATUS_META[row.status];
                  return (
                    <tr key={row.zh} className="group hover:bg-slate-50/60">
                      <td className="max-w-[320px] border-b border-slate-50 px-4 py-2 text-slate-800">
                        <span className="line-clamp-2 break-all">{row.zh}</span>
                      </td>
                      <td className="border-b border-slate-50 px-4 py-2">
                        {editing ? (
                          <div className="flex items-center gap-1.5">
                            <Input
                              autoFocus
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void saveEntry(row.zh, editingValue);
                                if (e.key === "Escape") setEditingKey(null);
                              }}
                              className="h-8 rounded-md text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => void saveEntry(row.zh, editingValue)}
                              disabled={savingKey === row.zh}
                              title="保存（Enter）"
                              className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50"
                            >
                              {savingKey === row.zh ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            </button>
                            <button type="button" onClick={() => setEditingKey(null)} title="取消（Esc）" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setEditingKey(row.zh); setEditingValue(row.en); }}
                            className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-indigo-50/60"
                            title="点击行内编辑"
                          >
                            <span className={cn("min-w-0 flex-1 break-all", row.en ? "text-slate-700" : "text-slate-300")}>{row.en || "（未翻译）"}</span>
                            <Pencil className="h-3 w-3 shrink-0 text-slate-300 opacity-0 transition group-hover:opacity-100" />
                          </button>
                        )}
                      </td>
                      <td className="border-b border-slate-50 px-4 py-2 text-xs text-slate-500">{row.module || "—"}</td>
                      <td className="border-b border-slate-50 px-4 py-2">
                        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", meta.cls)}>{meta.label}</span>
                      </td>
                      <td className="border-b border-slate-50 px-4 py-2">
                        <button
                          type="button"
                          onClick={() => void translateOne(row.zh)}
                          disabled={translatingKey === row.zh}
                          title="AI 重翻此条（带术语基准 + UX Writer 校对）"
                          className="inline-flex items-center gap-1 rounded-md border border-violet-100 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700 transition hover:bg-violet-100 disabled:opacity-50"
                        >
                          {translatingKey === row.zh ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
                          AI 重翻
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default I18nManagementPage;
