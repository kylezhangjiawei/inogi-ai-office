import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";

import { authFetch, readErrorMessage } from "./lib/authSession";
import { cn } from "./components/ui/utils";
import { MaterialSelect } from "./components/MaterialFields";
import { videoGenerationApi, type VideoGateEvaluation } from "./lib/videoGenerationApi";
import { extractVideoKeyframes, readImageAsDataUrl } from "./lib/videoFrames";

type Mode = "t2v" | "i2v" | "r2v";

type UploadedImage = {
  localId: string;
  fileId?: string;
  name: string;
  previewUrl: string;
  status: "uploading" | "done" | "error";
};

const MODE_TABS: Array<{ value: Mode; label: string; hint: string }> = [
  { value: "t2v", label: "文生视频", hint: "仅用文字描述生成" },
  { value: "i2v", label: "图生视频", hint: "上传 1 张图作首帧" },
  { value: "r2v", label: "参考生视频", hint: "上传 1~9 张参考图" },
];

const RESOLUTIONS = [
  { value: "720P", label: "720P" },
  { value: "1080P", label: "1080P" },
];

const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];

// 工作台上传上限（DashScope 首帧/参考图 ≤20MB）
const STUDIO_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

async function uploadImage(file: File): Promise<{ fileId: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("businessType", "uploads-temp");
  const res = await authFetch("/api/files/upload", { method: "POST", body: form });
  if (!res.ok) throw new Error(await readErrorMessage(res, "上传失败"));
  const data = (await res.json()) as { fileId: string };
  return data;
}

