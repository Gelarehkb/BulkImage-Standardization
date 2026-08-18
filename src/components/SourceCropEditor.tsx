import { useEffect, useMemo, useRef, useState } from "react";
import type { LoadedImage } from "@/lib/imagekit";
import { loadImageElement } from "@/lib/imagekit";

/**
 * Step 1 adjust/crop editor: lets the user pan + zoom a square crop frame over
 * the ORIGINAL uploaded image and replace it with the cropped version.
 */
export function SourceCropEditor({
  image,
  onClose,
  onApply,
}: {
  image: LoadedImage;
  onClose: () => void;
  onApply: (next: LoadedImage) => void;
}) {
  const [el, setEl] = useState<HTMLImageElement | null>(null);
  const [sSide, setSSide] = useState(0);
  const [sx, setSx] = useState(0);
  const [sy, setSy] = useState(0);
  const [busy, setBusy] = useState(false);
  const dragging = useRef<{ startX: number; startY: number; sx: number; sy: number } | null>(null);

  useEffect(() => {
    let alive = true;
    loadImageElement(image.url).then((img) => {
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
  }, [image.url]);

  const VIEW = 460;
  const scale = useMemo(() => (sSide > 0 ? VIEW / sSide : 1), [sSide]);
  const maxSide = el ? Math.min(el.naturalWidth, el.naturalHeight) : 0;

  const clamp = (x: number, y: number, side = sSide) => {
    if (!el) return { x, y };
    return {
      x: Math.max(0, Math.min(el.naturalWidth - side, x)),
      y: Math.max(0, Math.min(el.naturalHeight - side, y)),
    };
  };

  const setZoom = (nextSide: number) => {
    if (!el) return;
    const side = Math.max(Math.round(maxSide * 0.15), Math.min(maxSide, Math.round(nextSide)));
    const cx = sx + sSide / 2;
    const cy = sy + sSide / 2;
    const next = clamp(cx - side / 2, cy - side / 2, side);
    setSSide(side);
    setSx(next.x);
    setSy(next.y);
  };

  const apply = async () => {
    if (!el) return;
    setBusy(true);
    try {
      const side = Math.round(sSide);
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unsupported");
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, side, side);
      ctx.drawImage(el, Math.round(sx), Math.round(sy), side, side, 0, 0, side, side);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.95),
      );
      const name = image.filename.replace(/\.[^.]+$/, "") + ".jpg";
      const file = new File([blob], name, { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      onApply({
        ...image,
        file,
        filename: name,
        size: blob.size,
        url,
        width: side,
        height: side,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-lg border border-border bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="truncate font-mono text-xs" title={image.filename}>
            ✂️ Adjust · {image.filename}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-2 py-1 font-mono text-[11px] hover:bg-secondary"
          >
            ✕
          </button>
        </div>

        <div
          className="relative mx-auto touch-none overflow-hidden rounded border border-border bg-background"
          style={{ width: VIEW, height: VIEW, maxWidth: "100%" }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            dragging.current = { startX: e.clientX, startY: e.clientY, sx, sy };
          }}
          onPointerMove={(e) => {
            const d = dragging.current;
            if (!d || !el) return;
            const next = clamp(d.sx - (e.clientX - d.startX) / scale, d.sy - (e.clientY - d.startY) / scale);
            setSx(next.x);
            setSy(next.y);
          }}
          onPointerUp={(e) => {
            (e.target as HTMLElement).releasePointerCapture(e.pointerId);
            dragging.current = null;
          }}
        >
          {el && (
            <img
              src={image.url}
              alt={image.filename}
              draggable={false}
              className="absolute max-w-none select-none"
              style={{
                width: el.naturalWidth * scale,
                height: el.naturalHeight * scale,
                left: -sx * scale,
                top: -sy * scale,
              }}
            />
          )}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Crop size
          </span>
          <input
            type="range"
            min={Math.round(maxSide * 0.15) || 1}
            max={maxSide || 1}
            value={sSide}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1"
          />
          <span className="font-mono text-[10px] text-muted-foreground">
            {Math.round(sSide)}px
          </span>
        </div>

        <p className="mt-2 font-mono text-[10px] text-muted-foreground">
          Drag the image to reposition · square crop
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={busy || !el}
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Applying…" : "Apply crop"}
          </button>
        </div>
      </div>
    </div>
  );
}
