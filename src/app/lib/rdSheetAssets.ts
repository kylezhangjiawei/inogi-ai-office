/**
 * 研发数据表快照「图片出仓」：把快照里内嵌的 base64 图片（单元格图 / 浮动图）
 * 上传到 OSS，并把快照中的图源替换为同源永久资产 URL。
 *
 * 为什么：整簿快照连图片一起走 JSON 往返，线上已超 25MB，是「打开慢 / 保存超时丢数据」
 * 的根因。出仓后快照只剩文本与样式（MB 级 → 百 KB 级），图片按需加载且可被浏览器长缓存。
 *
 * 容错原则：任何一张图上传失败都保留其 base64 原样（功能不受影响，只是快照没瘦下来）；
 * OSS 未配置时服务端返回 oss_disabled，本次直接整体跳过，不再逐张浪费上传。
 */
import { uploadRdSheetAsset } from "./rdApi";
import type { RdSheetAssetRenewal } from "./rdApi";

/** Univer 图片对象的最小形状：同时具备 source(dataURL) 与 imageSourceType 才视为图源持有者。 */
type ImageHolder = { source: string; imageSourceType: string };

/** Only image-holder fields are visited; ordinary cell strings and external resource payloads are opaque. */
export function replaceSheetImageSources(node: unknown, replacements: ReadonlyMap<string, string>): number {
  if (!node || typeof node !== "object") return 0;
  if (Array.isArray(node)) return node.reduce((count, value) => count + replaceSheetImageSources(value, replacements), 0);
  const record = node as Record<string, unknown>;
  let changed = 0;
  if (typeof record.source === "string" && typeof record.imageSourceType === "string") {
    const replacement = replacements.get(record.source);
    if (replacement && replacement !== record.source) { record.source = replacement; changed += 1; }
  }
  for (const value of Object.values(record)) changed += replaceSheetImageSources(value, replacements);
  return changed;
}

export function collectSheetImageSources(snapshot: unknown): string[] {
  const sources = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const record = node as Record<string, unknown>;
    if (typeof record.source === "string" && typeof record.imageSourceType === "string" &&
      !/^(data:|blob:)/i.test(record.source) && record.source.length <= 4096) sources.add(record.source);
    for (const value of Object.values(record)) visit(value);
  };
  visit(snapshot);
  const resources = (snapshot as { resources?: unknown[] } | null)?.resources;
  for (const resource of Array.isArray(resources) ? resources : []) {
    const data = (resource as { data?: unknown } | null)?.data;
    if (typeof data === "string" && data.includes("imageSourceType")) {
      try { visit(JSON.parse(data)); } catch { /* Unrelated plugin payload. */ }
    }
  }
  return [...sources];
}

export type SheetAssetEditor = {
  getImageSources: () => string[];
  applyImageSources: (replacements: ReadonlyMap<string, string>) => boolean;
};

