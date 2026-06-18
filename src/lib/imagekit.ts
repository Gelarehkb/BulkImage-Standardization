export type BgKind = "white" | "model";

export interface LoadedImage {
  id: string;
  file: File;
  filename: string;
  size: number;
  url: string;
  width: number;
  height: number;
  bg: BgKind;
}

export interface SkuGroup {
  han: string;
  imageIds: string[];
}

export interface ProcessedImage {
  id: string;
  han: string;
  filename: string;
  blob: Blob;
  url: string;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Sample 4 corners (15x15) and decide if avg brightness > 238 → white bg */
export async function detectWhiteBg(img: HTMLImageElement): Promise<BgKind> {
  const sample = 15;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "model";
  ctx.drawImage(img, 0, 0);

  const corners: Array<[number, number]> = [
    [0, 0],
    [Math.max(0, canvas.width - sample), 0],
    [0, Math.max(0, canvas.height - sample)],
    [Math.max(0, canvas.width - sample), Math.max(0, canvas.height - sample)],
  ];

  let total = 0;
  let count = 0;
  for (const [x, y] of corners) {
    const w = Math.min(sample, canvas.width - x);
    const h = Math.min(sample, canvas.height - y);
    if (w <= 0 || h <= 0) continue;
    const data = ctx.getImageData(x, y, w, h).data;
    for (let i = 0; i < data.length; i += 4) {
      // Brightness (perceived)
      total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      count++;
    }
  }
  const avg = count ? total / count : 0;
  return avg > 238 ? "white" : "model";
}

/**
 * Find tight bounding box of non-white pixels (threshold-based).
 * Returns null if image is fully white/empty.
 */
export function findContentBounds(
  img: HTMLImageElement,
  brightnessThreshold = 245,
): { x: number; y: number; w: number; h: number } | null {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const cx = c.getContext("2d");
  if (!cx) return null;
  cx.drawImage(img, 0, 0);
  const { data, width, height } = cx.getImageData(0, 0, c.width, c.height);

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a < 10) continue; // transparent counts as background
      const b = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (b < brightnessThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Render image to a `size`x`size` JPEG.
 * - White-bg images: tight-crop to the product's bounding box (no padding/margin),
 *   expanded to a square centered on the bbox so the product touches or nearly
 *   touches all 4 edges of the output frame.
 * - Other images: center-crop the largest centered square (cover).
 */
export async function processToSquare(
  img: HTMLImageElement,
  size = 1000,
  isWhiteBg = false,
  maxKiB = 250,
): Promise<Blob> {
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;

  let sx: number, sy: number, sSide: number;

  const bounds = isWhiteBg ? findContentBounds(img) : null;
  if (bounds) {
    const maxSide = Math.min(sw, sh);
    const side = Math.min(Math.max(bounds.w, bounds.h), maxSide);
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    let x = Math.round(cx - side / 2);
    let y = Math.round(cy - side / 2);
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + side > sw) x = sw - side;
    if (y + side > sh) y = sh - side;
    sx = x;
    sy = y;
    sSide = side;
  } else {
    sSide = Math.min(sw, sh);
    sx = Math.floor((sw - sSide) / 2);
    sy = Math.floor((sh - sSide) / 2);
  }

  return renderCropToBlob(img, sx, sy, sSide, size, maxKiB);
}

/**
 * Manual crop: caller supplies the source-pixel offset and side length.
 * Used by the Step 3 crop editor where the user repositions the crop frame.
 */
export async function processToSquareWithOffset(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sSide: number,
  size = 1000,
  maxKiB = 250,
): Promise<Blob> {
  return renderCropToBlob(img, sx, sy, sSide, size, maxKiB);
}

async function renderCropToBlob(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sSide: number,
  size: number,
  maxKiB: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, sx, sy, sSide, sSide, 0, 0, size, size);

  const encode = (q: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        q,
      );
    });

  const MAX = Math.max(20, maxKiB) * 1024;
  let q = 0.92;
  let blob = await encode(q);
  while (blob.size > MAX && q > 0.2) {
    q = Math.max(0.2, q - 0.05);
    blob = await encode(q);
  }
  return blob;
}


export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Remove background locally using @imgly/background-removal (runs in browser via WASM).
 * Composites the cutout onto a solid white background and returns a PNG blob.
 * No API key, no upload — fully local.
 */
export async function removeBackground(file: File | Blob): Promise<Blob> {
  const { removeBackground: imglyRemove } = await import("@imgly/background-removal");
  // Returns a Blob with transparent background (PNG)
  const cutout = await imglyRemove(file);

  // Composite onto white so downstream pipeline gets a clean white-bg image
  const url = URL.createObjectURL(cutout);
  try {
    const img = await loadImageElement(url);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Failed to encode PNG"))),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Match SKUs to images. Each image → at most one SKU (longest match wins). */
export function matchSkus(
  skus: string[],
  images: LoadedImage[],
): { groups: SkuGroup[]; unmatched: string[] } {
  const cleanSkus = skus.map((s) => s.trim()).filter((s) => s.length > 0);
  // Sort unique SKUs longest-first for deterministic longest-match-wins on overlap
  const uniqueSkus = Array.from(new Set(cleanSkus));
  const ordered = [...uniqueSkus].sort((a, b) => b.length - a.length);

  // Track image assignments per unique SKU; duplicate HAN entries share the same image list.
  const groupMap = new Map<string, string[]>();
  for (const sku of uniqueSkus) groupMap.set(sku, []);
  const unmatched: string[] = [];

  for (const img of images) {
    const lowerName = img.filename.toLowerCase();
    let bestSku: string | null = null;
    for (const sku of ordered) {
      if (lowerName.includes(sku.toLowerCase())) {
        bestSku = sku;
        break;
      }
    }
    if (bestSku) {
      groupMap.get(bestSku)!.push(img.id);
    } else {
      unmatched.push(img.id);
    }
  }

  // Auto-order: white-bg first, then model, alphabetical within each
  const byId = new Map(images.map((i) => [i.id, i]));
  const seenHan = new Set<string>();
  const groups: SkuGroup[] = cleanSkus.map((han) => {
    // Only the first occurrence of a HAN gets the matched images; later duplicates are empty.
    const isFirst = !seenHan.has(han);
    seenHan.add(han);
    const ids = isFirst ? [...(groupMap.get(han) ?? [])] : [];
    ids.sort((a, b) => {
      const ia = byId.get(a)!;
      const ib = byId.get(b)!;
      if (ia.bg !== ib.bg) return ia.bg === "white" ? -1 : 1;
      return ia.filename.localeCompare(ib.filename);
    });
    return { han, imageIds: ids };
  });


  return { groups, unmatched };
}
