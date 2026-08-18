import { useEffect, useMemo, useRef, useState } from "react";
import type { LoadedImage } from "@/lib/imagekit";
import { loadImageElement } from "@/lib/imagekit";

/**
 * Step 1 adjust editor: lets the user either crop a square from the source or
 * expand the source onto a square canvas filled with a background color.
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
  const [mode, setMode] = useState<"crop" | "expand">(
    image.mode === "expand" ? "expand" : "crop",
  );
  const [bgColor, setBgColor] = useState(image.bgColor || "#FFFFFF");

  // Crop-mode state
  const [sSide, setSSide] = useState(0);
  const [sx, setSx] = useState(0);
  const [sy, setSy] = useState(0);

  // Expand-mode state
  const [eSide, setESide] = useState(0);
  const [expandZoom, setExpandZoom] = useState(1);
  const [expandX, setExpandX] = useState(0);
  const [expandY, setExpandY] = useState(0);

  const [busy, setBusy] = useState(false);
  const dragging = useRef<{ startX: number; startY: number; sx: number; sy: number } | null>(null);

  const VIEW = 460;

  useEffect(() => {
    let alive = true;
    loadImageElement(image.url).then((img) => {
      if (!alive) return;
      setEl(img);
      const minSide = Math.min(img.naturalWidth, img.naturalHeight);
      const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
      setSSide(minSide);
      setSx(Math.floor((img.naturalWidth - minSide) / 2));
      setSy(Math.floor((img.naturalHeight - minSide) / 2));
      setESide(maxSide);
      setExpandZoom(1);
      setExpandX(0);
      setExpandY(0);
    });
    return () => {
      alive = false;
    };
  }, [image.url]);

  const maxCropSide = el ? Math.min(el.naturalWidth, el.naturalHeight) : 0;
  const maxExpandSide = el ? Math.max(el.naturalWidth, el.naturalHeight) : 0;

  const resetCrop = () => {
    if (!el) return;
    const side = Math.min(el.naturalWidth, el.naturalHeight);
    setSSide(side);
    setSx(Math.floor((el.naturalWidth - side) / 2));
    setSy(Math.floor((el.naturalHeight - side) / 2));
  };

  const resetExpand = () => {
    if (!el) return;
    setESide(Math.max(el.naturalWidth, el.naturalHeight));
    setExpandZoom(1);
    setExpandX(0);
    setExpandY(0);
  };

  const scale = useMemo(() => {
    if (mode === "crop") return sSide > 0 ? VIEW / sSide : 1;
    return eSide > 0 ? VIEW / eSide : 1;
  }, [mode, sSide, eSide]);

  const clampCrop = (x: number, y: number, side = sSide) => {
    if (!el) return { x, y };
    return {
      x: Math.max(0, Math.min(el.naturalWidth - side, x)),
      y: Math.max(0, Math.min(el.naturalHeight - side, y)),
    };
  };

  const setCropZoom = (nextSide: number) => {
    if (!el) return;
    const side = Math.max(
      Math.round(maxCropSide * 0.15),
      Math.min(maxCropSide, Math.round(nextSide)),
    );
    const cx = sx + sSide / 2;
    const cy = sy + sSide / 2;
    const next = clampCrop(cx - side / 2, cy - side / 2, side);
    setSSide(side);
    setSx(next.x);
    setSy(next.y);
  };

  const clampExpand = (x: number, y: number) => {
    if (!el) return { x, y };
    const limit = eSide * 1.5;
    return {
      x: Math.max(-limit, Math.min(limit, x)),
      y: Math.max(-limit, Math.min(limit, y)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (mode === "crop") {
      dragging.current = { startX: e.clientX, startY: e.clientY, sx, sy };
    } else {
      dragging.current = { startX: e.clientX, startY: e.clientY, sx: expandX, sy: expandY };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragging.current;
    if (!d || !el) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    if (mode === "crop") {
      const next = clampCrop(d.sx - dx, d.sy - dy);
      setSx(next.x);
      setSy(next.y);
    } else {
      const next = clampExpand(d.sx - dx, d.sy - dy);
      setExpandX(next.x);
      setExpandY(next.y);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragging.current = null;
  };

  const apply = async () => {
    if (!el) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unsupported");
      ctx.imageSmoothingQuality = "high";

      let outWidth: number;
      let outHeight: number;

      if (mode === "crop") {
        const side = Math.round(sSide);
        canvas.width = side;
        canvas.height = side;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, side, side);
        ctx.drawImage(el, Math.round(sx), Math.round(sy), side, side, 0, 0, side, side);
        outWidth = side;
        outHeight = side;
      } else {
        const side = Math.round(eSide);
        canvas.width = side;
        canvas.height = side;
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, side, side);
        const iw = el.naturalWidth * expandZoom;
        const ih = el.naturalHeight * expandZoom;
        const dx = side / 2 + expandX - iw / 2;
        const dy = side / 2 + expandY - ih / 2;
        ctx.drawImage(el, 0, 0, el.naturalWidth, el.naturalHeight, dx, dy, iw, ih);
        outWidth = side;
        outHeight = side;
      }

      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("encode failed"))),
          "image/jpeg",
          0.95,
        ),
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
        width: outWidth,
        height: outHeight,
        mode,
        bgColor: mode === "expand" ? bgColor : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const imgStyle = useMemo(() => {
    if (!el) return {};
    if (mode === "crop") {
      return {
        width: el.naturalWidth * scale,
        height: el.naturalHeight * scale,
        left: -sx * scale,
        top: -sy * scale,
      };
    }
    const iw = el.naturalWidth * expandZoom * scale;
    const ih = el.naturalHeight * expandZoom * scale;
    return {
      width: iw,
      height: ih,
      left: VIEW / 2 - iw / 2 + expandX * scale,
      top: VIEW / 2 - ih / 2 + expandY * scale,
    };
  }, [el, mode, scale, sx, sy, expandZoom, expandX, expandY]);

  const modeBtn = (target: "crop" | "expand", label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(target);
        if (target === "crop") resetCrop();
        else resetExpand();
      }}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        mode === target
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-surface hover:bg-surface-elevated"
      }`}
    >
      {label}
    </button>
  );

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

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {modeBtn("crop", "✂️ Crop to square")}
          {modeBtn("expand", "⬜ Expand background")}
        </div>

        {mode === "expand" && (
          <div className="mb-3 flex items-center gap-3">
            <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Background color
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
                title="Pick background color"
              />
              <input
                type="text"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="w-24 rounded border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setBgColor("#FFFFFF")}
                className="rounded border border-border px-2 py-1 font-mono text-[10px] hover:bg-secondary"
              >
                Reset white
              </button>
            </div>
          </div>
        )}

        <div
          className="relative mx-auto touch-none overflow-hidden rounded border border-border"
          style={{
            width: VIEW,
            height: VIEW,
            maxWidth: "100%",
            backgroundColor: mode === "expand" ? bgColor : "var(--background)",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {el && (
            <img
              src={image.url}
              alt={image.filename}
              draggable={false}
              className="absolute max-w-none select-none"
              style={imgStyle}
            />
          )}
          {mode === "crop" && (
            <div className="pointer-events-none absolute inset-0 ring-2 ring-primary/60" />
          )}
        </div>

        {mode === "crop" ? (
          <div className="mt-3 flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Crop size
            </span>
            <input
              type="range"
              min={Math.round(maxCropSide * 0.15) || 1}
              max={maxCropSide || 1}
              value={sSide}
              onChange={(e) => setCropZoom(Number(e.target.value))}
              className="flex-1"
            />
            <span className="font-mono text-[10px] text-muted-foreground">
              {Math.round(sSide)}px
            </span>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Image scale
            </span>
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.01}
              value={expandZoom}
              onChange={(e) => setExpandZoom(Number(e.target.value))}
              className="flex-1"
            />
            <span className="font-mono text-[10px] text-muted-foreground">
              {(expandZoom * 100).toFixed(0)}%
            </span>
          </div>
        )}

        <p className="mt-2 font-mono text-[10px] text-muted-foreground">
          {mode === "crop"
            ? "Drag the image to reposition · square crop"
            : "Drag to position the image inside the square background · missing area is filled with the chosen color"}
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
            {busy ? "Applying…" : mode === "crop" ? "Apply crop" : "Apply expansion"}
          </button>
        </div>
      </div>
    </div>
  );
}