/** Univer 0.25: use local mutations, so URL maintenance neither creates undo entries nor resets selections. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyUniverImageSources(api: any, drawingService: any, replacements: ReadonlyMap<string, string>): boolean {
  const workbook = api?.getActiveWorkbook?.();
  if (!workbook || workbook.isCellEditing?.()) return false;
  const unitId = workbook.getId();
  const snapshot = workbook.save();
  let success = true;
  for (const [subUnitId, sheet] of Object.entries(snapshot.sheets ?? {})) {
    const cellValue: Record<string, Record<string, unknown>> = {};
    // Only the current cell's document is patched; values, formulas, styles, row heights and current edits survive.
    for (const [row, cells] of Object.entries((sheet as { cellData?: Record<string, Record<string, unknown>> }).cellData ?? {})) {
      for (const [column, cell] of Object.entries(cells)) {
        const document = (cell as { p?: unknown } | null)?.p;
        if (!document) continue;
        const copied = JSON.parse(JSON.stringify(document));
        if (replaceSheetImageSources(copied, replacements)) (cellValue[row] ??= {})[column] = { p: copied };
      }
    }
    if (Object.keys(cellValue).length) success = api.syncExecuteCommand("sheet.mutation.set-range-values", {
      unitId, subUnitId, cellValue, trigger: "rd-sheet-assets.renew",
    }, { onlyLocal: true }) !== false && success;
  }
  const drawings = drawingService?.getDrawingDataForUnit(unitId) ?? {};
  for (const entry of Object.values(drawings)) {
    const changed = [];
    for (const drawing of Object.values((entry as { data?: Record<string, unknown> }).data ?? {})) {
      const copied = JSON.parse(JSON.stringify(drawing));
      if (replaceSheetImageSources(copied, replacements)) changed.push(copied);
    }
    if (!changed.length) continue;
    const operation = drawingService.getBatchUpdateOp(changed);
    success = api.syncExecuteCommand("sheet.mutation.set-drawing-apply", {
      unitId: operation.unitId, subUnitId: operation.subUnitId, op: operation.redo, objects: operation.objects, type: 2,
    }, { onlyLocal: true }) !== false && success;
  }
  return success;
}

type RenewalEnvironment = {
  now: () => number;
  hidden: () => boolean;
  setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  onVisible: (callback: () => void) => () => void;
};

/** One bounded renewal loop per mounted editor. It only patches current sources, never reloads workbook data. */
export function startSheetAssetRenewal(options: {
  getEditor: () => SheetAssetEditor | null;
  renew: (sources: string[], signal: AbortSignal) => Promise<RdSheetAssetRenewal[]>;
  onFailure: () => void;
}, env: RenewalEnvironment = {
  now: Date.now, hidden: () => document.hidden, setTimer: setTimeout, clearTimer: clearTimeout,
  onVisible: (callback) => { document.addEventListener("visibilitychange", callback); return () => document.removeEventListener("visibilitychange", callback); },
}): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const dueAt = new Map<string, number>();
  const pending = new Map<string, string>();
  const schedule = (delay = 60_000) => {
    if (timer !== undefined) env.clearTimer(timer);
    timer = undefined;
    if (!stopped && !env.hidden()) timer = env.setTimer(() => { void run(); }, delay);
  };
  const run = async () => {
    if (stopped || running || env.hidden()) return;
    const editor = options.getEditor();
    if (!editor) { schedule(1000); return; }
    running = true;
    controller = new AbortController();
    try {
      const sources = editor.getImageSources();
      const current = new Set(sources);
      for (const source of dueAt.keys()) if (!current.has(source)) dueAt.delete(source);
      for (const source of pending.keys()) if (!current.has(source)) pending.delete(source);
      if (pending.size && editor.applyImageSources(pending)) pending.clear();
      const due = sources.filter((source) => !pending.has(source) && (dueAt.get(source) ?? 0) <= env.now()).slice(0, 1000);
      for (let offset = 0; offset < due.length; offset += 100) {
        if (stopped || env.hidden()) break;
        const batch = due.slice(offset, offset + 100);
        const results = await options.renew(batch, controller.signal);
        if (stopped || options.getEditor() !== editor) return;
        // Rejected/unmanaged references are left alone and retried only after a bounded cooldown.
        for (const source of batch) dueAt.set(source, env.now() + 10 * 60_000);
        for (const item of results) {
          if (!batch.includes(item.source) || !item.url || !Number.isFinite(item.expires_in) || item.expires_in <= 0) continue;
          const nextDue = env.now() + Math.max(30_000, item.expires_in * 1000 - 120_000);
          dueAt.set(item.source, nextDue);
          dueAt.set(item.url, nextDue);
          pending.set(item.source, item.url);
        }
        if (pending.size && !env.hidden() && editor.applyImageSources(pending)) pending.clear();
      }
    } catch {
      if (!stopped && !controller.signal.aborted) options.onFailure();
    } finally {
      running = false;
      controller = undefined;
      schedule();
    }
  };
  const removeVisibility = env.onVisible(() => {
    if (env.hidden()) { if (timer !== undefined) env.clearTimer(timer); timer = undefined; }
    else if (!running) schedule(0);
  });
  schedule(0);
  return () => {
    stopped = true;
    controller?.abort();
    if (timer !== undefined) env.clearTimer(timer);
    removeVisibility();
    dueAt.clear(); pending.clear();
  };
}

export type RdSheetAssetStats = {
  /** 快照中发现的 base64 图片总数（按去重后的唯一图源计） */
  total: number;
  /** 成功上传并替换为 URL 的数量 */
  uploaded: number;
  /** 上传失败、保留 base64 的数量 */
  failed: number;
};

/** 小于此长度的 base64 图源不出仓：URL+一次请求的开销超过收益（微型图标等）。 */
const MIN_SOURCE_LENGTH = 4096;

function isImageHolder(rec: Record<string, unknown>): rec is Record<string, unknown> & ImageHolder {
  return (
    typeof rec.source === "string" &&
    rec.source.startsWith("data:image/") &&
    // SVG 可内嵌脚本，服务端资产白名单会拒收；留 base64 内嵌即可，不浪费一次上传
    !rec.source.startsWith("data:image/svg") &&
    rec.source.length >= MIN_SOURCE_LENGTH &&
    typeof rec.imageSourceType === "string"
  );
}

