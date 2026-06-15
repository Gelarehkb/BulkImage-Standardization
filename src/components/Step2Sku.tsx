import { useMemo, useState } from "react";
import type { LoadedImage, SkuGroup } from "@/lib/imagekit";
import { detectWhiteBg, loadImageElement, matchSkus, removeBackground } from "@/lib/imagekit";
import { SkuFileImport } from "@/components/SkuFileImport";
import { cn } from "@/lib/utils";

interface Props {
  images: LoadedImage[];
  groups: SkuGroup[];
  unmatchedIds: string[];
  skippedIds: Set<string>;
  skuText: string;
  maxOutputKiB: number;
  onMaxOutputKiBChange: (n: number) => void;
  onReplace: (id: string, next: LoadedImage) => void;
  onAddImage: (img: LoadedImage) => void;
  onChange: (state: {
    groups: SkuGroup[];
    unmatchedIds: string[];
    skippedIds: Set<string>;
    skuText: string;
  }) => void;
  onContinue: () => void;
}

export function Step2Sku({
  images,
  groups,
  unmatchedIds,
  skippedIds,
  skuText,
  maxOutputKiB,
  onMaxOutputKiBChange,
  onReplace,
  onAddImage,
  onChange,
  onContinue,
}: Props) {

  const [assignInputs, setAssignInputs] = useState<Record<string, string>>({});
  const [unmatchedOpen, setUnmatchedOpen] = useState(true);
  const [batchBg, setBatchBg] = useState<{ active: boolean; done: number; total: number; failed: number }>(
    { active: false, done: 0, total: 0, failed: 0 },
  );

  const runBatchRemoveBg = async () => {
    const targets = images.filter((i) => i.bg !== "white");
    if (targets.length === 0) return;
    setBatchBg({ active: true, done: 0, total: targets.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      const img = targets[i];
      try {
        const pngBlob = await removeBackground(img.file);
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
      } catch {
        failed++;
      }
      setBatchBg({ active: true, done: i + 1, total: targets.length, failed });
    }
    setBatchBg((p) => ({ ...p, active: false }));
  };

  const byId = useMemo(() => new Map(images.map((i) => [i.id, i])), [images]);

  const matchedCount = groups.reduce((acc, g) => acc + g.imageIds.length, 0);
  const unmatchedCount = unmatchedIds.filter((id) => !skippedIds.has(id)).length;
  const readyGroups = groups.filter((g) => g.imageIds.length > 0).length;

  const runMatch = () => {
    const skus = skuText.split("\n").map((s) => s.trim()).filter(Boolean);
    const { groups: g, unmatched } = matchSkus(skus, images);
    onChange({ groups: g, unmatchedIds: unmatched, skippedIds: new Set(), skuText });
  };

  const updateHan = (oldHan: string, newHan: string) => {
    onChange({
      groups: groups.map((g) => (g.han === oldHan ? { ...g, han: newHan } : g)),
      unmatchedIds,
      skippedIds,
      skuText,
    });
  };

  const reorderInGroup = (han: string, fromIdx: number, toIdx: number) => {
    onChange({
      groups: groups.map((g) => {
        if (g.han !== han) return g;
        const ids = [...g.imageIds];
        const [moved] = ids.splice(fromIdx, 1);
        ids.splice(toIdx, 0, moved);
        return { ...g, imageIds: ids };
      }),
      unmatchedIds,
      skippedIds,
      skuText,
    });
  };

  const assignToGroup = (imageId: string, han: string) => {
    const target = han.trim();
    if (!target) return;
    let nextGroups = [...groups];
    const existing = nextGroups.find((g) => g.han === target);
    if (existing) {
      nextGroups = nextGroups.map((g) =>
        g.han === target ? { ...g, imageIds: [...g.imageIds, imageId] } : g,
      );
    } else {
      nextGroups.push({ han: target, imageIds: [imageId] });
    }
    onChange({
      groups: nextGroups,
      unmatchedIds: unmatchedIds.filter((id) => id !== imageId),
      skippedIds,
      skuText,
    });
    setAssignInputs((p) => {
      const n = { ...p };
      delete n[imageId];
      return n;
    });
  };

  const toggleSkip = (imageId: string) => {
    const next = new Set(skippedIds);
    if (next.has(imageId)) next.delete(imageId);
    else next.add(imageId);
    onChange({ groups, unmatchedIds, skippedIds: next, skuText });
  };

  const removeFromGroup = (han: string, imageId: string) => {
    onChange({
      groups: groups.map((g) =>
        g.han === han ? { ...g, imageIds: g.imageIds.filter((i) => i !== imageId) } : g,
      ),
      unmatchedIds: unmatchedIds.includes(imageId) ? unmatchedIds : [...unmatchedIds, imageId],
      skippedIds,
      skuText,
    });
  };

  const moveBetweenGroups = (fromHan: string, toHan: string, imageId: string) => {
    if (fromHan === toHan) return;
    onChange({
      groups: groups.map((g) => {
        if (g.han === fromHan) return { ...g, imageIds: g.imageIds.filter((i) => i !== imageId) };
        if (g.han === toHan)
          return {
            ...g,
            imageIds: g.imageIds.includes(imageId) ? g.imageIds : [...g.imageIds, imageId],
          };
        return g;
      }),
      unmatchedIds,
      skippedIds,
      skuText,
    });
  };


  const hasMatched = groups.length > 0 || unmatchedIds.length > 0;

  return (
    <div className="fade-in grid gap-6 lg:grid-cols-[380px_1fr]">
      {/* LEFT */}
      <div className="space-y-4">
        <SkuFileImport
          onPick={(skus) =>
            onChange({ groups, unmatchedIds, skippedIds, skuText: skus.join("\n") })
          }
        />

        <div className="rounded-md border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Paste SKU / HAN list
            </h3>
            <span className="font-mono text-[10px] text-muted-foreground">
              one per line
            </span>
          </div>
          <textarea
            value={skuText}
            onChange={(e) =>
              onChange({ groups, unmatchedIds, skippedIds, skuText: e.target.value })
            }
            placeholder={"12345\n67890\n11223\n..."}
            className="scrollbar-thin h-72 w-full resize-none rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={runMatch}
            disabled={!skuText.trim()}
            className="mt-3 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            🔍 Match SKUs
          </button>
        </div>

        {hasMatched && (
          <div className="space-y-2 rounded-md border border-border bg-surface p-4">
            <div className="flex flex-wrap gap-2 font-mono text-[11px]">
              <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-success">
                ✅ {matchedCount} matched
              </span>
              <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-warning">
                ⚠️ {unmatchedCount} unmatched
              </span>
              <span className="rounded-full border border-border bg-secondary px-2 py-0.5">
                {readyGroups} ready groups
              </span>
            </div>
          </div>
        )}

        <div className="space-y-2 rounded-md border border-border bg-surface p-4">
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Background removal (batch)
          </h3>
          <p className="font-mono text-[10px] text-muted-foreground">
            Runs locally in your browser on every image not detected as white-bg. First run downloads the model (~40MB).
          </p>
          <button
            type="button"
            onClick={runBatchRemoveBg}
            disabled={batchBg.active || images.every((i) => i.bg === "white")}
            title="Process all model images"
            className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
          >
            🪄 Remove BG from all Model images
          </button>
          {batchBg.total > 0 && (
            <div className="font-mono text-[10px] text-muted-foreground">
              {batchBg.done} / {batchBg.total} processed
              {batchBg.failed > 0 && ` · ${batchBg.failed} failed`}
              {!batchBg.active && batchBg.done === batchBg.total && " · ✅ done"}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT */}
      <div className="space-y-6">
        {!hasMatched ? (
          <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-border bg-surface/40">
            <p className="font-mono text-xs text-muted-foreground">
              Paste SKUs and click Match to see grouped results
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-md border border-border bg-surface">
              <table className="w-full">
                <thead className="bg-surface-elevated">
                  <tr className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="w-44 px-3 py-2 text-left">HAN</th>
                    <th className="w-16 px-3 py-2 text-left">Imgs</th>
                    <th className="px-3 py-2 text-left">Preview · drag to reorder</th>
                    <th className="w-24 px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {groups.map((g) => (
                    <GroupRow
                      key={g.han}
                      group={g}
                      byId={byId}
                      onUpdateHan={(v) => updateHan(g.han, v)}
                      onReorder={(from, to) => reorderInGroup(g.han, from, to)}
                      onRemove={(id) => removeFromGroup(g.han, id)}
                      onMoveIn={(fromHan, imageId) => moveBetweenGroups(fromHan, g.han, imageId)}
                      onAssignUnmatched={(imageId) => assignToGroup(imageId, g.han)}
                    />
                  ))}
                  {groups.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center font-mono text-xs text-muted-foreground">
                        No SKU groups yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {unmatchedIds.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/5">
                <button
                  type="button"
                  onClick={() => setUnmatchedOpen((o) => !o)}
                  className="flex w-full items-center justify-between px-4 py-3"
                >
                  <span className="font-mono text-xs">
                    ⚠️ Unmatched · {unmatchedIds.length}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {unmatchedOpen ? "▾" : "▸"}
                  </span>
                </button>
                {unmatchedOpen && (
                  <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2 xl:grid-cols-3">
                    {unmatchedIds.map((id) => {
                      const img = byId.get(id);
                      if (!img) return null;
                      const skipped = skippedIds.has(id);
                      return (
                        <div
                          key={id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData(
                              "application/x-han-image",
                              JSON.stringify({ fromHan: null, imageId: id }),
                            );
                          }}
                          className={cn(
                            "cursor-grab rounded-md border border-border bg-surface p-2 active:cursor-grabbing",
                            skipped && "opacity-50",
                          )}
                          title="Drag onto a HAN row to assign"
                        >
                          <div className="flex gap-3">
                            <img
                              src={img.url}
                              alt=""
                              className="pointer-events-none h-16 w-16 shrink-0 rounded object-cover"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-mono text-[11px]" title={img.filename}>
                                {img.filename}
                              </div>
                              <div className="mt-2 flex gap-1">
                                <input
                                  value={assignInputs[id] ?? ""}
                                  onChange={(e) =>
                                    setAssignInputs((p) => ({ ...p, [id]: e.target.value }))
                                  }
                                  placeholder="HAN"
                                  className="w-full min-w-0 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-primary"
                                />
                                <button
                                  type="button"
                                  onClick={() => assignToGroup(id, assignInputs[id] ?? "")}
                                  className="shrink-0 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                                >
                                  Add
                                </button>
                              </div>
                              <label className="mt-2 flex cursor-pointer items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                                <input
                                  type="checkbox"
                                  checked={skipped}
                                  onChange={() => toggleSkip(id)}
                                  className="h-3 w-3 accent-primary"
                                />
                                Skip this image
                              </label>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onContinue}
                disabled={readyGroups === 0}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                ⚙️ Process & Export →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GroupRow({
  group,
  byId,
  onUpdateHan,
  onReorder,
  onRemove,
  onMoveIn,
  onAssignUnmatched,
}: {
  group: SkuGroup;
  byId: Map<string, LoadedImage>;
  onUpdateHan: (v: string) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  onMoveIn: (fromHan: string, imageId: string) => void;
  onAssignUnmatched: (imageId: string) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const ready = group.imageIds.length > 0;
  const visible = expanded ? group.imageIds : group.imageIds.slice(0, 5);
  const extra = group.imageIds.length - visible.length;

  const handleCellDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData("application/x-han-image");
    if (!raw) return;
    try {
      const { fromHan, imageId } = JSON.parse(raw) as { fromHan: string | null; imageId: string };
      if (!imageId) return;
      if (fromHan === null) onAssignUnmatched(imageId);
      else if (fromHan !== group.han) onMoveIn(fromHan, imageId);
    } catch {
      /* ignore */
    }
  };

  return (
    <tr className="hover:bg-surface-elevated/50">
      <td className="px-3 py-2 align-middle">
        <input
          value={group.han}
          onChange={(e) => onUpdateHan(e.target.value)}
          className="w-full rounded border border-transparent bg-transparent px-2 py-1 font-mono text-sm outline-none hover:border-border focus:border-primary focus:bg-background"
        />
      </td>
      <td className="px-3 py-2 align-middle">
        <span className="font-mono text-xs">{group.imageIds.length}</span>
      </td>
      <td
        className="px-3 py-2 align-middle"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleCellDrop}
      >
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-md p-1 transition",
            dragOver && "bg-primary/10 ring-2 ring-primary/40",
          )}
        >
          {visible.map((id, idx) => {
            const img = byId.get(id);
            if (!img) return null;
            return (
              <div
                key={id}
                draggable
                onDragStart={(e) => {
                  setDragIdx(idx);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(
                    "application/x-han-image",
                    JSON.stringify({ fromHan: group.han, imageId: id }),
                  );
                }}
                onDragEnd={() => setDragIdx(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const raw = e.dataTransfer.getData("application/x-han-image");
                  let fromHan: string | null = null;
                  let imageId: string | null = null;
                  let hasPayload = false;
                  try {
                    const p = JSON.parse(raw);
                    fromHan = p.fromHan;
                    imageId = p.imageId;
                    hasPayload = true;
                  } catch {
                    /* ignore */
                  }
                  if (hasPayload && imageId && fromHan === null) {
                    e.stopPropagation();
                    setDragOver(false);
                    onAssignUnmatched(imageId);
                  } else if (hasPayload && fromHan && fromHan !== group.han && imageId) {
                    e.stopPropagation();
                    setDragOver(false);
                    onMoveIn(fromHan, imageId);
                  } else if (dragIdx !== null && dragIdx !== idx) {
                    e.stopPropagation();
                    onReorder(dragIdx, idx);
                  }
                  setDragIdx(null);
                }}
                className={cn(
                  "group/thumb relative h-12 w-12 cursor-grab overflow-hidden rounded border border-border active:cursor-grabbing",
                  dragIdx === idx && "ring-2 ring-primary",
                )}
                title={img.filename}
              >
                <img src={img.url} alt="" className="h-full w-full object-cover" />
                <span className="absolute bottom-0 left-0 bg-background/80 px-1 font-mono text-[9px]">
                  {idx + 1}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(id);
                  }}
                  aria-label="Remove from group"
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background/90 font-mono text-[10px] leading-none text-foreground opacity-0 transition hover:bg-destructive hover:text-destructive-foreground group-hover/thumb:opacity-100"
                >
                  ×
                </button>
              </div>
            );
          })}
          {extra > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
              title={expanded ? "Show fewer" : `Show ${extra} more`}
            >
              {expanded ? "−" : `+${extra}`}
            </button>
          )}
          {group.imageIds.length === 0 && (
            <span className="rounded border border-dashed border-warning/40 px-2 py-1 font-mono text-[10px] text-muted-foreground">
              drop unassigned image here
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        {ready ? (
          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 font-mono text-[10px] text-success">
            ✅ Ready
          </span>
        ) : (
          <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 font-mono text-[10px] text-warning">
            ⚠️ Empty
          </span>
        )}
      </td>
    </tr>
  );
}
