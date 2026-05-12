import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";

interface Props {
  onPick: (skus: string[]) => void;
}

interface Parsed {
  filename: string;
  headers: string[];
  rows: string[][]; // first 5 rows for preview
  allRows: string[][]; // all data rows (for column extraction)
}

export function SkuFileImport({ onPick }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [selectedCol, setSelectedCol] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setParsed(null);
    setSelectedCol(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        blankrows: false,
        defval: "",
      });
      if (data.length === 0) {
        setError("File is empty");
        return;
      }
      const headers = (data[0] as unknown[]).map((h, i) =>
        String(h ?? "").trim() || `Column ${i + 1}`,
      );
      const allRows = data.slice(1).map((r) => {
        const arr = r as unknown[];
        return headers.map((_, i) => String(arr[i] ?? "").trim());
      });
      setParsed({
        filename: file.name,
        headers,
        rows: allRows.slice(0, 5),
        allRows,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse file");
    }
  };

  const useColumn = (idx: number) => {
    setSelectedCol(idx);
    if (!parsed) return;
    const skus = Array.from(
      new Set(parsed.allRows.map((r) => r[idx]).filter((v) => v.trim().length > 0)),
    );
    onPick(skus);
  };

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Import SKUs from Excel / CSV
        </h3>
        {parsed && (
          <button
            type="button"
            onClick={() => {
              setParsed(null);
              setSelectedCol(null);
            }}
            className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
          >
            ✕ clear
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm font-medium hover:bg-secondary"
      >
        📂 Choose .xlsx / .csv
      </button>

      {error && (
        <div className="mt-2 rounded border border-destructive/30 bg-destructive/10 px-2 py-1 font-mono text-[11px] text-destructive">
          {error}
        </div>
      )}

      {parsed && (
        <div className="mt-3 space-y-2">
          <div className="font-mono text-[10px] text-muted-foreground">
            {parsed.filename} · {parsed.allRows.length} rows · click a column header to use as SKU
          </div>
          <div className="scrollbar-thin overflow-x-auto rounded border border-border">
            <table className="w-full text-left">
              <thead className="bg-surface-elevated">
                <tr>
                  {parsed.headers.map((h, i) => (
                    <th
                      key={i}
                      onClick={() => useColumn(i)}
                      className={cn(
                        "cursor-pointer whitespace-nowrap px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider",
                        selectedCol === i
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                      title="Use this column as SKU list"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-[11px]">
                {parsed.rows.map((r, ri) => (
                  <tr key={ri}>
                    {parsed.headers.map((_, ci) => (
                      <td
                        key={ci}
                        className={cn(
                          "max-w-[200px] truncate px-3 py-1",
                          selectedCol === ci && "bg-primary/10",
                        )}
                        title={r[ci]}
                      >
                        {r[ci]}
                      </td>
                    ))}
                  </tr>
                ))}
                {parsed.rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={parsed.headers.length}
                      className="px-3 py-2 text-center text-muted-foreground"
                    >
                      No data rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            Showing first {parsed.rows.length} of {parsed.allRows.length} rows
            {selectedCol !== null && (
              <span className="ml-1 text-success">
                · ✅ using "{parsed.headers[selectedCol]}"
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
