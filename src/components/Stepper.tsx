import { cn } from "@/lib/utils";

export type StepState = "active" | "done" | "locked" | "available";

interface StepperProps {
  current: 1 | 2 | 3;
  step1Done: boolean;
  step2Done: boolean;
  onJump: (step: 1 | 2 | 3) => void;
}

const STEPS = [
  { n: 1, label: "Upload & Inspect" },
  { n: 2, label: "SKU Assignment" },
  { n: 3, label: "Process & Export" },
] as const;

export function Stepper({ current, step1Done, step2Done, onJump }: StepperProps) {
  const stateOf = (n: number): StepState => {
    if (n === current) return "active";
    if (n < current) return "done";
    if (n === 2 && step1Done) return "available";
    if (n === 3 && step2Done) return "available";
    return "locked";
  };

  return (
    <div className="border-b border-border bg-surface/40">
      <div className="mx-auto flex max-w-7xl items-stretch px-6">
        {STEPS.map((s, i) => {
          const state = stateOf(s.n);
          const clickable = state !== "locked";
          return (
            <button
              key={s.n}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onJump(s.n as 1 | 2 | 3)}
              className={cn(
                "group flex flex-1 items-center gap-3 px-5 py-4 text-left transition-colors",
                "border-b-2",
                state === "active" && "border-primary text-foreground",
                state === "done" && "border-success/60 text-foreground hover:bg-surface",
                state === "available" && "border-transparent text-muted-foreground hover:bg-surface hover:text-foreground",
                state === "locked" && "cursor-not-allowed border-transparent text-muted-foreground/50",
              )}
            >
              <span
                className={cn(
                  "font-mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  state === "active" && "border-primary bg-primary text-primary-foreground",
                  state === "done" && "border-success bg-success/20 text-success",
                  state === "available" && "border-border text-muted-foreground",
                  state === "locked" && "border-border/60 text-muted-foreground/40",
                )}
              >
                {state === "done" ? "✓" : s.n}
              </span>
              <div className="flex flex-col">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Step {s.n} {i < 2 && "/"}
                </span>
                <span className="text-sm font-medium">{s.label}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
