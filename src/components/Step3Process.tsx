import { useEffect, useMemo, useRef, useState } from "react";

import type { LoadedImage, ProcessedImage, SkuGroup } from "@/lib/imagekit";
import {
  downloadBlob,
  loadImageElement,
  processToSquare,
  processToSquareWithOffset,
} from "@/lib/imagekit";

interface Props {
  images: LoadedImage[];
  groups: SkuGroup[];
  skippedIds: Set<string>;
  maxOutputKiB: number;
}

interface ProcessedItem extends ProcessedImage {
  srcId: string;
}

export function Step3Process({ images, groups, skippedIds, maxOutputKiB }: Props) {
  const byId = useRef(new Map(images.map((i) => [i.id, i])));
  byId.current = new Map(images.map((i) => [i.id, i]));

  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [processed, setProcessed] = useState<ProcessedItem[]>([]);
  const [zipping, setZipping] = useState(false);
  const [label, setLabel] = useState("");
  const [appendSuffix, setAppendSuffix] = useState(true);
  const [suffix, setSuffix] = useState(".jpg");
  const [cropTarget, setCropTarget] = useState<ProcessedItem | null>(null);
  const startedRef = useRef(false);

  const validGroups = groups.filter(
    (g) => g.han.trim() && g.imageIds.some((id) => !skippedIds.has(id)),
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    setProcessing(true);
    setDone(false);
    const all: ProcessedItem[] = [];
    // Dedupe by HAN: duplicate SKU rows share the same processed images, so only process once.
    const uniqueGroups: SkuGroup[] = [];
    const seenHanRun = new Set<string>();
    for (const g of validGroups) {
      const han = g.han.trim();
      if (seenHanRun.has(han)) continue;
      seenHanRun.add(han);
      uniqueGroups.push(g);
    }
    // Dedupe within a group by image id only (fill-down may repeat the same id).
    // Never collapse different images that happen to share a filename base — that
    // was hiding legit assignments from the ZIP.
    const uniqueIdsByGroup = uniqueGroups.map((g) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const id of g.imageIds) {
        if (skippedIds.has(id)) continue;
        if (seen.has(id)) continue;
        if (!byId.current.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      return out;
    });
    const total = uniqueIdsByGroup.reduce((acc, ids) => acc + ids.length, 0);
    setProgress({ done: 0, total, label: "" });

    let i = 0;
    for (let gi = 0; gi < uniqueGroups.length; gi++) {
      const g = uniqueGroups[gi];
      const han = g.han.trim();
      const uniqueIds = uniqueIdsByGroup[gi];

      let seq = 0;
      for (const id of uniqueIds) {
        const src = byId.current.get(id);
        if (!src) continue;
        seq++;
        i++;
          setProgress({ done: i, total, label: `${han}_${seq}.jpg` });
          try {
            const el = await loadImageElement(src.url);
            // If the user already cropped or expanded the image in Step 1,
            // preserve that framing instead of re-running the white-bg tight crop.
            const isWhiteBg = src.bg === "white" && src.mode !== "crop" && src.mode !== "expand";
            const blob = await processToSquare(el, 1000, isWhiteBg, maxOutputKiB);
            const url = URL.createObjectURL(blob);
            all.push({
              id: `${han}-${seq}`,
              han,
              filename: `${han}_${seq}.jpg`,
              blob,
              url,
              srcId: id,
            });
          } catch (err) {
            console.error(`Failed to process ${src.filename}:`, err);
          }
      }
    }

    setProcessed(all);
    setProcessing(false);
    setDone(true);
  };

  const buildExportName = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const date = `${yyyy}-${mm}-${dd}`;
    const trimmed = label.trim();
    return trimmed ? `${date} ${trimmed} converted` : `${date} converted`;
  };

  const downloadAll = async () => {
    setZipping(true);
    try {
      const name = buildExportName();
      const picker = (window as unknown as {
        showDirectoryPicker?: (opts?: { mode?: string }) => Promise<any>;
      }).showDirectoryPicker;

      if (picker) {
        // Save straight into a folder the user picks (creates a subfolder).
        const root = await picker.call(window, { mode: "readwrite" });
        const folder = await root.getDirectoryHandle(name, { create: true });
        for (const p of processed) {
          const fh = await folder.getFileHandle(p.filename, { create: true });
          const w = await fh.createWritable();
          await w.write(p.blob);
          await w.close();
        }
      } else {
        // Fallback: sequential downloads into the browser's download folder.
        for (const p of processed) {
          downloadBlob(p.blob, p.filename);
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      console.error(e);
      alert("Failed to save images. Please try again.");
    } finally {
      setZipping(false);
    }
  };


  const csvFilename = (filename: string) => {
    const base = filename.replace(/\.jpe?g$/i, "");
    return appendSuffix ? `${base}${suffix}` : base;
  };

  const isVater = (han: string) => /^vater$/i.test(han.trim());

  const downloadCsv = () => {
    const groupedFiles = new Map<string, string[]>();
    for (const p of processed) {
      if (!groupedFiles.has(p.han)) groupedFiles.set(p.han, []);
      groupedFiles.get(p.han)!.push(csvFilename(p.filename));
    }

    // Resolve per-row files. A "Vater" (parent) row inherits the union of
    // images from the child rows that follow it, up to the next Vater row
    // or end of list. This matches how the pasted list is structured:
    // Vater is always listed immediately before its children, in order.
    const rowFiles: string[][] = groups.map((g, gi) => {
      const han = g.han.trim();
      if (!han) return [];
      if (!isVater(han)) return groupedFiles.get(han) ?? [];
      const seen = new Set<string>();
      const out: string[] = [];
      for (let j = gi + 1; j < groups.length; j++) {
        const childHan = groups[j].han.trim();
        if (!childHan) continue;
        if (isVater(childHan)) break;
        for (const f of groupedFiles.get(childHan) ?? []) {
          if (seen.has(f)) continue;
          seen.add(f);
          out.push(f);
        }
      }
      return out;
    });

    const maxImages = Math.max(0, ...rowFiles.map((f) => f.length));
    const header = ["han", ...Array.from({ length: maxImages }, (_, i) => `Bild${i + 1}`)].join(";");
    const lines: string[] = [header];
    for (let gi = 0; gi < groups.length; gi++) {
      const han = groups[gi].han.trim();
      if (!han) continue;
      const files = rowFiles[gi];
      const cells = Array.from({ length: maxImages }, (_, i) => files[i] ?? "");
      lines.push([han, ...cells].join(";"));
    }
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, "jtl_import.csv");
  };



  const grouped: Record<string, ProcessedItem[]> = {};
  for (const p of processed) {
    grouped[p.han] = grouped[p.han] || [];
    grouped[p.han].push(p);
  }

  const summary = validGroups
    .map((g) => {
      const han = g.han.trim();
      const items = grouped[han] ?? [];
      return { han, count: items.length, files: items.map((p) => csvFilename(p.filename)) };
    })
    .filter((r) => r.count > 0);

  const maxImages = Math.max(0, ...summary.map((r) => r.count));

  const applyCustomCrop = async (
    target: ProcessedItem,
    sx: number,
    sy: number,
    sSide: number,
  ) => {
    const src = byId.current.get(target.srcId);
    if (!src) return;
    const el = await loadImageElement(src.url);
    const blob = await processToSquareWithOffset(el, sx, sy, sSide, 1000, maxOutputKiB);
    const url = URL.createObjectURL(blob);
    setProcessed((prev) =>
      prev.map((p) => {
        if (p.id !== target.id) return p;
        URL.revokeObjectURL(p.url);
        return { ...p, blob, url };
      }),
    );
  };

  return (
    <div className="fade-in space-y-6">
      {processing && (
        <div className="rounded-md border border-border bg-surface p-5">
          <div className="mb-3 flex items-center justify-between font-mono text-xs">
            <span>
              Processing image {progress.done} of {progress.total}…
            </span>
            <span className="text-muted-foreground">{progress.label}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all"
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {done && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-success/30 bg-success/5 px-4 py-3">
            <span className="font-mono text-xs text-success">
              ✅ Done · {processed.length} images processed across {Object.keys(grouped).length} groups · max {maxOutputKiB} KiB · double-click any image to re-crop
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="add label..."
                className="h-9 w-44 rounded-md border border-border bg-surface px-3 font-mono text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={downloadZip}
                disabled={zipping || processed.length === 0}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                {zipping ? "Building ZIP…" : "⬬ Download Images (ZIP)"}
              </button>
              <button
                type="button"
                onClick={downloadCsv}
                disabled={summary.length === 0}
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-elevated disabled:opacity-40"
              >
                ⬬ Download CSV (JTL Import)
              </button>
            </div>
          </div>

          <div className="space-y-6">
            {Object.entries(grouped).map(([han, items]) => (
              <div key={han}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{han}</span>
                  <span className="rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {items.length} imgs
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {items.map((p) => {
                    const kib = p.blob.size / 1024;
                    const outOfRange = kib > maxOutputKiB;
                    const sizeStr = `${kib.toFixed(0)} KiB`;
                    return (
                      <div
                        key={p.id}
                        className="rounded-md border border-border bg-surface p-2"
                        title="Double-click to open crop editor"
                      >
                        <div
                          className="aspect-square cursor-zoom-in overflow-hidden rounded bg-white"
                          onDoubleClick={() => setCropTarget(p)}
                        >
                          <img src={p.url} alt={p.filename} className="h-full w-full object-contain" />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 px-0.5">
                          <div className="truncate font-mono text-[11px]" title={p.filename}>
                            {p.filename}
                          </div>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                              outOfRange
                                ? "bg-warning/10 text-warning"
                                : "text-muted-foreground"
                            }`}
                            title={outOfRange ? `Over ${maxOutputKiB} KiB limit` : "File size"}
                          >
                            {outOfRange ? `⚠ ${sizeStr}` : sizeStr}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded-md border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 font-mono text-xs">
                <input
                  type="checkbox"
                  checked={appendSuffix}
                  onChange={(e) => setAppendSuffix(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Append filename suffix in CSV
              </label>
              <input
                type="text"
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
                disabled={!appendSuffix}
                placeholder=".jpg"
                className="w-24 rounded border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:border-primary disabled:opacity-40"
              />
              <span className="font-mono text-[10px] text-muted-foreground">
                Affects only the CSV export, not the ZIP filenames.
              </span>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-border bg-surface">
            <table className="w-full">
              <thead className="bg-surface-elevated">
                <tr className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left">HAN</th>
                  <th className="px-3 py-2 text-left">Processed</th>
                  {Array.from({ length: maxImages }, (_, i) => (
                    <th key={i} className="px-3 py-2 text-left">{`Bild${i + 1}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-xs">
                {summary.map((r) => (
                  <tr key={r.han}>
                    <td className="px-3 py-2 font-semibold">{r.han}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.count}</td>
                    {Array.from({ length: maxImages }, (_, i) => (
                      <td key={i} className="px-3 py-2">{r.files[i] ?? ""}</td>
                    ))}
                  </tr>
                ))}
                {summary.length === 0 && (
                  <tr>
                    <td colSpan={2 + maxImages} className="px-3 py-6 text-center text-muted-foreground">
                      Nothing to export
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {cropTarget && (
        <CropEditor
          target={cropTarget}
          srcImage={byId.current.get(cropTarget.srcId) ?? null}
          onClose={() => setCropTarget(null)}
          onApply={async (sx, sy, sSide) => {
            await applyCustomCrop(cropTarget, sx, sy, sSide);
            setCropTarget(null);
          }}
        />
      )}
    </div>
  );
}

function CropEditor({
  target,
  srcImage,
  onClose,
  onApply,
}: {
  target: ProcessedItem;
  srcImage: LoadedImage | null;
  onClose: () => void;
  onApply: (sx: number, sy: number, sSide: number) => Promise<void>;
}) {
  const [el, setEl] = useState<HTMLImageElement | null>(null);
  const [sSide, setSSide] = useState(0);
  const [sx, setSx] = useState(0);
  const [sy, setSy] = useState(0);
  const [busy, setBusy] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<{ startX: number; startY: number; sx: number; sy: number } | null>(null);

  useEffect(() => {
    if (!srcImage) return;
    let alive = true;
    loadImageElement(srcImage.url).then((img) => {
      if (!alive) return;
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      setEl(img);
      setSSide(side);
      setSx(Math.floor((img.naturalWidth - side) / 2));
      setSy(Math.floor((img.naturalHeight - side) / 2));
    });
    return () => {
      alive = false;
    };
  }, [srcImage]);

  const VIEW = 480;
  const scale = useMemo(() => (sSide > 0 ? VIEW / sSide : 1), [sSide]);

  const clamp = (x: number, y: number) => {
    if (!el) return { x, y };
    const maxX = el.naturalWidth - sSide;
    const maxY = el.naturalHeight - sSide;
    return {
      x: Math.max(0, Math.min(maxX, x)),
      y: Math.max(0, Math.min(maxY, y)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = { startX: e.clientX, startY: e.clientY, sx, sy };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragging.current;
    if (!d || !el) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    // Dragging image right should reveal more of its left side → crop sx decreases
    const next = clamp(d.sx - dx, d.sy - dy);
    setSx(next.x);
    setSy(next.y);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragging.current = null;
  };

  const apply = async () => {
    setBusy(true);
    try {
      await onApply(Math.round(sx), Math.round(sy), Math.round(sSide));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-mono text-sm font-semibold">Crop editor · {target.filename}</h3>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              Drag to reposition · output stays 1000 × 1000 px
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 font-mono text-xs text-muted-foreground hover:bg-secondary"
          >
            ✕
          </button>
        </div>

        {!el || !srcImage ? (
          <div className="flex h-[480px] items-center justify-center font-mono text-xs text-muted-foreground">
            Loading source image…
          </div>
        ) : (
          <>
            <div
              ref={viewportRef}
              className="relative mx-auto overflow-hidden rounded border border-border bg-white"
              style={{ width: VIEW, height: VIEW, touchAction: "none", cursor: dragging.current ? "grabbing" : "grab" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <img
                src={srcImage.url}
                alt=""
                draggable={false}
                className="pointer-events-none absolute select-none"
                style={{
                  width: el.naturalWidth * scale,
                  height: el.naturalHeight * scale,
                  left: -sx * scale,
                  top: -sy * scale,
                  maxWidth: "none",
                }}
              />
              <div className="pointer-events-none absolute inset-0 ring-2 ring-primary/60" />
            </div>
            <div className="mt-3 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
              <span>
                source {el.naturalWidth} × {el.naturalHeight}px · crop {Math.round(sSide)} × {Math.round(sSide)}px
              </span>
              <span>
                offset {Math.round(sx)}, {Math.round(sy)}
              </span>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm hover:bg-surface-elevated"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={busy}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                {busy ? "Applying…" : "Apply crop"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
