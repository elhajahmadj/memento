import { Sun, Moon, Circle, PanelTop, PanelLeft } from "lucide-react";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { useTheme, type ThemeMode } from "@/shared/hooks/use-theme";
import { useNavLayout, type NavLayout } from "@/shared/hooks/use-nav-layout";

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { layout, setLayout } = useNavLayout();

  const themeOptions: {
    value: ThemeMode;
    label: string;
    description: string;
    icon: typeof Sun;
  }[] = [
    {
      value: "dark",
      label: "Dark",
      description: "Deep navy surfaces with vivid blue accents.",
      icon: Moon,
    },
    {
      value: "light",
      label: "Light",
      description: "Bright paper-feel surfaces with high contrast.",
      icon: Sun,
    },
    {
      value: "grey",
      label: "Grey",
      description: "Neutral mid-grey palette — easier on the eyes.",
      icon: Circle,
    },
  ];

  const layoutOptions: {
    value: NavLayout;
    label: string;
    description: string;
    icon: typeof PanelTop;
  }[] = [
    {
      value: "top",
      label: "Top bar",
      description: "Primary navigation runs across the top of every page.",
      icon: PanelTop,
    },
    {
      value: "side",
      label: "Side nav",
      description: "Primary navigation lives in a left-hand side rail.",
      icon: PanelLeft,
    },
  ];

  return (
    <section data-testid="section-appearance" className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-2">Theme</h3>
        <RadioGroup
          value={theme}
          onValueChange={(v) => {
            if (v === "light" || v === "dark" || v === "grey") setTheme(v);
          }}
          className="grid gap-2 sm:grid-cols-3"
          data-testid="radiogroup-theme"
        >
          {themeOptions.map((opt) => {
            const Icon = opt.icon;
            const id = `theme-${opt.value}`;
            return (
              <Label
                key={opt.value}
                htmlFor={id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-card hover-elevate has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary"
                data-testid={`label-theme-${opt.value}`}
              >
                <RadioGroupItem
                  id={id}
                  value={opt.value}
                  className="mt-1"
                  data-testid={`radio-theme-${opt.value}`}
                />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="h-4 w-4" />
                    {opt.label}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {opt.description}
                  </p>
                </div>
              </Label>
            );
          })}
        </RadioGroup>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Navigation layout</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Choose where the primary navigation lives. Saved to your account so
          it follows you across browsers and devices.
        </p>
        <RadioGroup
          value={layout}
          onValueChange={(v) => {
            if (v === "top" || v === "side") setLayout(v);
          }}
          className="grid gap-2 sm:grid-cols-2"
          data-testid="radiogroup-nav-layout"
        >
          {layoutOptions.map((opt) => {
            const Icon = opt.icon;
            const id = `nav-layout-${opt.value}`;
            return (
              <Label
                key={opt.value}
                htmlFor={id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-card hover-elevate has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary"
                data-testid={`label-nav-layout-${opt.value}`}
              >
                <RadioGroupItem
                  id={id}
                  value={opt.value}
                  className="mt-1"
                  data-testid={`radio-nav-layout-${opt.value}`}
                />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="h-4 w-4" />
                    {opt.label}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {opt.description}
                  </p>
                </div>
              </Label>
            );
          })}
        </RadioGroup>
      </div>
    </section>
  );
}
