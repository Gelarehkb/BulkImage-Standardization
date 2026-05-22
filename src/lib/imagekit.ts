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
 * Render image to a `size`x`size` JPEG using center-crop-to-square (cover).
 * Always crops the largest centered square from the source and scales it to fill
 * the full canvas — never adds padding or letterboxing. The `tightCrop` flag is
 * accepted for backward compatibility but ignored.
 */
export async function processToSquare(
  img: HTMLImageElement,
  size = 1000,
  _tightCrop = false,
): Promise<Blob> {
  void _tightCrop;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const side = Math.min(sw, sh);
  const sx = Math.floor((sw - side) / 2);
  const sy = Math.floor((sh - side) / 2);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

  const encode = (q: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        q,
      );
    });

  const MIN = 50 * 1024;
  const MAX = 250 * 1024;
  let q = 0.92;
  let blob = await encode(q);

  if (blob.size > MAX) {
    while (blob.size > MAX && q > 0.2) {
      q = Math.max(0.2, q - 0.05);
      blob = await encode(q);
    }
  } else if (blob.size < MIN) {
    let bestBlob = blob;
    q = 0.95;
    while (q <= 1.0) {
      const next = await encode(Math.min(1, q));
      if (next.size > bestBlob.size) bestBlob = next;
      if (next.size >= MIN) {
        bestBlob = next;
        break;
      }
      q = +(q + 0.05).toFixed(2);
    }
    blob = bestBlob;
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
  const cleanSkus = Array.from(
    new Set(skus.map((s) => s.trim()).filter((s) => s.length > 0)),
  );
  // Sort longest-first for deterministic longest-match-wins on overlap
  const ordered = [...cleanSkus].sort((a, b) => b.length - a.length);

  const groupMap = new Map<string, string[]>();
  for (const sku of cleanSkus) groupMap.set(sku, []);
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
  const groups: SkuGroup[] = cleanSkus.map((han) => {
    const ids = groupMap.get(han)!;
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
