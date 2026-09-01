/**
 * 翻译管理页（自建轻量版 Crowdin，方案 docs/i18n-双语方案.md §3）。
 * 三列表：中文原文 / 英文（行内编辑）/ 所属页面 + 状态标记（AI 初翻 / 已人工校准 / 缺失）。
 * 动作：搜索、按模块/状态过滤、单条 AI 重翻、AI 翻译全部缺失、导出 / 导入 JSON。
 * 字典存服务端 KV，保存即时生效（在线用户切语言或刷新即见），不需要发版。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, CircleAlert, Download, Languages, Loader2, Pencil, RefreshCw, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { authFetch } from "./lib/authSession";
import { reloadI18nDict } from "./lib/i18n";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { cn } from "./components/ui/utils";

type Row = { zh: string; en: string; status: "ai" | "human" | "missing"; module: string; updatedAt: string };

const STATUS_META: Record<Row["status"], { label: string; cls: string }> = {
  human: { label: "已人工校准", cls: "border-green-200 bg-green-50 text-green-700" },
  ai: { label: "AI 初翻", cls: "border-blue-200 bg-blue-50 text-blue-700" },
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
  const [loadError, setLoadError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [translatingKey, setTranslatingKey] = useState<string | null>(null);
  const [bulkTranslating, setBulkTranslating] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const closeEditor = useCallback((zh: string) => {
    setEditingKey(null);
    window.requestAnimationFrame(() => {
      const label = `编辑“${zh}”的英文翻译`;
      const trigger = [...document.querySelectorAll<HTMLButtonElement>("button[aria-label]")]
        .find((button) => button.getAttribute("aria-label") === label);
      trigger?.focus();
    });
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError("");
    try {
      const data = await api<{ total: number; rows: Row[] }>("/api/i18n/overview/en");
      setRows(data.rows);
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载失败";
      setLoadError(message);
      toast.error(message);
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
  const aiCount = useMemo(() => rows.filter((r) => r.status === "ai").length, [rows]);
  const humanCount = useMemo(() => rows.filter((r) => r.status === "human").length, [rows]);

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (moduleFilter !== "all" && r.module !== moduleFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (kw && !r.zh.toLowerCase().includes(kw) && !r.en.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [rows, keyword, moduleFilter, statusFilter]);

  const hasActiveFilters = Boolean(keyword.trim()) || moduleFilter !== "all" || statusFilter !== "all";
  const clearFilters = useCallback(() => {
    setKeyword("");
    setModuleFilter("all");
    setStatusFilter("all");
  }, []);

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
      closeEditor(zh);
      toast.success("已保存，即时生效");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingKey(null);
    }
  }, [closeEditor]);

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
    importInputRef.current?.click();
  }, []);

  const handleImportJson = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
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
  }, [load]);

  const coverageRate = rows.length > 0 ? Math.round(((rows.length - missingCount) / rows.length) * 100) : 0;

  return (
    <div className="horizon-theme hz-page">
      <div className="hz-page-inner space-y-3">
        <HorizonPageHeader
          Icon={Languages}
          eyebrow="SYSTEM MANAGEMENT · I18N DICTIONARY"
          title="翻译管理"
          description="集中维护中英文界面字典。保存、AI 翻译或 JSON 合并导入后会立即重载词典，无需重新发版。"
          meta={(
            <>
              <span>目标语言：英文</span>
              <span className="tabular-nums">当前展示 {visible.length} / {rows.length} 条</span>
            </>
          )}
          actions={(
            <>
              <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
                刷新
              </Button>
              <Button type="button" variant="outline" onClick={exportJson}>
                <Download className="size-4" aria-hidden="true" />
                导出 JSON
              </Button>
              <Button type="button" variant="outline" onClick={importJson}>
                <Upload className="size-4" aria-hidden="true" />
                导入 JSON
              </Button>
              <Button
                type="button"
                onClick={() => void translateMissing()}
                disabled={bulkTranslating || missingCount === 0}
                className="bg-[#002fa7] text-white hover:bg-[#002581]"
              >
                {bulkTranslating ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Bot className="size-4" aria-hidden="true" />}
                AI 翻译缺失（<span className="tabular-nums">{missingCount}</span>）
              </Button>
            </>
          )}
        />

        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          tabIndex={-1}
          onChange={(event) => void handleImportJson(event)}
        />

        <HorizonMetricGrid className="!grid-cols-2 xl:!grid-cols-4">
          <HorizonMetric Icon={Languages} label="词条总量" value={loading && rows.length === 0 ? "—" : rows.length} note={`${modules.length} 个业务模块`} tone="brand" />
          <HorizonMetric Icon={Check} label="人工校准" value={loading && rows.length === 0 ? "—" : humanCount} note="已由团队确认文案" tone="success" />
          <HorizonMetric Icon={Bot} label="AI 初翻" value={loading && rows.length === 0 ? "—" : aiCount} note={`英文覆盖率 ${coverageRate}%`} tone="brand" />
          <HorizonMetric Icon={CircleAlert} label="待补英文" value={loading && rows.length === 0 ? "—" : missingCount} note={missingCount > 0 ? "可批量生成初稿" : "当前词条已覆盖"} tone={missingCount > 0 ? "warning" : "success"} />
        </HorizonMetricGrid>

        <section className="hz-surface min-w-0 overflow-hidden" aria-label="翻译词条工作台">
          <HorizonSectionHeader
            Icon={Languages}
            title="翻译词条"
            description="按中文或英文检索，并通过模块与校准状态缩小范围；点击英文内容可直接编辑。"
            trailing={<span className="text-xs text-slate-500 tabular-nums">显示 {visible.length} / {rows.length} 条</span>}
          />

          <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(240px,1fr)_220px_180px_auto] sm:p-5">
            <div className="min-w-0">
              <label htmlFor="i18n-keyword" className="mb-1.5 block text-xs font-semibold text-slate-700">搜索词条</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <Input
                  id="i18n-keyword"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索中文或英文"
                  className="pl-9"
                />
              </div>
            </div>

            <div>
              <label id="i18n-module-filter-label" className="mb-1.5 block text-xs font-semibold text-slate-700">所属模块</label>
              <Select value={moduleFilter} onValueChange={setModuleFilter}>
                <SelectTrigger className="w-full" aria-labelledby="i18n-module-filter-label">
                  <SelectValue placeholder="全部模块" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">全部模块</SelectItem>
                  {modules.map((module) => <SelectItem key={module} value={module}>{module}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label id="i18n-status-filter-label" className="mb-1.5 block text-xs font-semibold text-slate-700">校准状态</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full" aria-labelledby="i18n-status-filter-label">
                  <SelectValue placeholder="全部状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="missing">缺英文</SelectItem>
                  <SelectItem value="ai">AI 初翻</SelectItem>
                  <SelectItem value="human">已人工校准</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button type="button" variant="outline" className="w-full lg:w-auto" onClick={clearFilters} disabled={!hasActiveFilters}>
                <X className="size-4" aria-hidden="true" />
                清除筛选
              </Button>
            </div>
          </div>

          {loadError && rows.length > 0 ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:px-5">
              <span className="flex min-w-0 items-center gap-2 text-pretty">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                本次刷新失败，当前仍显示上次数据：{loadError}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => void load()}>重新加载</Button>
            </div>
          ) : null}

          <div className="max-h-[62vh] overflow-auto">
            <table className="w-full min-w-[880px] border-collapse text-left text-sm">
              <caption className="sr-only">中英文界面字典词条、所属模块、校准状态及可用操作</caption>
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th scope="col" className="w-[30%] border-b border-slate-200 px-4 py-3">中文原文</th>
                  <th scope="col" className="w-[38%] border-b border-slate-200 px-4 py-3">英文</th>
                  <th scope="col" className="w-44 border-b border-slate-200 px-4 py-3">所属页面</th>
                  <th scope="col" className="w-32 border-b border-slate-200 px-4 py-3">状态</th>
                  <th scope="col" className="w-28 border-b border-slate-200 px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                      <span role="status" aria-live="polite" className="inline-flex items-center gap-2 text-sm">
                        <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        正在加载翻译词条…
                      </span>
                    </td>
                  </tr>
                ) : visible.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-0">
                      <HorizonEmptyState
                        Icon={hasActiveFilters ? Search : Languages}
                        title={hasActiveFilters ? "没有匹配的翻译词条" : loadError ? "翻译词条加载失败" : "暂无翻译词条"}
                        description={hasActiveFilters ? "调整搜索词或恢复全部模块与状态后重试。" : loadError ? loadError : "刷新服务端字典，确认是否已有可维护的界面文案。"}
                        action={(
                          <Button type="button" variant="outline" onClick={hasActiveFilters ? clearFilters : () => void load()}>
                            {hasActiveFilters ? "清除筛选" : "重新加载"}
                          </Button>
                        )}
                      />
                    </td>
                  </tr>
                ) : visible.map((row) => {
                  const editing = editingKey === row.zh;
                  const meta = STATUS_META[row.status];
                  return (
                    <tr key={row.zh} className="group hover:bg-blue-50/40">
                      <td className="max-w-[320px] border-b border-slate-100 px-4 py-3 text-slate-800">
                        <span className="line-clamp-2 break-all text-pretty">{row.zh}</span>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        {editing ? (
                          <div className="flex items-center gap-1.5">
                            <Input
                              autoFocus
                              value={editingValue}
                              onChange={(event) => setEditingValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") void saveEntry(row.zh, editingValue);
                                if (event.key === "Escape") closeEditor(row.zh);
                              }}
                              aria-label={`编辑“${row.zh}”的英文翻译`}
                              className="h-8 text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => void saveEntry(row.zh, editingValue)}
                              disabled={savingKey === row.zh}
                              aria-label={`保存“${row.zh}”的英文翻译`}
                              title="保存（Enter）"
                              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-green-700 transition-colors hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {savingKey === row.zh ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => closeEditor(row.zh)}
                              aria-label={`取消编辑“${row.zh}”`}
                              title="取消（Esc）"
                              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                            >
                              <X className="size-4" aria-hidden="true" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setEditingKey(row.zh); setEditingValue(row.en); }}
                            aria-label={`编辑“${row.zh}”的英文翻译`}
                            className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          >
                            <span className={cn("min-w-0 flex-1 break-all text-pretty", row.en ? "text-slate-700" : "text-slate-400")}>{row.en || "（未翻译）"}</span>
                            <Pencil className="size-3.5 shrink-0 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" aria-hidden="true" />
                          </button>
                        )}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 text-xs text-slate-500">{row.module || "—"}</td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", meta.cls)}>{meta.label}</span>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => void translateOne(row.zh)}
                          disabled={translatingKey === row.zh}
                          aria-label={`使用 AI 重翻“${row.zh}”`}
                          title="AI 重翻此条（带术语基准与 UX Writer 校对）"
                          className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {translatingKey === row.zh ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Bot className="size-3.5" aria-hidden="true" />}
                          AI 重翻
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

export default I18nManagementPage;
