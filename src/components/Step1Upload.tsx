import { useCallback, useRef, useState } from "react";
import type { LoadedImage } from "@/lib/imagekit";
import {
  detectWhiteBg,
  downloadBlob,
  formatBytes,
  loadImageElement,
  removeBackground,
} from "@/lib/imagekit";
import { cn } from "@/lib/utils";

interface Props {
  images: LoadedImage[];
  folders: string[];
  removeBgApiKey: string;
  onMerge: (imgs: LoadedImage[], folder: string) => void;
  onRemove: (id: string) => void;
  onRemoveAll: () => void;
  onReplace: (id: string, next: LoadedImage) => void;
  onContinue: () => void;
}

export function Step1Upload({
  images,
  folders,
  removeBgApiKey,
  onMerge,
  onRemove,
  onRemoveAll,
  onReplace,
  onContinue,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [bgWorking, setBgWorking] = useState<Set<string>>(new Set());
  const [bgError, setBgError] = useState<Record<string, string>>({});

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (arr.length === 0) return;

      setLoading(true);
      setProgress({ done: 0, total: arr.length });

      // Detect folder name
      let folder = "";
      const first = arr[0] as File & { webkitRelativePath?: string };
      if (first.webkitRelativePath) {
        folder = first.webkitRelativePath.split("/")[0] ?? "";
      }

      const loaded: LoadedImage[] = [];
      for (let i = 0; i < arr.length; i++) {
        const f = arr[i];
        const url = URL.createObjectURL(f);
        try {
          const imgEl = await loadImageElement(url);
          const bg = await detectWhiteBg(imgEl);
          loaded.push({
            id: `${Date.now()}-${i}-${f.name}`,
            file: f,
            filename: f.name,
            size: f.size,
            url,
            width: imgEl.naturalWidth,
            height: imgEl.naturalHeight,
            bg,
          });
        } catch {
          // Skip unreadable images
        }
        setProgress({ done: i + 1, total: arr.length });
      }

      onMerge(loaded, folder);
      setLoading(false);
    },
    [onMerge],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const exportFilenameList = () => {
    const sorted = [...images].sort((a, b) => a.filename.localeCompare(b.filename));
    const txt = sorted.map((i) => i.filename).join("\n");
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, "filename_list.txt");
  };

  const handleRemoveAll = () => {
    if (window.confirm(`Remove all ${images.length} images? This cannot be undone.`)) {
      onRemoveAll();
    }
  };

  const handleRemoveBg = async (img: LoadedImage) => {
    if (!removeBgApiKey) return;
    setBgError((p) => {
      const n = { ...p };
      delete n[img.id];
      return n;
    });
    setBgWorking((p) => new Set(p).add(img.id));
    try {
      const pngBlob = await removeBackground(img.file, removeBgApiKey);
      const newFile = new File([pngBlob], img.filename.replace(/\.[^.]+$/, "") + ".png", {
        type: "image/png",
      });
      const newUrl = URL.createObjectURL(pngBlob);
      const el = await loadImageElement(newUrl);
      const bg = await detectWhiteBg(el);
      onReplace(img.id, {
        ...img,
        file: newFile,
        size: pngBlob.size,
        url: newUrl,
        width: el.naturalWidth,
        height: el.naturalHeight,
        bg,
      });
    } catch (e) {
      setBgError((p) => ({ ...p, [img.id]: e instanceof Error ? e.message : "Failed" }));
    } finally {
      setBgWorking((p) => {
        const n = new Set(p);
        n.delete(img.id);
        return n;
      });
    }
  };

  const whiteCount = images.filter((i) => i.bg === "white").length;
  const modelCount = images.length - whiteCount;

  return (
    <div className="fade-in space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-lg border-2 border-dashed p-10 text-center transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border bg-surface/40 hover:bg-surface/60",
        )}
      >
        <div className="mx-auto flex max-w-lg flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-border bg-surface text-2xl">
            📁
          </div>
          <div>
            <h3 className="text-lg font-semibold">
              {images.length > 0 ? "Add more images or folders" : "Drop images or a folder here"}
            </h3>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              PNG · JPG · WEBP — processed locally, never uploaded · duplicates skipped
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              📁 Select Folder
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-elevated"
            >
              Select Files
            </button>
          </div>
          <input
            ref={folderInputRef}
            type="file"
            multiple
            accept="image/*"
            // @ts-expect-error non-standard attr
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {loading && (
        <div className="rounded-md border border-border bg-surface p-4">
          <div className="flex items-center justify-between font-mono text-xs">
            <span>Loading & analyzing images…</span>
            <span>
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {images.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
            <div className="font-mono text-xs">
              <span className="text-muted-foreground">{images.length} images loaded</span>
              {folders.length > 0 && (
                <>
                  <span className="mx-2 text-muted-foreground">·</span>
                  <span className="text-foreground">from: {folders.join(", ")}</span>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
              <span className="rounded-full border border-border bg-secondary px-2 py-0.5">
                ⬜ {whiteCount} white
              </span>
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary">
                🖼️ {modelCount} model
              </span>
              <button
                type="button"
                onClick={handleRemoveAll}
                className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive hover:bg-destructive/20"
              >
                🗑 Remove All
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((img) => {
              const working = bgWorking.has(img.id);
              const err = bgError[img.id];
              const canRemoveBg = !!removeBgApiKey && !working;
              return (
                <div
                  key={img.id}
                  className="group relative rounded-md border border-border bg-surface p-2 transition-colors hover:border-primary/50"
                >
                  <button
                    type="button"
                    onClick={() => onRemove(img.id)}
                    className="absolute right-1 top-1 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-border bg-background/90 text-xs hover:bg-destructive hover:text-destructive-foreground group-hover:flex"
                    title="Remove image"
                    aria-label="Remove image"
                  >
                    ✕
                  </button>
                  <div className="relative aspect-square overflow-hidden rounded bg-background">
                    <img src={img.url} alt={img.filename} className="h-full w-full object-cover" />
                    <span
                      className={cn(
                        "absolute left-1.5 top-1.5 rounded-full border px-1.5 py-0.5 font-mono text-[9px] backdrop-blur",
                        img.bg === "white"
                          ? "border-border bg-background/80 text-muted-foreground"
                          : "border-primary/40 bg-primary/20 text-primary",
                      )}
                    >
                      {img.bg === "white" ? "⬜ White BG" : "🖼️ Model"}
                    </span>
                    {working && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/70 font-mono text-[10px]">
                        🪄 removing bg…
                      </div>
                    )}
                    {err && (
                      <span className="absolute bottom-1.5 left-1.5 rounded-full border border-destructive/50 bg-destructive/20 px-1.5 py-0.5 font-mono text-[9px] text-destructive">
                        BG removal failed
                      </span>
                    )}
                  </div>
                  <div className="mt-2 px-0.5">
                    <div className="truncate font-mono text-[11px]" title={img.filename}>
                      {img.filename}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {formatBytes(img.size)} · {img.width}×{img.height}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveBg(img)}
                    disabled={!canRemoveBg}
                    title={removeBgApiKey ? "Remove background via remove.bg" : "Add API key in settings"}
                    className="mt-2 w-full rounded border border-border bg-surface-elevated px-2 py-1 font-mono text-[10px] hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    🪄 Remove BG
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={exportFilenameList}
              className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-elevated"
            >
              📋 Export Filename List
            </button>
            <button
              type="button"
              onClick={onContinue}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Continue to SKU Assignment →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
