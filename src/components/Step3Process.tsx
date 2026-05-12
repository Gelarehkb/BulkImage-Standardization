import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import type { LoadedImage, ProcessedImage, SkuGroup } from "@/lib/imagekit";
import { downloadBlob, loadImageElement, processToSquare } from "@/lib/imagekit";

interface Props {
  images: LoadedImage[];
  groups: SkuGroup[];
  skippedIds: Set<string>;
}

export function Step3Process({ images, groups, skippedIds }: Props) {
  const byId = useRef(new Map(images.map((i) => [i.id, i])));
  byId.current = new Map(images.map((i) => [i.id, i]));

  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [processed, setProcessed] = useState<ProcessedImage[]>([]);
  const [zipping, setZipping] = useState(false);
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
    const all: ProcessedImage[] = [];
    const total = validGroups.reduce(
      (acc, g) => acc + g.imageIds.filter((id) => !skippedIds.has(id)).length,
      0,
    );
    setProgress({ done: 0, total, label: "" });

    let i = 0;
    for (const g of validGroups) {
      const han = g.han.trim();
      let seq = 0;
      for (const id of g.imageIds) {
        if (skippedIds.has(id)) continue;
        const src = byId.current.get(id);
        if (!src) continue;
        seq++;
        i++;
        setProgress({ done: i, total, label: `${han}_${seq}.jpg` });
        try {
          const el = await loadImageElement(src.url);
          const blob = await processToSquare(el, 1000, src.bg === "white");
          const url = URL.createObjectURL(blob);
          all.push({
            id: `${han}-${seq}`,
            han,
            filename: `${han}_${seq}.jpg`,
            blob,
            url,
          });
        } catch {
          // skip on error
        }
      }
    }

    setProcessed(all);
    setProcessing(false);
    setDone(true);
  };

  const downloadZip = async () => {
    setZipping(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder("processed");
      if (!folder) throw new Error("Failed to create folder");
      for (const p of processed) folder.file(p.filename, p.blob);
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, "processed_images.zip");
    } catch (e) {
      console.error(e);
      alert("Failed to build ZIP. Please try again.");
    } finally {
      setZipping(false);
    }
  };

  const downloadCsv = () => {
    const lines: string[] = ["han;Bild1;Bild2;Bild3;Bild4"];
    // Group processed by HAN preserving order from validGroups
    const grouped = new Map<string, string[]>();
    for (const p of processed) {
      if (!grouped.has(p.han)) grouped.set(p.han, []);
      grouped.get(p.han)!.push(p.filename);
    }
    for (const g of validGroups) {
      const han = g.han.trim();
      const files = grouped.get(han) ?? [];
      if (files.length === 0) continue;
      const cells = [files[0] ?? "", files[1] ?? "", files[2] ?? "", files[3] ?? ""];
      lines.push([han, ...cells].join(";"));
    }
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, "jtl_import.csv");
  };

  // Group processed for grid display
  const grouped: Record<string, ProcessedImage[]> = {};
  for (const p of processed) {
    grouped[p.han] = grouped[p.han] || [];
    grouped[p.han].push(p);
  }

  const summary = validGroups
    .map((g) => {
      const han = g.han.trim();
      const files = (grouped[han] ?? []).map((p) => p.filename);
      return { han, count: files.length, b: [files[0], files[1], files[2], files[3]] };
    })
    .filter((r) => r.count > 0);

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
              ✅ Done · {processed.length} images processed across {Object.keys(grouped).length} groups
            </span>
            <div className="flex flex-wrap gap-2">
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
                  {items.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-md border border-border bg-surface p-2"
                    >
                      <div className="aspect-square overflow-hidden rounded bg-white">
                        <img src={p.url} alt={p.filename} className="h-full w-full object-contain" />
                      </div>
                      <div className="mt-2 truncate px-0.5 font-mono text-[11px]" title={p.filename}>
                        {p.filename}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-md border border-border bg-surface">
            <table className="w-full">
              <thead className="bg-surface-elevated">
                <tr className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left">HAN</th>
                  <th className="px-3 py-2 text-left">Processed</th>
                  <th className="px-3 py-2 text-left">Bild1</th>
                  <th className="px-3 py-2 text-left">Bild2</th>
                  <th className="px-3 py-2 text-left">Bild3</th>
                  <th className="px-3 py-2 text-left">Bild4</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-xs">
                {summary.map((r) => (
                  <tr key={r.han}>
                    <td className="px-3 py-2 font-semibold">{r.han}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.count}</td>
                    <td className="px-3 py-2">{r.b[0] ?? ""}</td>
                    <td className="px-3 py-2">{r.b[1] ?? ""}</td>
                    <td className="px-3 py-2">{r.b[2] ?? ""}</td>
                    <td className="px-3 py-2">{r.b[3] ?? ""}</td>
                  </tr>
                ))}
                {summary.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      Nothing to export
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