export function VideoGenerateForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [mode, setMode] = useState<Mode>("t2v");
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [resolution, setResolution] = useState("720P");
  const [duration, setDuration] = useState(5);
  const [ratio, setRatio] = useState("16:9");
  const [watermark, setWatermark] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [gate, setGate] = useState<VideoGateEvaluation | null>(null);
  const [reversing, setReversing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const reverseRef = useRef<HTMLInputElement>(null);

  const needImage = mode === "i2v" || mode === "r2v";
  const maxImages = mode === "i2v" ? 1 : mode === "r2v" ? 9 : 0;

  // 成本预估（分辨率/时长变化时刷新）
  useEffect(() => {
    let cancelled = false;
    void videoGenerationApi
      .costGate(resolution, duration)
      .then((g) => !cancelled && setGate(g))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [resolution, duration]);

  const addFiles = useCallback(
    async (files: File[]) => {
      const room = maxImages - images.length;
      if (room <= 0) {
        toast.error(`最多上传 ${maxImages} 张图`);
        return;
      }
      for (const file of files.slice(0, room)) {
        if (!file.type.startsWith("image/")) {
          toast.error(`「${file.name}」不是图片`);
          continue;
        }
        if (file.size > STUDIO_IMAGE_MAX_BYTES) {
          toast.error(`「${file.name}」超过 20MB`);
          continue;
        }
        const localId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const previewUrl = URL.createObjectURL(file);
        setImages((prev) => [...prev, { localId, name: file.name, previewUrl, status: "uploading" }]);
        try {
          const { fileId } = await uploadImage(file);
          setImages((prev) =>
            prev.map((im) => (im.localId === localId ? { ...im, fileId, status: "done" } : im)),
          );
        } catch (err) {
          setImages((prev) =>
            prev.map((im) => (im.localId === localId ? { ...im, status: "error" } : im)),
          );
          toast.error(err instanceof Error ? err.message : "上传失败");
        }
      }
    },
    [images.length, maxImages],
  );

  function removeImage(localId: string) {
    setImages((prev) => {
      const t = prev.find((im) => im.localId === localId);
      if (t) URL.revokeObjectURL(t.previewUrl);
      return prev.filter((im) => im.localId !== localId);
    });
  }

  function resetForm() {
    images.forEach((im) => URL.revokeObjectURL(im.previewUrl));
    setImages([]);
    setPrompt("");
  }

  // 从图片或视频反推提示词，填入提示词框
  const handleReverse = useCallback(async (file: File) => {
    setReversing(true);
    try {
      let dataUrls: string[];
      let kind: "image" | "video";
      if (file.type.startsWith("video/")) {
        dataUrls = await extractVideoKeyframes(file, 3);
        kind = "video";
      } else if (file.type.startsWith("image/")) {
        dataUrls = [await readImageAsDataUrl(file)];
        kind = "image";
      } else {
        toast.error("请选择图片或视频文件");
        return;
      }
      const { prompt: reversed } = await videoGenerationApi.reversePrompt(dataUrls, kind);
      setPrompt(reversed);
      toast.success("已反推出提示词，可直接编辑后生成");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "反推失败");
    } finally {
      setReversing(false);
    }
  }, []);

  const readyFileIds = images.filter((im) => im.status === "done" && im.fileId).map((im) => im.fileId!);
  const uploading = images.some((im) => im.status === "uploading");
  const canSubmit =
    !submitting &&
    !uploading &&
    prompt.trim().length > 0 &&
    (!needImage || readyFileIds.length >= 1) &&
    (mode !== "i2v" || readyFileIds.length === 1);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await videoGenerationApi.submit({
        mode,
        prompt: prompt.trim(),
        ...(needImage ? { source_file_ids: readyFileIds } : {}),
        resolution: resolution as "720P" | "1080P",
        ...(mode !== "i2v" ? { ratio } : {}),
        duration,
        watermark,
      });
      toast.success("视频任务已提交，生成约需几分钟，完成后站内通知你");
      resetForm();
      onSubmitted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      {/* 左：表单 */}
      <div className="space-y-5">
        {/* 模式 */}
        <div className="flex gap-2">
          {MODE_TABS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={cn(
                "flex-1 rounded-xl border px-3 py-2.5 text-left transition-colors",
                mode === m.value ? "border-indigo-300 bg-indigo-50/70" : "border-slate-200 hover:bg-slate-50",
              )}
            >
              <div className="text-sm font-semibold text-slate-800">{m.label}</div>
              <div className="mt-0.5 text-xs text-slate-400">{m.hint}</div>
            </button>
          ))}
        </div>

        {/* 图片上传 */}
        {needImage && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              {mode === "i2v" ? "首帧图（1 张）" : `参考图（1~9 张，已 ${readyFileIds.length}）`}
            </label>
            <div className="flex flex-wrap gap-2">
              {images.map((im) => (
                <div key={im.localId} className="relative h-20 w-20 overflow-hidden rounded-xl border border-slate-200">
                  <img src={im.previewUrl} alt={im.name} className="h-full w-full object-cover" />
                  {im.status === "uploading" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    </div>
                  )}
                  {im.status === "error" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-rose-500/60 text-[10px] text-white">
                      失败
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeImage(im.localId)}
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {images.length < maxImages && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 text-slate-400 hover:border-indigo-300 hover:text-indigo-500"
                >
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-[10px]">上传</span>
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple={mode === "r2v"}
              className="hidden"
              onChange={(e) => {
                void addFiles(e.target.files ? Array.from(e.target.files) : []);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {/* 提示词 */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              提示词
            </label>
            <button
              type="button"
              onClick={() => reverseRef.current?.click()}
              disabled={reversing}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/60 px-2.5 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-100 disabled:opacity-60"
              title="上传一张图片或一段视频，AI 反推出提示词"
            >
              {reversing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {reversing ? "反推中..." : "图片/视频反推提示词"}
            </button>
            <input
              ref={reverseRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void handleReverse(f);
              }}
            />
          </div>
          <textarea
            rows={4}
            className="material-input w-full resize-none"
            placeholder={
              mode === "r2v"
                ? "描述画面、动作、镜头；可用 [图1][图2] 指代参考图"
                : "描述画面、主体动作、镜头运动、风格光影…"
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        {/* 参数 */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">分辨率</label>
            <MaterialSelect value={resolution} onValueChange={setResolution} options={RESOLUTIONS} />
          </div>
          {mode !== "i2v" && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">画面比例</label>
              <MaterialSelect value={ratio} onValueChange={setRatio} options={RATIOS.map((r) => ({ value: r, label: r }))} />
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              <span>时长</span>
              <span className="text-slate-700">{duration} 秒</span>
            </label>
            <input
              type="range"
              min={3}
              max={15}
              step={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full accent-indigo-600"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} />
          添加水印
        </label>
      </div>

      {/* 右：预估 + 提交 */}
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
          <div className="text-sm font-semibold text-slate-800">本次生成</div>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">模式</dt>
              <dd className="text-slate-800">{MODE_TABS.find((m) => m.value === mode)?.label}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">规格</dt>
              <dd className="text-slate-800">{resolution} · {duration}s{mode !== "i2v" ? ` · ${ratio}` : ""}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">预计消耗</dt>
              <dd className="font-semibold text-indigo-600">
                {gate ? `¥${gate.estimate_yuan}` : "—"}
              </dd>
            </div>
            {gate?.remaining_yuan != null && (
              <div className="flex justify-between">
                <dt className="text-slate-500">剩余预算</dt>
                <dd className={cn(gate.blocked ? "font-semibold text-rose-600" : "text-slate-800")}>
                  ¥{gate.remaining_yuan}
                </dd>
              </div>
            )}
          </dl>
          {gate?.blocked && (
            <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">
              预算不足，无法提交，请联系管理员调整视频预算。
            </p>
          )}
        </div>

        <button
          type="button"
          className="material-button-primary w-full justify-center py-3 text-base disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit || gate?.blocked}
        >
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
          {submitting ? "提交中..." : "生成视频"}
        </button>
        <p className="text-center text-xs text-slate-400">
          视频为分钟级异步任务，提交后可切到「视频作品库」查看进度，完成后站内通知。
        </p>
      </div>
    </div>
  );
}
