import JSZip from "jszip";

/**
 * 从 xlsx（zip 容器）中提取图片，供研发数据表导入用。SheetJS 社区版不解析图片，
 * 这里直接解包读取两类来源：
 * - WPS 单元格内嵌图片：公式 =DISPIMG("ID_xxx",1)。映射在 xl/cellimages.xml
 *   （ID → 图片关系）+ xl/_rels/cellimages.xml.rels（关系 → media 文件），全簿共享。
 * - 浮动图片（标准 OOXML drawing）：xl/drawings/drawingN.xml 的锚点（from.col/row）
 *   决定归位单元格，按工作表分组返回。
 * 仅保留浏览器可展示的格式（png/jpg/gif/webp/bmp）；emf/wmf 等计入 unsupported。
 */

export type XlsxImage = { blob: Blob; name: string; mime: string };

export type XlsxImageExtract = {
  /** WPS DISPIMG ID（全簿唯一）→ 图片 */
  dispimg: Map<string, XlsxImage>;
  /** 工作表名 → 浮动图片列表（已按锚点归位到 0 基 row/col） */
  floats: Map<string, Array<{ row: number; col: number; image: XlsxImage }>>;
  /** 因格式不受支持（如 emf/wmf）而跳过的图片数 */
  unsupported: number;
};

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

function byLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS("*", name));
}

/** 读取 .rels 文件 → Id → 规整后的 zip 内路径（相对 baseDir 解析，去掉开头的 /）。 */
async function readRels(
  zip: JSZip,
  relsPath: string,
  baseDir: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const file = zip.file(relsPath);
  if (!file) return map;
  const doc = parseXml(await file.async("text"));
  for (const rel of byLocalName(doc, "Relationship")) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (!id || !target) continue;
    map.set(id, resolvePath(baseDir, target));
  }
  return map;
}

/** 解析 OOXML 关系 Target（可能是 media/x.png、../media/x.png、/xl/media/x.png）。 */
function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (baseDir ? baseDir.split("/") : []).filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

function blipEmbedId(el: Element): string | null {
  for (const blip of byLocalName(el, "blip")) {
    const id = blip.getAttributeNS(R_NS, "embed") ?? blip.getAttribute("r:embed");
    if (id) return id;
  }
  return null;
}

async function loadImage(zip: JSZip, path: string): Promise<XlsxImage | null> {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return null;
  const file = zip.file(path);
  if (!file) return null;
  const blob = await file.async("blob");
  const name = path.split("/").pop() ?? `image.${ext}`;
  return { blob: blob.slice(0, blob.size, mime), name, mime };
}

export async function extractXlsxImages(buf: ArrayBuffer): Promise<XlsxImageExtract> {
  const result: XlsxImageExtract = { dispimg: new Map(), floats: new Map(), unsupported: 0 };
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    return result;
  }

  // ── WPS DISPIMG：cellimages.xml（全簿共享）──────────────────────────────
  const cellImagesFile = zip.file("xl/cellimages.xml");
  if (cellImagesFile) {
    const rels = await readRels(zip, "xl/_rels/cellimages.xml.rels", "xl");
    const doc = parseXml(await cellImagesFile.async("text"));
    for (const ci of byLocalName(doc, "cellImage")) {
      const nv = byLocalName(ci, "cNvPr")[0];
      const id = nv?.getAttribute("name");
      const embed = blipEmbedId(ci);
      const mediaPath = embed ? rels.get(embed) : undefined;
      if (!id || !mediaPath) continue;
      const img = await loadImage(zip, mediaPath);
      if (img) result.dispimg.set(id, img);
      else result.unsupported++;
    }
  }

  // ── 浮动图片：workbook → sheet → drawing → 锚点 ─────────────────────────
  const workbookFile = zip.file("xl/workbook.xml");
  if (!workbookFile) return result;
  const wbDoc = parseXml(await workbookFile.async("text"));
  const wbRels = await readRels(zip, "xl/_rels/workbook.xml.rels", "xl");

  for (const sheetEl of byLocalName(wbDoc, "sheet")) {
    const sheetName = sheetEl.getAttribute("name");
    const rid = sheetEl.getAttributeNS(R_NS, "id") ?? sheetEl.getAttribute("r:id");
    const sheetPath = rid ? wbRels.get(rid) : undefined;
    if (!sheetName || !sheetPath) continue;

    const sheetDir = sheetPath.split("/").slice(0, -1).join("/");
    const sheetBase = sheetPath.split("/").pop() ?? "";
    const sheetRels = await readRels(zip, `${sheetDir}/_rels/${sheetBase}.rels`, sheetDir);

    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) continue;
    const sheetDoc = parseXml(await sheetFile.async("text"));
    // <drawing r:id=".."/> 引用该表的 drawing 部件
    for (const drawingRef of byLocalName(sheetDoc, "drawing")) {
      const dRid =
        drawingRef.getAttributeNS(R_NS, "id") ?? drawingRef.getAttribute("r:id");
      const drawingPath = dRid ? sheetRels.get(dRid) : undefined;
      if (!drawingPath) continue;

      const drawingFile = zip.file(drawingPath);
      if (!drawingFile) continue;
      const drawingDir = drawingPath.split("/").slice(0, -1).join("/");
      const drawingBase = drawingPath.split("/").pop() ?? "";
      const drawingRels = await readRels(
        zip,
        `${drawingDir}/_rels/${drawingBase}.rels`,
        drawingDir,
      );
      const drawingDoc = parseXml(await drawingFile.async("text"));

      const anchors = [
        ...byLocalName(drawingDoc, "twoCellAnchor"),
        ...byLocalName(drawingDoc, "oneCellAnchor"),
      ];
      for (const anchor of anchors) {
        const from = byLocalName(anchor, "from")[0];
        if (!from) continue;
        const col = Number(byLocalName(from, "col")[0]?.textContent ?? "");
        const row = Number(byLocalName(from, "row")[0]?.textContent ?? "");
        if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0) continue;
        const pics = byLocalName(anchor, "pic");
        if (!pics.length) continue; // 文本框/图形等非图片锚点
        for (const pic of pics) {
          const embed = blipEmbedId(pic);
          const mediaPath = embed ? drawingRels.get(embed) : undefined;
          if (!mediaPath) continue;
          const img = await loadImage(zip, mediaPath);
          if (!img) {
            result.unsupported++;
            continue;
          }
          const list = result.floats.get(sheetName) ?? [];
          list.push({ row, col, image: img });
          result.floats.set(sheetName, list);
        }
      }
    }
  }

  return result;
}
