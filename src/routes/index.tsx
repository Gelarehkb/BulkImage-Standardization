import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Stepper } from "@/components/Stepper";
import { Step1Upload } from "@/components/Step1Upload";
import { Step2Sku } from "@/components/Step2Sku";
import { Step3Process } from "@/components/Step3Process";
import type { LoadedImage, SkuGroup } from "@/lib/imagekit";

export const Route = createFileRoute("/")({
  component: ImageKitProApp,
});

function ImageKitProApp() {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [images, setImages] = useState<LoadedImage[]>([]);
  const [folders, setFolders] = useState<string[]>([]);

  // Step 2
  const [groups, setGroups] = useState<SkuGroup[]>([]);
  const [unmatchedIds, setUnmatchedIds] = useState<string[]>([]);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const [skuText, setSkuText] = useState("");

  // Settings
  const [removeBgApiKey, setRemoveBgApiKey] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const step1Done = images.length > 0;
  const step2Done = groups.some((g) => g.han.trim() && g.imageIds.some((id) => !skippedIds.has(id)));

  const jump = (n: 1 | 2 | 3) => {
    if (n === 2 && !step1Done) return;
    if (n === 3 && !step2Done) return;
    setStep(n);
  };

  const mergeImages = (incoming: LoadedImage[]) => {
    setImages((prev) => {
      const seen = new Set(prev.map((p) => p.filename));
      const merged = [...prev];
      for (const img of incoming) {
        if (seen.has(img.filename)) {
          URL.revokeObjectURL(img.url);
          continue;
        }
        seen.add(img.filename);
        merged.push(img);
      }
      merged.sort((a, b) => a.filename.localeCompare(b.filename));
      return merged;
    });
    // Reset downstream state since image set changed
    setGroups([]);
    setUnmatchedIds([]);
    setSkippedIds(new Set());
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((i) => i.id !== id);
    });
    setGroups((prev) => prev.map((g) => ({ ...g, imageIds: g.imageIds.filter((x) => x !== id) })));
    setUnmatchedIds((prev) => prev.filter((x) => x !== id));
    setSkippedIds((prev) => {
      if (!prev.has(id)) return prev;
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  };

  const removeAllImages = () => {
    images.forEach((i) => URL.revokeObjectURL(i.url));
    setImages([]);
    setFolders([]);
    setGroups([]);
    setUnmatchedIds([]);
    setSkippedIds(new Set());
  };

  const replaceImage = (id: string, next: LoadedImage) => {
    setImages((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      if (idx === -1) return prev;
      const old = prev[idx];
      if (old.url !== next.url) URL.revokeObjectURL(old.url);
      const copy = [...prev];
      copy[idx] = next;
      return copy;
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface/30">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground">
              IK
            </div>
            <div>
              <h1 className="font-mono text-sm font-semibold tracking-tight">
                ImageKit Pro
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                e-commerce image processor · runs locally
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground md:block">
              v1.1 · no upload · no tracking
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setSettingsOpen((o) => !o)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm hover:bg-surface-elevated"
                aria-label="Settings"
                title="Settings"
              >
                ⚙️
              </button>
              {settingsOpen && (
                <div className="absolute right-0 top-10 z-20 w-80 rounded-md border border-border bg-surface p-4 shadow-lg">
                  <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    Settings
                  </h3>
                  <label className="mb-1 block font-mono text-[11px]">
                    remove.bg API Key
                  </label>
                  <input
                    type="password"
                    value={removeBgApiKey}
                    onChange={(e) => setRemoveBgApiKey(e.target.value)}
                    placeholder="paste API key"
                    className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary"
                  />
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                    Stored only in memory. Cleared on reload. Get a free key at remove.bg.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <Stepper current={step} step1Done={step1Done} step2Done={step2Done} onJump={jump} />

      <main className="mx-auto max-w-7xl px-6 py-8">
        {step === 1 && (
          <Step1Upload
            images={images}
            folders={folders}
            removeBgApiKey={removeBgApiKey}
            onMerge={mergeImages}
            onRemove={removeImage}
            onRemoveAll={removeAllImages}
            onReplace={replaceImage}
            onContinue={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <Step2Sku
            images={images}
            groups={groups}
            unmatchedIds={unmatchedIds}
            skippedIds={skippedIds}
            skuText={skuText}
            removeBgApiKey={removeBgApiKey}
            onReplace={replaceImage}
            onChange={(s) => {
              setGroups(s.groups);
              setUnmatchedIds(s.unmatchedIds);
              setSkippedIds(s.skippedIds);
              setSkuText(s.skuText);
            }}
            onContinue={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <Step3Process images={images} groups={groups} skippedIds={skippedIds} />
        )}
      </main>

      <footer className="border-t border-border py-6">
        <div className="mx-auto max-w-7xl px-6 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          all processing happens in your browser · no files leave your device
        </div>
      </footer>
    </div>
  );
}
