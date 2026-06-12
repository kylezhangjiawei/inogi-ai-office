import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import {
  Download,
  FileSpreadsheet,
  ImagePlus,
  Info,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { useAuth } from "./auth";
import { hasPermission, PERMISSIONS } from "./lib/permissions";
import { Button } from "./components/ui/button";
import { cn } from "./components/ui/utils";
import {
  fetchRdSheet,
  fetchRdSheets,
  saveAllRdSheets,
  uploadRdSheetImages,
  type RdSheet,
} from "./lib/rdApi";
import type { RDSheetUniverHandle } from "./RDSheetUniver";

// Univer 编辑器体积大且仅编辑者需要：惰性加载，普通成员永不触达此 chunk（含 CSS）。
const LazyUniverEditor = React.lazy(() => import("./RDSheetUniver"));

/**
 * 研发数据表（类 WPS 表格 · 行级密级管控）。
 *
 * 安全模型（后端强制，前端无法绕过）：
 * - 读取时后端按 viewer 的 kb_level 分值做「行级裁剪」——只下发密级 <= 自己的行，
 *   且把「密级」列整列删掉。所以非编辑者拿到的 headers/rows 本身就是脱敏后的子集，
 *   前端只负责忠实展示，不做任何隐藏逻辑（隐藏逻辑放前端会被 devtools/network 看穿）。
 * - 编辑权限（rd-sheet:edit / 超管）= 完全访问：后端不裁剪、可保存全量。
 *
 * 编辑器：
 * - 编辑者使用 Univer Sheets（惰性加载，见 RDSheetUniver.tsx），保存时按「第 0 行表头 + 其后数据行」
 *   的规整二维结构读回单元格字面值，以兼容行级密级管控。
 * - Univer 加载/渲染失败时由 UniverErrorBoundary 回退到内置基础 HTML 表格（EditableTable），编辑不中断。
 * - 普通成员走轻量只读表格（ReadOnlyTable），不加载 Univer。
 *
 * 多工作表（workbook）：
 * - 页面承载多张数据表（与 WPS/Excel 的多 sheet 对应）。Univer 模式用其原生底部 tab 切换；
 *   只读视图与 HTML 兜底模式用页面自绘的 SheetTabs 切换。
 * - 导入即整簿导入：文件的每个工作表成为一张数据表；保存/撤销也按整簿处理。
 */

type Draft = {
  id: string;
  name: string;
  headers: string[];
  rows: string[][];
  secrecy_column: string;
};

// 单元格图片标记（与后端约定一致）：[图片:objectKey]，图片本体在 OSS。
// 标记随行走 → 行级密级裁剪天然作用于图片；预览 URL 由后端只为可见行内的 key 签发。
const IMAGE_MARK_RE = /\[图片:([^\[\]\s]+)\]/g;
// 本地暂存图片（粘贴/插入/导入产生，尚未上传）：单元格先写 [图片:local-xxx] 临时标记、
// 以 blob URL 即时预览；点「保存」时统一上传并替换为正式 objectKey 后才落库。
const LOCAL_MARK_RE = /\[图片:(local-[^\[\]\s]+)\]/g;
// 导入解析阶段先用控制字符占位符标记图片落点，确认导入后替换为本地暂存标记。
const IMPORT_IMG_PH = (n: number) => `\u0000IMG:${n}\u0000`;
const IMPORT_IMG_PH_RE = /\u0000IMG:(\d+)\u0000/g;
// 提取 WPS 单元格内嵌图片公式 =DISPIMG("ID_xxx",1) 的 ID（兼容 =_xlfn./=@ 等前缀变体）。
const DISPIMG_ID_RE = /^=.*DISPIMG\s*\(\s*"([^"]+)"/i;
// 图片自然宽高编码进上传文件名前缀 w{W}h{H}-：后端 key 保留原文件名（{hash}-{原名}），
// 重新打开页面时从 key 反解宽高即可把纯图片格渲染成等比缩略图，无需任何后端改动。
// hash 是纯 hex（不含 w/h 字符），不会误匹配到 hash 段。
const KEY_DIMS_RE = /-w(\d+)h(\d+)-/;

