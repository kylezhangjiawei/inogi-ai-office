export type ImageCompressionOptions = {
  triggerBytes: number;
  targetBytes: number;
  hardLimitBytes: number;
  maxEdge?: number;
  minEdge?: number;
  outputType?: "image/jpeg" | "image/webp";
  qualities?: number[];
  background?: string;
};

function includesAscii(bytes: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  outer: for (let i = 0; i <= bytes.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

async function shouldPreserveOriginalFrames(file: File): Promise<boolean> {
  const type = file.type.toLocaleLowerCase();
  const name = file.name.toLocaleLowerCase();
  if (type === "image/gif" || type === "image/svg+xml" || /\.(gif|svg|svgz)$/.test(name)) return true;
  if (type === "image/webp" || name.endsWith(".webp")) {
    const bytes = new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer());
    return includesAscii(bytes, "ANIM") || includesAscii(bytes, "ANMF");
  }
  if (type === "image/png" || name.endsWith(".png")) {
    const bytes = new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer());
    return includesAscii(bytes, "acTL");
  }
  return false;
}

function outputFileName(name: string, outputType: "image/jpeg" | "image/webp"): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name || "image";
  return `${base}.${outputType === "image/webp" ? "webp" : "jpg"}`;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: "image/jpeg" | "image/webp",
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Compresses a static raster image on the client. Animated GIF/APNG/WebP and SVG are never
 * rasterized, so uploading an optimization does not silently remove animation or active content.
 */
export async function compressImageFile(
  file: File,
  options: ImageCompressionOptions,
): Promise<File | null> {
  if (file.size <= options.triggerBytes) return file;
  if (
    !file.type.startsWith("image/")
    || typeof createImageBitmap !== "function"
    || await shouldPreserveOriginalFrames(file)
  ) {
    return file.size <= options.hardLimitBytes ? file : null;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file.size <= options.hardLimitBytes ? file : null;
  }

  try {
    const outputType = options.outputType ?? "image/webp";
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: outputType !== "image/jpeg" });
    if (!context) return file.size <= options.hardLimitBytes ? file : null;

    const sourceMaxEdge = Math.max(bitmap.width, bitmap.height);
    let maxEdge = Math.min(sourceMaxEdge, options.maxEdge ?? 2560);
    const minEdge = options.minEdge ?? 480;
    const qualities = options.qualities ?? [0.86, 0.78, 0.7, 0.62, 0.54];
    let bestBlob: Blob | null = null;

    for (let pass = 0; pass < 8 && maxEdge >= minEdge; pass += 1) {
      const scale = Math.min(1, maxEdge / sourceMaxEdge);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      if (outputType === "image/jpeg") {
        context.fillStyle = options.background ?? "#ffffff";
        context.fillRect(0, 0, width, height);
      }
      context.drawImage(bitmap, 0, 0, width, height);

      for (const quality of qualities) {
        const blob = await canvasToBlob(canvas, outputType, quality);
        if (!blob) continue;
        if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
        if (blob.size <= options.targetBytes) {
          return new File([blob], outputFileName(file.name, outputType), {
            type: outputType,
            lastModified: file.lastModified,
          });
        }
      }
      maxEdge = Math.round(maxEdge * 0.76);
    }

    if (bestBlob && bestBlob.size < file.size && bestBlob.size <= options.hardLimitBytes) {
      return new File([bestBlob], outputFileName(file.name, outputType), {
        type: outputType,
        lastModified: file.lastModified,
      });
    }
    return file.size <= options.hardLimitBytes ? file : null;
  } finally {
    bitmap.close();
  }
}
