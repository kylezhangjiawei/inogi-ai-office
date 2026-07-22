import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  AlertCircle,
  Clapperboard,
  Film,
  Loader2,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "./auth";
import { hasPermission } from "./lib/permissions";
import { cn } from "./components/ui/utils";
import { MaterialSelect } from "./components/MaterialFields";
import { VideoGenerateForm } from "./VideoGenerateForm";
import {
  videoGenerationApi,
  type VideoCostGateConfig,
  type VideoTask,
  type VideoTaskStatus,
} from "./lib/videoGenerationApi";

const PAGE_SIZE = 12;
const POLL_INTERVAL_MS = 15_000;

const MODE_LABEL: Record<string, string> = {
  i2v: "图生视频",
  t2v: "文生视频",
  r2v: "参考生视频",
};

const STATUS_META: Record<VideoTaskStatus, { label: string; tone: string }> = {
  pending: { label: "排队中", tone: "bg-slate-100 text-slate-600" },
  running: { label: "生成中", tone: "bg-sky-50 text-sky-700" },
  succeeded: { label: "已完成", tone: "bg-emerald-50 text-emerald-700" },
  failed: { label: "失败", tone: "bg-rose-50 text-rose-700" },
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** 管理端成本闸门配置面板 */
function CostGatePanel() {
  const [config, setConfig] = useState<VideoCostGateConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setConfig(await videoGenerationApi.getCostGateConfig());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取闸门配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !config) void load();
  }, [open, config, load]);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      const saved = await videoGenerationApi.saveCostGateConfig({
        mode: config.mode,
        autoThresholdYuan: config.autoThresholdYuan,
        budgetCapYuan: config.budgetCapYuan,
      });
      setConfig(saved);
      toast.success("成本闸门配置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="material-card p-6">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-900">视频成本闸门</h3>
        </div>
        <span className="text-sm text-slate-400">{open ? "收起" : "展开"}</span>
      </button>

      {open && (
        <div className="mt-5">
          {loading || !config ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> 读取中...
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  闸门模式
                </label>
                <MaterialSelect
                  value={config.mode}
                  onValueChange={(v) =>
                    setConfig({ ...config, mode: v as VideoCostGateConfig["mode"] })
                  }
                  options={[
                    { value: "off", label: "关闭 — 不拦，直接生成" },
                    { value: "threshold", label: "阈值 — 超过阈值才确认" },
                    { value: "always", label: "始终 — 每次都确认" },
                  ]}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  自动放行阈值（元）
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className="material-input w-full"
                  value={config.autoThresholdYuan}
                  disabled={config.mode !== "threshold"}
                  onChange={(e) =>
                    setConfig({ ...config, autoThresholdYuan: Number(e.target.value) || 0 })
                  }
                />
                <p className="mt-1.5 text-xs text-slate-400">预计消耗 ≤ 此值免确认（仅阈值模式生效）</p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  预算上限（元）
                </label>
                <input
                  type="number"
                  min={0}
                  step={100}
                  className="material-input w-full"
                  value={config.budgetCapYuan ?? ""}
                  placeholder="不填 = 不设上限"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setConfig({ ...config, budgetCapYuan: e.target.value && n > 0 ? n : null });
                  }}
                />
                <p className="mt-1.5 text-xs text-slate-400">超预算的生成会被拦在确认卡并提示</p>
              </div>
            </div>
          )}
          {config && (
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="material-button-primary"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? "保存中..." : "保存配置"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function VideoLibraryPage() {
  const { user } = useAuth();
  const isAdmin = hasPermission(user?.permissions ?? [], "page:ai-model-management");

  const [items, setItems] = useState<VideoTask[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 从通知跳转进来时携带 ?video=<id>：加载后滚动到该视频并高亮
  const [searchParams] = useSearchParams();
  const targetVideoId = searchParams.get("video");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // 从通知跳转进来直接看库，否则默认停在生成工作台
  const [tab, setTab] = useState<"generate" | "library">(targetVideoId ? "library" : "generate");

  const load = useCallback(
    async (targetPage = page, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await videoGenerationApi.listVideos(targetPage, PAGE_SIZE);
        setItems(res.items);
        setTotal(res.total);
        setTotalPages(Math.max(1, res.total_pages));
      } catch (error) {
        if (!silent) toast.error(error instanceof Error ? error.message : "读取视频列表失败");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [page],
  );

  useEffect(() => {
    void load(page);
  }, [page, load]);

  // 有未完成任务时轮询刷新（静默，不打扰）
  const hasActive = useMemo(
    () => items.some((it) => it.status === "pending" || it.status === "running"),
    [items],
  );

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (hasActive) {
      pollRef.current = setInterval(() => void load(page, true), POLL_INTERVAL_MS);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hasActive, page, load]);

  // 通知跳转定位：目标视频在当前列表时，滚动到它并短暂高亮
  useEffect(() => {
    if (!targetVideoId || !items.some((it) => it.id === targetVideoId)) return;
    const el = document.getElementById(`video-card-${targetVideoId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(targetVideoId);
    const timer = setTimeout(() => setHighlightId(null), 2600);
    return () => clearTimeout(timer);
  }, [targetVideoId, items]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-indigo-50 text-indigo-700">Video Studio</span>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[2rem] font-bold tracking-tight text-slate-900">
            <Clapperboard className="h-7 w-7 text-indigo-600" />
            视频工作台
          </h2>
          {tab === "library" && (
            <button
              type="button"
              className="material-button-secondary w-fit"
              onClick={() => void load(page)}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              刷新
            </button>
          )}
        </div>
        <p className="mt-2 text-sm leading-7 text-slate-600">
          直接在这里生成视频（文生 / 图生 / 参考生），或到「视频作品库」查看历史。视频为分钟级异步任务，完成后会站内通知你，也可在 MateChat 对话里生成。
        </p>
        <div className="mt-5 flex gap-2">
          {([
            ["generate", "生成视频"],
            ["library", "视频作品库"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                tab === value ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {tab === "generate" && (
        <section className="material-card p-6">
          <VideoGenerateForm
            onSubmitted={() => {
              setTab("library");
              setPage(1);
              void load(1);
            }}
          />
        </section>
      )}

      {tab === "library" && isAdmin && <CostGatePanel />}

      {tab === "library" && (
      <section className="material-card p-6">
        <div className="mb-5 flex items-center justify-between">
          <div className="text-sm text-slate-500">共 {total} 个视频任务</div>
        </div>

        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" /> 正在加载...
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-slate-400">
            <Film className="h-10 w-10" />
            <div className="text-sm">暂无视频任务。去 MateChat 里说「帮我把这张图做成一段视频」试试。</div>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const status = STATUS_META[item.status];
              return (
                <div
                  key={item.id}
                  id={`video-card-${item.id}`}
                  className={cn(
                    "overflow-hidden rounded-2xl border bg-white transition-shadow",
                    highlightId === item.id
                      ? "border-indigo-400 ring-2 ring-indigo-300 ring-offset-2"
                      : "border-slate-200",
                  )}
                >
                  <div className="flex aspect-video items-center justify-center bg-slate-900/95">
                    {item.status === "succeeded" && item.video_url ? (
                      <video
                        controls
                        preload="metadata"
                        className="h-full w-full object-contain"
                        src={item.video_url}
                      />
                    ) : item.status === "failed" ? (
                      <div className="flex flex-col items-center gap-2 px-4 text-center text-rose-300">
                        <AlertCircle className="h-8 w-8" />
                        <span className="line-clamp-3 text-xs">{item.error_message ?? "生成失败"}</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-slate-300">
                        <Loader2 className="h-8 w-8 animate-spin" />
                        <span className="text-xs">{status.label}，约需几分钟...</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="material-chip bg-violet-50 text-violet-700">
                        {MODE_LABEL[item.mode] ?? item.mode}
                      </span>
                      <span className={cn("material-chip", status.tone)}>{status.label}</span>
                    </div>
                    <p className="line-clamp-2 text-sm text-slate-700" title={item.prompt}>
                      {item.prompt || "（无描述）"}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                      <span>{item.resolution}</span>
                      <span>{item.duration}s</span>
                      {item.status === "succeeded" && <span>计费 ¥{item.cost_yuan}</span>}
                      <span>{formatDate(item.created_at)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              className="material-button-secondary !px-3 !py-2"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
            >
              上一页
            </button>
            <span className="text-sm text-slate-500">
              {page} / {totalPages}
            </span>
            <button
              className="material-button-secondary !px-3 !py-2"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || loading}
            >
              下一页
            </button>
          </div>
        )}
      </section>
      )}
    </div>
  );
}