/** 读取图片自然宽高（解码失败返回 null，对应单元格退回文本标记显示）。 */
async function readImageDims(blob: Blob): Promise<{ w: number; h: number } | null> {
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(blob);
      const dims = { w: bmp.width, h: bmp.height };
      bmp.close();
      if (dims.w > 0 && dims.h > 0) return dims;
    }
  } catch {
    /* 走 <img> 兜底 */
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(
        img.naturalWidth > 0 && img.naturalHeight > 0
          ? { w: img.naturalWidth, h: img.naturalHeight }
          : null,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function toDraft(sheet: RdSheet): Draft {
  return {
    id: sheet.id,
    name: sheet.name,
    headers: [...sheet.headers],
    rows: sheet.rows.map((r) => [...r]),
    secrecy_column: sheet.secrecy_column,
  };
}

type EditorMode = "univer" | "fallback";

/**
 * Univer 加载/渲染失败时的兜底：捕获错误并回退到基础 HTML 表格，保证编辑能力不中断。
 * （无法在本环境验证 Univer 真机渲染，故 fallback 是必备保险。）
 */
class UniverErrorBoundary extends React.Component<
  { fallback: React.ReactNode; onError?: () => void; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("[RDSheet] Univer 加载/渲染失败，已回退到基础表格：", error);
    this.props.onError?.();
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export function RDSheetPage() {
  const { user } = useAuth();
  const userPerms = user?.permissions ?? [];
  const canEdit = hasPermission(userPerms, PERMISSIONS.RD_SHEET_EDIT);

  // 整簿状态：serverSheets = 已保存基线（撤销用）；drafts = 工作副本（与服务器同序）。
  const [serverSheets, setServerSheets] = useState<RdSheet[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  // 只读视图 / HTML 兜底模式的当前工作表下标（Univer 模式用其原生底部 tab，不读此值）。
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Univer 编辑器：默认走 Univer；加载/渲染失败时由 ErrorBoundary 切到 "fallback"（HTML 表格）。
  const [editorMode, setEditorMode] = useState<EditorMode>("univer");
  // 重挂载 Univer 用：撤销改动 / 导入时 +1，从当前 drafts 重新装载。
  const [reloadKey, setReloadKey] = useState(0);
  const univerHandleRef = useRef<RDSheetUniverHandle | null>(null);
  // 导入用：隐藏的文件选择器 + 导入结果提示。
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  // 单元格图片：objectKey → 预览 URL（同源 HMAC 代理、24h 时效）。
  // 后端只为「当前 viewer 可见行」内的图片签发；本地暂存图片以 local-id → blob URL 合并进来。
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  // 导入解析中（读 zip/提取图片，大文件需数秒）；保存时图片批量上传的进度。
  const [importing, setImporting] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  // 本地暂存图片注册表：local-id → 图片本体。uploadedKey 记录「已上传但尚未随保存落库」
  // 的正式 key（上传成功而保存失败时，重试保存不会重复上传）；dims 为异步解析出的
  // 自然宽高（dimsReady 解析完成的信号），编辑器据此把纯图片格渲染成等比缩略图。
  const localImagesRef = useRef(
    new Map<
      string,
      {
        blob: Blob;
        name: string;
        url: string;
        uploadedKey?: string;
        dims?: { w: number; h: number };
        dimsReady?: Promise<void>;
      }
    >(),
  );

  const mergeImageUrls = useCallback((more: Record<string, string> | undefined) => {
    if (!more || Object.keys(more).length === 0) return;
    setImageUrls((prev) => ({ ...prev, ...more }));
  }, []);

  /** 图片暂存到本地（不发网络请求）：注册 blob、生成即时预览 URL，返回临时引用 id。
   *  宽高在后台异步解析（写入编辑器前用 waitForLocalDims 等待就绪）。 */
  const registerLocalImage = useCallback(
    (blob: Blob, name: string): string => {
      const id = `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const url = URL.createObjectURL(blob);
      const entry: NonNullable<ReturnType<typeof localImagesRef.current.get>> = {
        blob,
        name,
        url,
      };
      entry.dimsReady = readImageDims(blob).then((dims) => {
        if (dims) entry.dims = dims;
      });
      localImagesRef.current.set(id, entry);
      mergeImageUrls({ [id]: url });
      return id;
    },
    [mergeImageUrls],
  );

  /** 等待一批本地暂存图片的宽高解析完成（解析失败的不阻塞，对应格退回文本标记）。 */
  const waitForLocalDims = useCallback(async (ids: string[]) => {
    await Promise.all(
      ids.map((id) => localImagesRef.current.get(id)?.dimsReady ?? Promise.resolve()),
    );
  }, []);

  /** 图片引用 → 自然宽高：本地暂存查注册表；正式 objectKey 从文件名前缀反解。 */
  const getImageDims = useCallback((ref: string): { w: number; h: number } | null => {
    const ent = localImagesRef.current.get(ref);
    if (ent?.dims) return ent.dims;
    const m = KEY_DIMS_RE.exec(ref);
    if (m) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      if (w > 0 && h > 0) return { w, h };
    }
    return null;
  }, []);

  /** 丢弃全部本地暂存图片（撤销改动时）：释放 blob URL、从预览映射剔除临时 id。 */
  const discardLocalImages = useCallback(() => {
    const map = localImagesRef.current;
    if (map.size === 0) return;
    setImageUrls((prev) => {
      const next = { ...prev };
      for (const id of map.keys()) delete next[id];
      return next;
    });
    for (const ent of map.values()) URL.revokeObjectURL(ent.url);
    map.clear();
  }, []);

  // 卸载时释放本地暂存图片的 blob URL（避免内存泄漏）。
  useEffect(() => {
    const map = localImagesRef.current;
    return () => {
      for (const ent of map.values()) URL.revokeObjectURL(ent.url);
      map.clear();
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const metas = await fetchRdSheets();
      const list = await Promise.all(metas.map((m) => fetchRdSheet(m.id)));
      setServerSheets(list);
      setDrafts(list.map(toDraft));
      const merged: Record<string, string> = {};
      for (const s of list) Object.assign(merged, s.image_urls ?? {});
      setImageUrls(merged);
      setActiveIdx(0);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载数据表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── 编辑操作（仅编辑者，作用于当前工作表；HTML 兜底模式使用）───────────────
  const mutate = useCallback(
    (fn: (d: Draft) => Draft) => {
      setDrafts((prev) => prev.map((d, i) => (i === activeIdx ? fn(d) : d)));
      setDirty(true);
    },
    [activeIdx],
  );

  const setCell = (r: number, c: number, value: string) =>
    mutate((d) => {
      const rows = d.rows.map((row) => [...row]);
      if (rows[r]) rows[r][c] = value;
      return { ...d, rows };
    });

  const setHeader = (c: number, value: string) =>
    mutate((d) => {
      const headers = [...d.headers];
      const prev = headers[c];
      headers[c] = value;
      // 若重命名的恰是密级控制列，同步 secrecy_column 指向，避免行级管控失效。
      const secrecy_column = d.secrecy_column === prev ? value : d.secrecy_column;
      return { ...d, headers, secrecy_column };
    });

  const addRow = () =>
    mutate((d) => ({ ...d, rows: [...d.rows, Array(d.headers.length).fill("")] }));

  const deleteRow = (r: number) =>
    mutate((d) => ({ ...d, rows: d.rows.filter((_, i) => i !== r) }));

  const addColumn = () =>
    mutate((d) => ({
      ...d,
      headers: [...d.headers, `列${d.headers.length + 1}`],
      rows: d.rows.map((row) => [...row, ""]),
    }));

  const deleteColumn = (c: number) =>
    mutate((d) => {
      const removed = d.headers[c];
      return {
        ...d,
        headers: d.headers.filter((_, i) => i !== c),
        rows: d.rows.map((row) => row.filter((_, i) => i !== c)),
        // 删掉的若是密级列，则清空指向（保存后该表暂无行级管控，全部行对有页面权限者可见）。
        secrecy_column: d.secrecy_column === removed ? "" : d.secrecy_column,
      };
    });

  const handleSave = async () => {
    if (drafts.length === 0) return;
    // Univer 模式：从 Univer 当前快照按 sheetOrder 读回全部工作表（含增删/改名/排序）；
    // 否则用 HTML 兜底模式的 drafts。secrecy_column 按表 id 沿用原指向；
    // 编辑器里新建的表默认「密级」（表头无该列时后端按最严处理，安全默认）。
    let payload: Array<{
      id?: string;
      name: string;
      headers: string[];
      rows: string[][];
      secrecy_column: string;
    }>;
    if (editorMode === "univer" && univerHandleRef.current) {
      const byId = new Map(drafts.map((d) => [d.id, d]));
      payload = univerHandleRef.current.getData().map((s) => ({
        id: s.id,
        name: s.name.trim() || "数据表",
        headers: s.headers,
        rows: s.rows,
        secrecy_column: byId.get(s.id)?.secrecy_column || "密级",
      }));
    } else {
      payload = drafts.map((d) => ({ ...d, name: d.name.trim() || "数据表" }));
    }
    if (payload.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // ── 第一步：上传本地暂存图片（仅草稿中实际引用的），全部成功才继续落库 ──
      // 任何一批失败立即中止保存，临时标记不会被存入服务器（后端无法为其签发 URL）。
      const localIds = new Set<string>();
      for (const s of payload) {
        for (const cell of [...s.headers, ...s.rows.flat()]) {
          for (const m of String(cell).matchAll(LOCAL_MARK_RE)) localIds.add(m[1]);
        }
      }
      const keyByLocal = new Map<string, string>();
      const toUpload: Array<{
        id: string;
        ent: { blob: Blob; name: string; url: string; uploadedKey?: string };
      }> = [];
      for (const id of localIds) {
        const ent = localImagesRef.current.get(id);
        if (!ent) continue; // 本地条目丢失（不应发生）：标记将降级为纯文本 [图片]
        if (ent.uploadedKey) keyByLocal.set(id, ent.uploadedKey);
        else toUpload.push({ id, ent });
      }
      if (toUpload.length) {
        setSaveProgress({ done: 0, total: toUpload.length });
        try {
          // 上传文件名带上宽高前缀（落库 key 保留原名）：重开页面时凭 key 反解宽高
          // 渲染等比缩略图。先等宽高解析完（通常早已就绪，这里只是兜底）。
          await waitForLocalDims(toUpload.map((t) => t.id));
          const uploadName = (ent: { name: string; dims?: { w: number; h: number } }) =>
            ent.dims ? `w${ent.dims.w}h${ent.dims.h}-${ent.name}` : ent.name;
          // 分批 ≤30 与后端单次上限一致。
          for (let i = 0; i < toUpload.length; i += 30) {
            const batch = toUpload.slice(i, i + 30);
            const uploaded = await uploadRdSheetImages(
              batch.map((b) => ({ blob: b.ent.blob, name: uploadName(b.ent) })),
            );
            uploaded.forEach((u, j) => {
              const item = batch[j];
              if (!item) return;
              item.ent.uploadedKey = u.key; // 记录已传：保存失败重试时不重复上传
              keyByLocal.set(item.id, u.key);
            });
            mergeImageUrls(Object.fromEntries(uploaded.map((u) => [u.key, u.url])));
            setSaveProgress({
              done: Math.min(i + batch.length, toUpload.length),
              total: toUpload.length,
            });
          }
        } catch (e) {
          setError(
            `图片上传失败：${
              e instanceof Error ? e.message : "未知错误"
            }。已中止保存（数据仍在编辑器中），请重试；已上传成功的图片不会重复上传。`,
          );
          return;
        } finally {
          setSaveProgress(null);
        }
      }
      // ── 第二步：把临时标记替换为正式 objectKey 后整簿落库 ──
      if (localIds.size) {
        const replaceLocal = (s: string) =>
          s.replace(LOCAL_MARK_RE, (_all, id: string) => {
            const key = keyByLocal.get(id);
            return key ? `[图片:${key}]` : "[图片]";
          });
        payload = payload.map((s) => ({
          ...s,
          headers: s.headers.map(replaceLocal),
          rows: s.rows.map((row) => row.map(replaceLocal)),
        }));
      }
      const saved = await saveAllRdSheets(payload);
      // 已落库的本地暂存图片：释放 blob URL、预览映射切换到正式 key（上传时已合并）。
      if (keyByLocal.size) {
        setImageUrls((prev) => {
          const next = { ...prev };
          for (const id of keyByLocal.keys()) delete next[id];
          return next;
        });
        for (const id of keyByLocal.keys()) {
          const ent = localImagesRef.current.get(id);
          if (ent) {
            URL.revokeObjectURL(ent.url);
            localImagesRef.current.delete(id);
          }
        }
      }
      setServerSheets(saved);
      setDrafts(saved.map(toDraft));
      setActiveIdx((i) => Math.min(i, Math.max(0, saved.length - 1)));
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("zh-CN"));
      setImportNotice(null);
      // 保存返回的 id/顺序可能与编辑器内不同（新建表等场景）：重挂载对齐。
      if (editorMode === "univer") setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
      setSaveProgress(null);
    }
  };

  const handleReset = () => {
    if (serverSheets.length === 0) return;
    setDrafts(serverSheets.map(toDraft));
    setActiveIdx((i) => Math.min(i, Math.max(0, serverSheets.length - 1)));
    setDirty(false);
    setImportNotice(null);
    // 未保存的本地暂存图片随改动一并丢弃。
    discardLocalImages();
    // Univer 模式无内部撤销接口：重挂载组件，从已保存数据重新装载。
    if (editorMode === "univer") setReloadKey((k) => k + 1);
  };

  // ── 导出 / 导入 ───────────────────────────────────────────────────────────
  // xlsx（SheetJS）较重，按需动态加载：普通成员不点导出/导入就不会下载这坨依赖，
  // 与 Univer 惰性加载同一思路（保持成员视图轻量）。
  const handleExport = useCallback(async () => {
    if (drafts.length === 0) return;
    // 导出「当前所见」整簿：编辑者 Univer 模式读 Univer 实时数据；其余用 drafts。
    // 成员的 drafts 已是后端按密级裁剪后的子集（无密级列、无越权行），导出不泄露越权数据。
    let sheetsData: Array<{ name: string; headers: string[]; rows: string[][] }> = drafts;
    if (canEdit && editorMode === "univer" && univerHandleRef.current) {
      sheetsData = univerHandleRef.current.getData();
    }
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const usedNames = new Set<string>();
      sheetsData.forEach((s, i) => {
        const ws = XLSX.utils.aoa_to_sheet([s.headers, ...s.rows]);
        // Excel 工作表名约束：≤31 字符、不含 \ / ? * [ ] :，且簿内唯一。
        const base =
          (s.name || "").replace(/[\\/?*[\]:]+/g, " ").trim().slice(0, 27) ||
          `数据表${i + 1}`;
        let name = base;
        let n = 2;
        while (usedNames.has(name)) name = `${base}(${n++})`;
        usedNames.add(name);
        XLSX.utils.book_append_sheet(wb, ws, name);
      });
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      XLSX.writeFile(wb, `研发数据表_${stamp}.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    }
  }, [drafts, canEdit, editorMode]);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = useCallback(
    async (file: File) => {
      setError(null);
      setImporting(true);
      try {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        if (wb.SheetNames.length === 0) {
          setError("导入失败：文件不含任何工作表");
          return;
        }

        // 图片提取（SheetJS 不解析图片本体，按 zip 解包读取）：WPS DISPIMG 内嵌图 + 浮动图。
        // 解析阶段只登记待上传清单并写占位符；用户确认导入后才真正上传。
        const { extractXlsxImages } = await import("./lib/xlsxImages");
        const images = await extractXlsxImages(buf);
        const pendingImages: Array<{ blob: Blob; name: string }> = [];
        let unmatchedImages = 0; // DISPIMG 引用在文件里找不到图片本体的个数

        const cleanCell = (v: unknown): string => {
          const s = String(v ?? "");
          const m = DISPIMG_ID_RE.exec(s.trim());
          if (!m) return s;
          const img = images.dispimg.get(m[1]);
          if (!img) {
            unmatchedImages++;
            return "[图片]";
          }
          pendingImages.push({ blob: img.blob, name: img.name });
          return IMPORT_IMG_PH(pendingImages.length - 1);
        };

        // 整簿导入：每个工作表 → 一张数据表。第 0 行为表头（去尾部空列）；
        // 全空工作表保留为空表（名字仍占一个 tab），不再因单表无表头而整体报错。
        const stampBase = Date.now().toString(36);
        const parsed = wb.SheetNames.map((wsName, i) => {
          const ws = wb.Sheets[wsName];
          const raw = ws
            ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" })
            : [];
          let headers = ((raw[0] as unknown[]) ?? []).map((h) => cleanCell(h).trim());
          let lastCol = -1;
          headers.forEach((h, c) => {
            if (h !== "") lastCol = c;
          });
          headers = headers.slice(0, lastCol + 1);
          let rows =
            lastCol < 0
              ? []
              : raw.slice(1).map((r) => {
                  const arr = Array.isArray(r) ? r : [];
                  return headers.map((_, c) => cleanCell(arr[c]));
                });

          // 浮动图片按锚点归位到单元格：超出表头宽度则扩列；
          // 纯图片工作表（无表头）按图片分布生成默认表头。空行过滤须在归位之后。
          const floats = images.floats.get(wsName) ?? [];
          if (floats.length) {
            const needCols = Math.max(...floats.map((f) => f.col)) + 1;
            while (headers.length < needCols) headers.push(`列${headers.length + 1}`);
            rows = rows.map((row) => {
              while (row.length < headers.length) row.push("");
              return row;
            });
            for (const f of floats) {
              const r = Math.max(0, f.row - 1); // 原网格第 0 行是表头
              while (rows.length <= r) rows.push(Array<string>(headers.length).fill(""));
              pendingImages.push({ blob: f.image.blob, name: f.image.name });
              const mark = IMPORT_IMG_PH(pendingImages.length - 1);
              rows[r][f.col] = rows[r][f.col] ? `${rows[r][f.col]} ${mark}` : mark;
            }
          }

          // 丢弃整行为空的行（图片占位符含非空白字符，不会被误删）。
          rows = rows.filter((r) => r.some((c) => c.trim() !== ""));

          // 无密级列时自动补全（末尾追加列、每行默认 0 = 全员可见）：
          // 否则后端 fail-closed 按最高密级处理，普通成员将看不到任何行。
          const autoSecrecy = headers.length > 0 && !headers.includes("密级");
          if (autoSecrecy) {
            headers = [...headers, "密级"];
            rows = rows.map((r) => [...r, "0"]);
          }
          return {
            id: `rd-sheet-${stampBase}-${i + 1}`,
            name: wsName,
            headers,
            rows,
            secrecy_column: "密级",
            autoSecrecy,
          };
        });

        const totalRows = parsed.reduce((n, p) => n + p.rows.length, 0);
        const autoCount = parsed.filter((p) => p.autoSecrecy).length;
        const emptyCount = parsed.filter((p) => p.headers.length === 0).length;

        const ok = window.confirm(
          `将用「${file.name}」的 ${parsed.length} 个工作表替换当前全部数据表（共 ${totalRows} 行）：\n` +
            parsed.map((p) => ` · ${p.name}：${p.rows.length} 行`).join("\n") +
            "\n" +
            (autoCount
              ? `其中 ${autoCount} 个工作表无「密级」列，将自动补全并默认填 0（全员可见）。\n`
              : "") +
            (pendingImages.length
              ? `检测到 ${pendingImages.length} 张图片（导入后悬停单元格可预览），将在点击「保存」时上传到服务器。\n`
              : "") +
            `导入后需点击「保存」才会写入服务器，或用「撤销改动」还原。是否继续？`,
        );
        if (!ok) return;

        // 图片不在导入时上传：先本地暂存（即时可预览），点「保存」时统一上传。
        // 取消导入 / 撤销改动都不会在服务器留下孤儿图片。
        const localByIdx = pendingImages.map((p) => registerLocalImage(p.blob, p.name));
        // 等宽高解析完再重建编辑器：纯图片格才能装载为等比缩略图（解析失败退回文本标记）。
        await waitForLocalDims(localByIdx);
        const resolveMarks = (s: string) =>
          s.replace(IMPORT_IMG_PH_RE, (_all, d: string) => {
            const id = localByIdx[Number(d)];
            return id ? `[图片:${id}]` : "[图片]";
          });

        setDrafts(
          parsed.map(({ autoSecrecy: _omit, ...d }) => ({
            ...d,
            headers: d.headers.map(resolveMarks),
            rows: d.rows.map((row) => row.map(resolveMarks)),
          })),
        );
        setActiveIdx(0);
        setDirty(true);
        if (editorMode === "univer") setReloadKey((k) => k + 1);

        setImportNotice(
          `已从「${file.name}」导入 ${parsed.length} 个工作表 · 共 ${totalRows} 行，点击「保存」生效。` +
            (autoCount
              ? ` ${autoCount} 个工作表已自动补全「密级」列（默认 0 · 全员可见），可在保存前调整。`
              : "") +
            (emptyCount ? ` ${emptyCount} 个工作表无可读内容。` : "") +
            (localByIdx.length
              ? ` 已导入 ${localByIdx.length} 张图片（悬停单元格可预览），保存时上传到服务器。`
              : "") +
            (unmatchedImages
              ? ` ${unmatchedImages} 个图片引用未在文件中找到图片本体，已以 [图片] 占位。`
              : "") +
            (images.unsupported
              ? ` ${images.unsupported} 张图片格式不受支持（如 emf/wmf），未导入。`
              : ""),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "导入失败：无法解析文件");
      } finally {
        setImporting(false);
      }
    },
    [editorMode, registerLocalImage, waitForLocalDims],
  );

  // ── 单元格图片：工具栏插入 / 编辑器内粘贴 ───────────────────────────────────
  // 不立即上传：先本地暂存（blob URL 即时预览、单元格写临时标记），点「保存」时统一上传。
  // 写入前先等宽高解析（毫秒级）：单张图片整格写入时编辑器才能渲染成等比缩略图。
  const handleInsertImages = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      const ids = files.map((f) => registerLocalImage(f, f.name || "image.png"));
      await waitForLocalDims(ids);
      const text = ids.map((id) => `[图片:${id}]`).join(" ");
      const inserted = univerHandleRef.current?.insertTextAtActiveCell(text) ?? false;
      if (inserted) {
        setDirty(true);
      } else {
        setError("写入单元格失败：请先在表格中选中目标单元格后重试。");
      }
    },
    [registerLocalImage, waitForLocalDims],
  );

  // 粘贴回调由 Univer 容器在拦截到图片粘贴时触发；write 指向「粘贴那一刻」的活动单元格。
  const handlePasteImage = useCallback(
    (file: File, write: (text: string) => void) => {
      const id = registerLocalImage(file, file.name || "pasted-image.png");
      void waitForLocalDims([id]).then(() => {
        write(`[图片:${id}]`);
        setDirty(true);
      });
    },
    [registerLocalImage, waitForLocalDims],
  );

  // ── 未保存改动的离开提醒 ──────────────────────────────────────────────────
  // 关闭 / 刷新浏览器：原生 beforeunload 确认框。
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  // 应用内切换页面：react-router 导航拦截。
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("当前数据表有未保存的改动，离开后将丢失。确定离开吗？")) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  // Univer 模式下 dirty 追踪依赖事件、未必精确，故不据此禁用按钮；HTML 兜底模式仍按 dirty 门控。
  const editActionDisabled =
    saving || loading || importing || (editorMode === "fallback" && !dirty);

  // 只读视图 / HTML 兜底模式的当前工作表。
  const activeDraft = drafts[activeIdx] ?? drafts[0] ?? null;

  // ── 渲染 ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* 隐藏的导入文件选择器（仅编辑者通过「导入」按钮触发）。 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // 允许重复导入同一文件
          if (f) void handleImportFile(f);
        }}
      />
      {/* 隐藏的图片选择器（「插入图片」按钮触发，上传后写入 Univer 当前选中单元格）。 */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void handleInsertImages(files);
        }}
      />

      {/* 标题区 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-container">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">研发数据表</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              类 WPS 表格，按「密级」行级管控敏感数据 · 不同权限的人看到的行数不同
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && savedAt && !dirty ? (
            <span className="text-xs text-slate-400">已于 {savedAt} 保存</span>
          ) : null}
          {/* 导出对所有可见此页者开放：成员导出的是后端已脱敏的视图，不泄露越权数据。 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExport()}
            disabled={loading || drafts.length === 0}
          >
            <Download className="h-4 w-4" />
            导出
          </Button>
          {canEdit ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleImportClick}
                disabled={saving || loading || importing}
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {importing ? "解析中…" : "导入"}
              </Button>
              {editorMode === "univer" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={saving || loading}
                  title="图片先暂存在本地并写入当前选中的单元格（也可直接在表格里粘贴截图），点「保存」时统一上传"
                >
                  <ImagePlus className="h-4 w-4" />
                  插入图片
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={editActionDisabled}
              >
                <RotateCcw className="h-4 w-4" />
                撤销改动
              </Button>
              <Button size="sm" onClick={handleSave} disabled={editActionDisabled}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saving
                  ? saveProgress
                    ? `上传图片 ${saveProgress.done}/${saveProgress.total}…`
                    : "保存中…"
                  : "保存"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* 角色 / 安全提示 */}
      {canEdit ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            你拥有编辑权限，看到的是<strong>全量数据（含密级列）</strong>。「密级」列填 0–100
            的分值：分值越高越机密。普通成员只能看到密级不高于其个人权限分值的行，且看不到密级列本身。留空的密级按最高（100）处理。
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            这是<strong>按密级裁剪的只读视图</strong>：仅显示密级不高于你权限分值的行，密级列已隐藏。如需查看更多数据或编辑，请联系研发管理员调整权限。
          </p>
        </div>
      )}

      {/* 编辑器说明 */}
      {canEdit ? (
        <div className="flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2.5 text-xs text-indigo-700">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            {editorMode === "univer" ? (
              <>
                已接入 Univer Sheets 编辑器，支持多工作表（底部 tab 切换/新建/删除，每个工作表第 0
                行为表头，其后每行一条记录）。
                <strong>保存时按此二维结构整簿读回单元格字面值</strong>
                ——公式结果按当前显示值保存、合并单元格不予保留，这是为「行级密级」安全所做的取舍。每个工作表保留名为「密级」的列以启用行级管控。
                图片：点「插入图片」或直接粘贴截图，先暂存在本地，纯图片单元格直接显示缩略图（悬停看大图）、与文字混排时显示
                [图片#n] 短标记，点「保存」时统一上传到服务器，随所在行受密级管控。
              </>
            ) : (
              <>
                Univer 编辑器加载失败，已自动回退到<strong>基础表格</strong>，编辑/保存功能不受影响。
                可刷新页面重试加载 Univer。
              </>
            )}
          </p>
        </div>
      ) : null}

      {/* 错误 */}
      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            重试
          </Button>
        </div>
      ) : null}

      {/* 导入解析中 */}
      {importing ? (
        <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm text-indigo-700">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span>正在解析导入文件（含图片提取），大文件可能需要数秒…</span>
        </div>
      ) : null}

      {/* 导入结果提示 */}
      {importNotice ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm text-indigo-700">
          <span>{importNotice}</span>
          <button
            type="button"
            onClick={() => setImportNotice(null)}
            className="shrink-0 rounded p-0.5 text-indigo-400 hover:text-indigo-600"
            title="关闭"
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* 表体 */}
      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载数据表…
        </div>
      ) : drafts.length > 0 ? (
        canEdit ? (
          <UniverErrorBoundary
            onError={() => setEditorMode("fallback")}
            fallback={
              <div className="space-y-3">
                <SheetTabs
                  names={drafts.map((d) => d.name)}
                  active={activeIdx}
                  onSelect={setActiveIdx}
                />
                {activeDraft ? (
                  <EditableTable
                    draft={activeDraft}
                    onSetCell={setCell}
                    onSetHeader={setHeader}
                    onAddRow={addRow}
                    onDeleteRow={deleteRow}
                    onAddColumn={addColumn}
                    onDeleteColumn={deleteColumn}
                  />
                ) : null}
              </div>
            }
          >
            <Suspense
              fallback={
                <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载 Univer 编辑器…
                </div>
              }
            >
              <LazyUniverEditor
                key={reloadKey}
                ref={univerHandleRef}
                initialSheets={drafts.map((d) => ({
                  id: d.id,
                  name: d.name,
                  headers: d.headers,
                  rows: d.rows,
                }))}
                onDirty={() => setDirty(true)}
                imageUrls={imageUrls}
                getImageDims={getImageDims}
                onRegisterImage={registerLocalImage}
                onPasteImage={handlePasteImage}
              />
            </Suspense>
          </UniverErrorBoundary>
        ) : (
          <div className="space-y-3">
            <SheetTabs
              names={drafts.map((d) => d.name)}
              active={activeIdx}
              onSelect={setActiveIdx}
            />
            {activeDraft ? (
              <ReadOnlyTable
                headers={activeDraft.headers}
                rows={activeDraft.rows}
                imageUrls={imageUrls}
              />
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}

// ── 工作表切换 tab（只读视图 / HTML 兜底模式用；Univer 模式用其原生底部 tab）──
function SheetTabs({
  names,
  active,
  onSelect,
}: {
  names: string[];
  active: number;
  onSelect: (i: number) => void;
}) {
  if (names.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5">
      {names.map((n, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(i)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm transition-colors",
            i === active
              ? "bg-primary font-medium text-primary-foreground"
              : "text-slate-600 hover:bg-slate-100",
          )}
        >
          {n || `数据表${i + 1}`}
        </button>
      ))}
    </div>
  );
}

// ── 单元格内容渲染：把 [图片:key] 标记替换为缩略图（点击新窗口看大图）──────────
// 无 URL 映射（图片在越权行、或 URL 已过期）时显示灰字 [图片]——后端只为可见行签发
// URL，这里拿不到映射本身就是行级管控生效的表现。
function CellContent({
  value,
  imageUrls,
}: {
  value: string;
  imageUrls?: Record<string, string>;
}) {
  if (!value.includes("[图片:")) return <>{value}</>;
  const parts: React.ReactNode[] = [];
  const re = new RegExp(IMAGE_MARK_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(value))) {
    if (m.index > last) parts.push(value.slice(last, m.index));
    const url = imageUrls?.[m[1]];
    parts.push(
      url ? (
        <img
          key={`img-${i++}`}
          src={url}
          alt="单元格图片"
          className="inline-block max-h-16 max-w-24 cursor-zoom-in rounded border border-slate-200 object-contain align-middle"
          onClick={() => window.open(url, "_blank", "noopener")}
        />
      ) : (
        <span key={`na-${i++}`} className="text-xs text-slate-400">
          [图片]
        </span>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < value.length) parts.push(value.slice(last));
  return <>{parts}</>;
}

// ── 只读表格（成员视图，数据已由后端脱敏）────────────────────────────────────
function ReadOnlyTable({
  headers,
  rows,
  imageUrls,
}: {
  headers: string[];
  rows: string[][];
  imageUrls?: Record<string, string>;
}) {
  if (headers.length === 0) {
    return <EmptyHint text="该数据表暂无可见列。" />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50">
            <th className="w-12 border-b border-slate-200 px-2 py-2 text-center text-xs font-medium text-slate-400">
              #
            </th>
            {headers.map((h, c) => (
              <th
                key={c}
                className="border-b border-l border-slate-200 px-3 py-2 text-left font-medium text-slate-600"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length + 1} className="px-3 py-8 text-center text-slate-400">
                没有你有权查看的数据行。
              </td>
            </tr>
          ) : (
            rows.map((row, r) => (
              <tr key={r} className="hover:bg-slate-50/60">
                <td className="border-b border-slate-100 px-2 py-1.5 text-center text-xs text-slate-400">
                  {r + 1}
                </td>
                {headers.map((_, c) => (
                  <td
                    key={c}
                    className="border-b border-l border-slate-100 px-3 py-1.5 text-slate-700"
                  >
                    <CellContent value={row[c] ?? ""} imageUrls={imageUrls} />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── 可编辑表格（编辑者视图，全量数据）──────────────────────────────────────────
function EditableTable({
  draft,
  onSetCell,
  onSetHeader,
  onAddRow,
  onDeleteRow,
  onAddColumn,
  onDeleteColumn,
}: {
  draft: Draft;
  onSetCell: (r: number, c: number, value: string) => void;
  onSetHeader: (c: number, value: string) => void;
  onAddRow: () => void;
  onDeleteRow: (r: number) => void;
  onAddColumn: () => void;
  onDeleteColumn: (c: number) => void;
}) {
  // 后端在保存时会把空的 secrecy_column 兜底为「密级」，这里同样兜底，保证
  // 即便刚新增一列命名为「密级」（draft.secrecy_column 暂为空）也能正确高亮。
  const secrecyName = draft.secrecy_column || "密级";
  const secrecyIdx = draft.headers.findIndex((h) => h === secrecyName);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50">
              <th className="w-12 border-b border-slate-200 px-2 py-2 text-center text-xs font-medium text-slate-400">
                #
              </th>
              {draft.headers.map((h, c) => {
                const isSecrecy = c === secrecyIdx;
                return (
                  <th
                    key={c}
                    className={cn(
                      "min-w-[8rem] border-b border-l border-slate-200 px-1.5 py-1.5",
                      isSecrecy && "bg-amber-50",
                    )}
                  >
                    <div className="flex items-center gap-1">
                      <input
                        value={h}
                        onChange={(e) => onSetHeader(c, e.target.value)}
                        className={cn(
                          "w-full rounded bg-transparent px-1.5 py-1 text-left font-medium text-slate-700 outline-none focus:bg-white focus:ring-1 focus:ring-primary/40",
                          isSecrecy && "text-amber-800",
                        )}
                        placeholder={`列${c + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => onDeleteColumn(c)}
                        title="删除此列"
                        className="shrink-0 rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {isSecrecy ? (
                      <p className="px-1.5 pb-0.5 text-[10px] font-normal text-amber-600">
                        密级控制列（0–100）
                      </p>
                    ) : null}
                  </th>
                );
              })}
              <th className="w-12 border-b border-l border-slate-200 px-2 py-2 text-center">
                <button
                  type="button"
                  onClick={onAddColumn}
                  title="新增一列"
                  className="rounded p-1 text-slate-400 hover:bg-primary/10 hover:text-primary"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={draft.headers.length + 2}
                  className="px-3 py-8 text-center text-slate-400"
                >
                  暂无数据行，点击下方「新增一行」开始录入。
                </td>
              </tr>
            ) : (
              draft.rows.map((row, r) => (
                <tr key={r} className="hover:bg-slate-50/60">
                  <td className="border-b border-slate-100 px-2 py-1 text-center text-xs text-slate-400">
                    {r + 1}
                  </td>
                  {draft.headers.map((_, c) => {
                    const isSecrecy = c === secrecyIdx;
                    return (
                      <td
                        key={c}
                        className={cn(
                          "border-b border-l border-slate-100 p-0",
                          isSecrecy && "bg-amber-50/40",
                        )}
                      >
                        <input
                          value={row[c] ?? ""}
                          onChange={(e) => onSetCell(r, c, e.target.value)}
                          inputMode={isSecrecy ? "numeric" : undefined}
                          className={cn(
                            "w-full bg-transparent px-3 py-1.5 text-slate-700 outline-none focus:bg-white focus:ring-1 focus:ring-inset focus:ring-primary/40",
                            isSecrecy && "text-amber-800",
                          )}
                          placeholder={isSecrecy ? "0–100" : undefined}
                        />
                      </td>
                    );
                  })}
                  <td className="border-b border-l border-slate-100 px-2 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => onDeleteRow(r)}
                      title="删除此行"
                      className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onAddRow}>
          <Plus className="h-4 w-4" />
          新增一行
        </Button>
        <Button variant="outline" size="sm" onClick={onAddColumn}>
          <Plus className="h-4 w-4" />
          新增一列
        </Button>
        {secrecyIdx < 0 ? (
          <span className="text-xs text-amber-600">
            ⚠ 当前表没有「{draft.secrecy_column || "密级"}」列：按「最严」处理，保存后普通成员将看不到任何数据行（只有编辑者/超管可见）。新增一列并命名为「密级」以启用行级管控。
          </span>
        ) : null}
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex min-h-[20vh] items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400">
      {text}
    </div>
  );
}
