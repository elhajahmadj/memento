import { Plus, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

export interface FieldDef<T> {
  key: keyof T;
  placeholder: string;
  options?: readonly string[];
}

export function ParametersEditor<T extends { [k: string]: string }>({
  rows,
  setRows,
  label,
  testid,
  fields,
  maxRows,
}: {
  rows: T[];
  setRows: (rows: T[]) => void;
  label: string;
  testid: string;
  fields: FieldDef<T>[];
  maxRows?: number;
}) {
  const atCap = typeof maxRows === "number" && rows.length >= maxRows;
  function addRow() {
    if (atCap) return;
    const empty = {} as T;
    for (const f of fields) {
      (empty as Record<string, string>)[f.key as string] =
        f.options && f.options.length > 0 ? f.options[0] : "";
    }
    setRows([...rows, empty]);
  }
  function updateRow(idx: number, key: keyof T, value: string) {
    const next = rows.slice();
    next[idx] = { ...next[idx], [key]: value };
    setRows(next);
  }
  function removeRow(idx: number) {
    setRows(rows.filter((_, i) => i !== idx));
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>
          {label}
          {typeof maxRows === "number" && (
            <span
              className="ml-2 text-xs text-muted-foreground"
              data-testid={`text-${testid}-count`}
            >
              {rows.length}/{maxRows}
            </span>
          )}
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={atCap}
          data-testid={`button-add-${testid}`}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add
        </Button>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2 items-center">
          {fields.map((f) =>
            f.options ? (
              <Select
                key={String(f.key)}
                value={row[f.key] ?? f.options[0]}
                onValueChange={(v) => updateRow(i, f.key, v)}
              >
                <SelectTrigger
                  data-testid={`select-${testid}-${String(f.key)}-${i}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {f.options.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                key={String(f.key)}
                value={row[f.key] ?? ""}
                onChange={(e) => updateRow(i, f.key, e.target.value)}
                placeholder={f.placeholder}
                data-testid={`input-${testid}-${String(f.key)}-${i}`}
              />
            ),
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => removeRow(i)}
            data-testid={`button-remove-${testid}-${i}`}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
