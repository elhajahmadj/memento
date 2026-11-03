import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { VIEWPORT_PRESETS } from "./constants";
import type { ViewportPreset } from "./types";

export function BrowserSizeSection({
  viewportPreset,
  setViewportPreset,
  viewportW,
  setViewportW,
  viewportH,
  setViewportH,
  viewportInRange,
}: {
  viewportPreset: ViewportPreset;
  setViewportPreset: (v: ViewportPreset) => void;
  viewportW: number;
  setViewportW: (v: number) => void;
  viewportH: number;
  setViewportH: (v: number) => void;
  viewportInRange: boolean;
}) {
  return (
    <div
      className="space-y-2 rounded-md border p-3"
      data-testid="section-browser-size"
    >
      <Label htmlFor="viewport-preset" className="text-sm font-medium">
        Browser size
      </Label>
      <Select
        value={viewportPreset}
        onValueChange={(v) => {
          const p = v as ViewportPreset;
          setViewportPreset(p);
          if (p !== "custom") {
            setViewportW(VIEWPORT_PRESETS[p].width);
            setViewportH(VIEWPORT_PRESETS[p].height);
          }
        }}
      >
        <SelectTrigger
          id="viewport-preset"
          data-testid="select-viewport-preset"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(
            Object.keys(VIEWPORT_PRESETS) as Array<
              keyof typeof VIEWPORT_PRESETS
            >
          ).map((k) => (
            <SelectItem key={k} value={k}>
              {VIEWPORT_PRESETS[k].label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom…</SelectItem>
        </SelectContent>
      </Select>
      {viewportPreset === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={320}
            max={3840}
            value={viewportW}
            onChange={(e) =>
              setViewportW(Number.parseInt(e.target.value, 10) || 0)
            }
            placeholder="Width"
            data-testid="input-viewport-width"
          />
          <span className="text-muted-foreground text-xs">×</span>
          <Input
            type="number"
            min={240}
            max={2160}
            value={viewportH}
            onChange={(e) =>
              setViewportH(Number.parseInt(e.target.value, 10) || 0)
            }
            placeholder="Height"
            data-testid="input-viewport-height"
          />
        </div>
      )}
      {!viewportInRange && (
        <p className="text-xs text-destructive">
          Width must be 320–3840 and height must be 240–2160.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Sets the recording browser viewport. Larger sizes give you more
        room to interact with the live preview.
      </p>
    </div>
  );
}
