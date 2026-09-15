export type BgKind = "white" | "model";

export type ProcessMode = "auto" | "crop" | "expand";

export interface LoadedImage {
  id: string;
  file: File;
  filename: string;
  size: number;
  url: string;
  width: number;
  height: number;
  bg: BgKind;
  /** How Step 3 should treat this source. */
  mode?: ProcessMode;
  /** Background color used when mode === "expand". */
  bgColor?: string;
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
  // Analyse a small downscaled copy — full-resolution canvases are the main
  // cause of lag/memory pressure when loading large batches.
  const MAX = 256;
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const sample = 6;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "model";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);


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
  // Scan a downscaled copy (max 600px) — 25x less pixel work on large photos,
  // then map the bounds back to source pixels.
  const MAX = 600;
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const cx = c.getContext("2d", { willReadFrequently: true });
  if (!cx) return null;
  cx.drawImage(img, 0, 0, c.width, c.height);
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

/** Folder name like "2026-09-04 converted". */
export function defaultFolderName(label = "converted"): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${label}`;
}

/**
 * Save many blobs into a real folder.
 * Uses the File System Access API (Chrome/Edge): the user picks a location once
 * (e.g. Downloads) and a subfolder is created for the batch. Browsers without
 * that API fall back to sequential single-file downloads.
 */
export async function saveBlobsToFolder(
  files: Array<{ filename: string; blob: Blob }>,
  folderName = defaultFolderName(),
  onProgress?: (done: number, total: number) => void,
): Promise<"folder" | "downloads"> {
  const picker = (window as unknown as {
    showDirectoryPicker?: (o?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;

  // Inside a cross-origin preview iframe the directory picker is blocked by the
  // browser, so go straight to normal downloads there.
  let embedded = false;
  try {
    embedded = window.self !== window.top;
  } catch {
    embedded = true;
  }

  if (typeof picker === "function" && !embedded) {
    try {
      const root = await picker({ mode: "readwrite" });
      const dir = await root.getDirectoryHandle(folderName, { create: true });
      let done = 0;
      for (const f of files) {
        const handle = await dir.getFileHandle(f.filename, { create: true });
        const writable = await handle.createWritable();
        await writable.write(f.blob);
        await writable.close();
        onProgress?.(++done, files.length);
      }
      return "folder";
    } catch (err) {
      // User cancelled the picker → do nothing further.
      if ((err as Error)?.name === "AbortError") throw err;
      // Anything else (blocked, permission denied) → fall back to downloads.
      console.warn("Folder saving unavailable, falling back to downloads", err);
    }
  }


  let done = 0;
  for (const f of files) {
    downloadBlob(f.blob, f.filename);
    await new Promise((r) => setTimeout(r, 250));
    onProgress?.(++done, files.length);
  }
  return "downloads";
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

/**
 * Extract alphanumeric tokens from a SKU string for fallback token matching.
 * A token must be at least 4 chars AND contain at least one digit — this
 * avoids matching generic words like "dot", "avena", "pack" while still
 * catching identifier-like tokens ("ks105981", "p30134").
 */
function extractSkuTokens(sku: string): string[] {
  const raw = sku.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return raw.filter((t) => t.length >= 4 && /\d/.test(t));
}

/**
 * Match SKUs to images.
 * Rule 1 (primary): filename contains the full SKU as a substring.
 * Rule 2 (fallback): filename contains any alphanumeric token extracted from
 *   the SKU (length ≥ 4, must contain a digit). Longest matching needle wins,
 *   across both rules and across all SKUs.
 */
export function matchSkus(
  skus: string[],
  images: LoadedImage[],
): { groups: SkuGroup[]; unmatched: string[] } {
  const cleanSkus = skus.map((s) => s.trim()).filter((s) => s.length > 0);
  const uniqueSkus = Array.from(new Set(cleanSkus));

  // Build [needle, ownerSku] pairs from full SKUs + token fallbacks.
  const needles: Array<{ needle: string; sku: string }> = [];
  for (const sku of uniqueSkus) {
    needles.push({ needle: sku.toLowerCase(), sku });
    for (const tok of extractSkuTokens(sku)) {
      needles.push({ needle: tok, sku });
    }
  }
  // Longest needle first → longest-match-wins across SKUs and rules.
  needles.sort((a, b) => b.needle.length - a.needle.length);

  const groupMap = new Map<string, string[]>();
  for (const sku of uniqueSkus) groupMap.set(sku, []);
  const unmatched: string[] = [];

  for (const img of images) {
    const lowerName = img.filename.toLowerCase();
    let bestSku: string | null = null;
    for (const { needle, sku } of needles) {
      if (needle && lowerName.includes(needle)) {
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

  const byId = new Map(images.map((i) => [i.id, i]));
  const groups: SkuGroup[] = cleanSkus.map((han) => {
    const ids = [...(groupMap.get(han) ?? [])];
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
