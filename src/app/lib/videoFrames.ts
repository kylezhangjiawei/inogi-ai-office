/**
 * 浏览器端从图片/视频提取 base64 data URL，用于「反推提示词」。
 * 视频抽帧走 <video> + canvas，无需 ffmpeg 等依赖。
 */

/** 读取图片文件为 JPEG data URL（最长边压到 1024，控制体积） */
export async function readImageAsDataUrl(file: File, maxEdge = 1024): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}

/** 视频体积上限：过大浏览器解码/抽帧成本高，直接拒绝 */
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
const META_LOAD_TIMEOUT_MS = 15_000;
const SEEK_TIMEOUT_MS = 10_000;

/** 给 Promise 加超时，超时抛出可读错误，避免某些编码/浏览器下 seek 永不回调导致卡死 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** 从视频文件按时间均匀抽取 count 张关键帧（JPEG data URL） */
export async function extractVideoKeyframes(file: File, count = 3, maxEdge = 1024): Promise<string[]> {
  if (file.size > VIDEO_MAX_BYTES) {
    throw new Error("视频过大（>200MB），请压缩后再试");
  }
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("视频解码失败，请换一个格式（建议 MP4/H.264）"));
      }),
      META_LOAD_TIMEOUT_MS,
      "读取视频超时，请换一个格式（建议 MP4/H.264）",
    );
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (duration === 0 || !video.videoWidth) throw new Error("无法读取视频画面");

    const times =
      count <= 1
        ? [duration / 2]
        : Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count);

    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布");

    const frames: string[] = [];
    for (const t of times) {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            resolve();
          };
          video.addEventListener("seeked", onSeeked);
          video.onerror = () => reject(new Error("视频抽帧失败"));
          video.currentTime = Math.min(t, Math.max(0, duration - 0.05));
        }),
        SEEK_TIMEOUT_MS,
        "视频抽帧超时，请换一个更短或更常见格式的视频",
      );
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.8));
    }
    if (frames.length === 0) throw new Error("未能从视频中抽取到画面");
    return frames;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
  }
}
