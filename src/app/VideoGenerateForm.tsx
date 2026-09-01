import { useCallback, useEffect, useRef, useState } from "react";
import { CircleDollarSign, ImagePlus, Loader2, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "./components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { cn } from "./components/ui/utils";
import { uploadResourceFile } from "./lib/resourceUpload";
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
  return uploadResourceFile(file, "uploads-temp");
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

  const readinessMessage = submitting
    ? "正在提交视频生成任务…"
    : uploading
      ? "参考图片仍在上传，请等待上传完成。"
      : !prompt.trim()
        ? "填写提示词后即可提交生成任务。"
        : needImage && readyFileIds.length < 1
          ? mode === "i2v"
            ? "图生视频需要上传 1 张首帧图。"
            : "参考生视频至少需要上传 1 张参考图。"
          : gate?.blocked
            ? "当前预算不足，请联系管理员调整视频预算。"
            : "参数已就绪，可以提交生成任务。";

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
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
      {/* 左：表单 */}
      <div className="min-w-0 space-y-5">
        {/* 模式 */}
        <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
          <TabsList aria-label="视频生成方式" className="grid h-auto w-full grid-cols-1 gap-2 bg-transparent p-0 sm:grid-cols-3">
            {MODE_TABS.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className="h-auto min-h-16 flex-col items-start rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left whitespace-normal data-[state=active]:border-[#002fa7] data-[state=active]:bg-[#eef3ff] data-[state=active]:text-[#002fa7]"
              >
                <span className="text-sm font-semibold">{item.label}</span>
                <span className="text-pretty text-xs font-normal text-slate-500">{item.hint}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* 图片上传 */}
        {needImage && (
          <div role="group" aria-labelledby="video-reference-images-label">
            <div id="video-reference-images-label" className="mb-2 text-xs font-semibold text-slate-700">
              {mode === "i2v" ? "首帧图（1 张）" : `参考图（1~9 张，已 ${readyFileIds.length}）`}
            </div>
            <div className="flex flex-wrap gap-2">
              {images.map((im) => (
                <div key={im.localId} className="relative size-20 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  <img src={im.previewUrl} alt={im.name} className="h-full w-full object-cover" />
                  {im.status === "uploading" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="size-4 animate-spin text-white motion-reduce:animate-none" />
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
                    aria-label={`移除参考图 ${im.name}`}
                    className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-slate-950/70 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              {images.length < maxImages && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  aria-label={mode === "i2v" ? "上传首帧图" : "上传参考图"}
                  className="flex size-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 text-slate-500 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-[#002fa7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <ImagePlus className="size-5" />
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
              aria-label={mode === "i2v" ? "选择首帧图片" : "选择视频参考图片"}
              onChange={(e) => {
                void addFiles(e.target.files ? Array.from(e.target.files) : []);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {/* 提示词 */}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="video-generation-prompt" className="block text-xs font-semibold text-slate-700">
              提示词
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => reverseRef.current?.click()}
              disabled={reversing}
              title="上传一张图片或一段视频，AI 反推出提示词"
            >
              {reversing ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Wand2 className="size-3.5" />}
              {reversing ? "反推中..." : "图片/视频反推提示词"}
            </Button>
            <input
              ref={reverseRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              aria-label="选择用于反推提示词的图片或视频"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void handleReverse(f);
              }}
            />
          </div>
          <textarea
            id="video-generation-prompt"
            rows={4}
            className="material-input w-full resize-none text-sm leading-6"
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
            <label htmlFor="video-resolution" className="mb-2 block text-xs font-semibold text-slate-700">分辨率</label>
            <select id="video-resolution" value={resolution} onChange={(event) => setResolution(event.target.value)} className="material-input h-11 w-full rounded-xl px-3 text-sm text-slate-700">
              {RESOLUTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          {mode !== "i2v" && (
            <div>
              <label htmlFor="video-ratio" className="mb-2 block text-xs font-semibold text-slate-700">画面比例</label>
              <select id="video-ratio" value={ratio} onChange={(event) => setRatio(event.target.value)} className="material-input h-11 w-full rounded-xl px-3 text-sm text-slate-700">
                {RATIOS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          )}
          <div className="sm:col-span-2">
            <label htmlFor="video-duration" className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-700">
              <span>时长</span>
              <span className="tabular-nums text-[#002fa7]">{duration} 秒</span>
            </label>
            <input
              id="video-duration"
              type="range"
              min={3}
              max={15}
              step={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              aria-valuetext={`${duration} 秒`}
              className="w-full accent-[#002fa7]"
            />
          </div>
        </div>

        <label htmlFor="video-watermark" className="flex items-center gap-2 text-sm text-slate-600">
          <input id="video-watermark" type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} className="size-4 accent-[#002fa7]" />
          添加水印
        </label>
      </div>

      {/* 右：预估 + 提交 */}
      <aside className="min-w-0 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><CircleDollarSign className="size-4 text-[#002fa7]" />本次生成</div>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">模式</dt>
              <dd className="text-slate-800">{MODE_TABS.find((m) => m.value === mode)?.label}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">规格</dt>
              <dd className="tabular-nums text-slate-800">{resolution} · {duration}s{mode !== "i2v" ? ` · ${ratio}` : ""}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">预计消耗</dt>
              <dd className="font-semibold tabular-nums text-[#002fa7]">
                {gate ? `¥${gate.estimate_yuan}` : "—"}
              </dd>
            </div>
            {gate?.remaining_yuan != null && (
              <div className="flex justify-between">
                <dt className="text-slate-500">剩余预算</dt>
                <dd className={cn("tabular-nums", gate.blocked ? "font-semibold text-rose-600" : "text-slate-800")}>
                  ¥{gate.remaining_yuan}
                </dd>
              </div>
            )}
          </dl>
          {gate?.blocked && (
            <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700">
              预算不足，无法提交，请联系管理员调整视频预算。
            </p>
          )}
        </div>

        <Button
          type="button"
          size="lg"
          className="hz-primary-action w-full text-base"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit || gate?.blocked}
        >
          {submitting ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" /> : <Sparkles className="size-5" />}
          {submitting ? "提交中..." : "生成视频"}
        </Button>
        <p role="status" className={cn("text-center text-pretty text-xs", canSubmit && !gate?.blocked ? "text-emerald-700" : "text-slate-500")}>{readinessMessage}</p>
        <p className="text-center text-pretty text-xs text-slate-500">
          视频为分钟级异步任务，提交后可切到「视频作品库」查看进度，完成后站内通知。
        </p>
      </aside>
    </div>
  );
}