/** 深度遍历收集所有 base64 图源持有者（cellData[r][c].p 内嵌图与解析后的浮动图资源均覆盖）。 */
function collectImageHolders(node: unknown, out: Array<Record<string, unknown> & ImageHolder>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectImageHolders(item, out);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (isImageHolder(rec)) {
    out.push(rec);
    return;
  }
  for (const value of Object.values(rec)) collectImageHolders(value, out);
}

function extFromMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("svg")) return "svg";
  if (mime.includes("bmp")) return "bmp";
  return "png";
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  // 浏览器原生支持 fetch data: URL，比手写 atob 分块解码更快且省内存
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * 抽取并替换快照中的 base64 图片。**原地修改** snapshot。
 *
 * @param cache 会话级缓存（dataURL → 上传后 URL / null=失败）。同一图片在多次保存间只上传一次；
 *              编辑器内存里的图源仍是 base64，不用缓存的话每次保存都会重复上传。
 * @param onProgress 上传进度回调（唯一图源维度）。
 */
export async function externalizeSnapshotImages(
  snapshot: Record<string, unknown>,
  cache: Map<string, string | null>,
  onProgress?: (done: number, total: number) => void,
): Promise<RdSheetAssetStats> {
  const holders: Array<Record<string, unknown> & ImageHolder> = [];

  // resources 里的浮动图是「JSON 字符串」形态，通用遍历看不进去：先解析、遍历、上传后再序列化回写。
  const resources = Array.isArray(snapshot.resources)
    ? (snapshot.resources as Array<Record<string, unknown>>)
    : [];
  const parsedResources: Array<{ holder: Record<string, unknown>; parsed: unknown }> = [];
  for (const res of resources) {
    if (typeof res?.data === "string" && res.data.includes("data:image/")) {
      try {
        const parsed = JSON.parse(res.data) as unknown;
        collectImageHolders(parsed, holders);
        parsedResources.push({ holder: res, parsed });
      } catch {
        /* 解析失败原样保留 */
      }
    }
  }

  // 其余部分（sheets.cellData[r][c].p 的单元格图等）直接遍历对象树；
  // 排除 resources 字段避免把字符串形态的资源重复处理。
  for (const [key, value] of Object.entries(snapshot)) {
    if (key === "resources") continue;
    collectImageHolders(value, holders);
  }

  if (holders.length === 0) return { total: 0, uploaded: 0, failed: 0 };

  // 按图源内容去重：同一张图（复制粘贴多处）只上传一次
  const uniqueSources: string[] = [];
  for (const h of holders) {
    if (!cache.has(h.source) && !uniqueSources.includes(h.source)) uniqueSources.push(h.source);
  }

  let done = 0;
  let ossDisabled = false;
  const report = () => onProgress?.(done, uniqueSources.length);
  report();

  // 4 路并发上传：单张失败/OSS 关闭均不中断整体保存流程
  const queue = [...uniqueSources];
  const worker = async () => {
    for (;;) {
      const source = queue.shift();
      if (source === undefined) return;
      if (ossDisabled) {
        cache.set(source, null);
        done += 1;
        report();
        continue;
      }
      try {
        const mime = source.slice(5, source.indexOf(";"));
        const blob = await dataUrlToBlob(source);
        const result = await uploadRdSheetAsset(blob, `image.${extFromMime(mime)}`, mime);
        if (result.url) {
          cache.set(source, result.url);
        } else {
          cache.set(source, null);
          if (result.reason === "oss_disabled") ossDisabled = true;
        }
      } catch {
        cache.set(source, null);
      }
      done += 1;
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));

  // 统一替换：URL 化成功的改图源与类型；失败的保留 base64（不影响功能）
  let uploaded = 0;
  let failed = 0;
  const replacedSources = new Set<string>();
  const failedSources = new Set<string>();
  for (const h of holders) {
    const url = cache.get(h.source);
    if (typeof url === "string" && url) {
      if (!replacedSources.has(h.source)) replacedSources.add(h.source);
      h.source = url;
      h.imageSourceType = "URL";
    } else {
      failedSources.add(h.source);
    }
  }
  uploaded = replacedSources.size;
  failed = failedSources.size;

  // 浮动图资源序列化回写
  for (const { holder, parsed } of parsedResources) {
    try {
      holder.data = JSON.stringify(parsed);
    } catch {
      /* 序列化失败原样保留 */
    }
  }

  return { total: replacedSources.size + failedSources.size, uploaded, failed };
}
