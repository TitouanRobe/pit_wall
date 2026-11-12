import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from "@mantine/core";
import type { PartialTheme } from "@nivo/theming";
import type { TierKey } from "./api";

export type Mode = "dark" | "light";

const dark = {
  ink950: "#070b14",
  ink900: "#0b1120",
  ink850: "#0e1526",
  ink800: "#131c33",
  ink700: "#1a2644",
  line: "#1b2641",
  lineStrong: "#2b3b5e",
  bone: "#eceef3",
  boneDim: "#a9b2c3",
  mute: "#7a859b",
  signal: "#f2c230",
  ref: "#3f90dd",
  cmp: "#cf7a12",
  gain: "#1fa284",
  loss: "#e5534b",
  best: "#a66cf0",
};

export type Palette = typeof dark;

const light: Palette = {
  ink950: "#f3f1ea",
  ink900: "#fcfbf8",
  ink850: "#f7f5ef",
  ink800: "#ebe8df",
  ink700: "#e0dccf",
  line: "#dedacd",
  lineStrong: "#c4bfae",
  bone: "#161a23",
  boneDim: "#4b5364",
  mute: "#6b7385",
  signal: "#9c7200",
  ref: "#2563b0",
  cmp: "#b45f06",
  gain: "#12806a",
  loss: "#c7362e",
  best: "#7b3fd1",
};

export const palettes: Record<Mode, Palette> = { dark, light };

export const heat: Record<Mode, { stops: string[]; labelOnHot: string }> = {
  dark: { stops: ["#131c33", "#3b3a2e", "#6b5d27", "#a8862a", "#f2c230"], labelOnHot: dark.ink950 },
  light: { stops: ["#ebe8df", "#e8dcb0", "#e2c76d", "#d6a820", "#b88700"], labelOnHot: light.bone },
};

export const tierColors: Record<Mode, Record<TierKey, string>> = {
  dark: {
    alien: dark.best,
    competitive: dark.gain,
    good: "#86b545",
    midpack: dark.signal,
    tail: dark.cmp,
    offline: dark.loss,
    outside: dark.mute,
  },
  light: {
    alien: light.best,
    competitive: light.gain,
    good: "#5b8a22",
    midpack: light.signal,
    tail: light.cmp,
    offline: light.loss,
    outside: light.mute,
  },
};

const cssName = (key: string) => `--color-${key.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase()}`;

export function applyMode(mode: Mode) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  for (const [key, value] of Object.entries(palettes[mode])) root.style.setProperty(cssName(key), value);
}

const signal: MantineColorsTuple = [
  "#fff9e1", "#fdf0cc", "#f9e09b", "#f6cf65", "#f2c230", "#f0b81c", "#efb20b", "#d49c00", "#bc8a00", "#a37600",
];

const ink: MantineColorsTuple = [
  "#eceef3", "#a9b2c3", "#7a859b", "#4a5878", "#2b3b5e", "#1b2641", "#131c33", "#0e1526", "#0b1120", "#070b14",
];

const v = (token: string) => `var(--color-${token})`;

export const mantineTheme = createTheme({
  primaryColor: "signal",
  primaryShade: 4,
  colors: { signal, dark: ink },
  black: dark.ink950,
  white: dark.bone,
  fontFamily: '"Barlow", system-ui, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", ui-monospace, monospace',
  headings: { fontFamily: '"Barlow Condensed", "Barlow", sans-serif', fontWeight: "600" },
  defaultRadius: "sm",
  radius: { xs: "3px", sm: "6px", md: "8px", lg: "10px", xl: "14px" },
  cursorType: "pointer",
  autoContrast: true,
  components: {
    Select: {
      defaultProps: { radius: "sm", comboboxProps: { transitionProps: { duration: 120, transition: "pop" } } },
      styles: {
        input: { background: v("ink-850"), borderColor: v("line"), color: v("bone"), fontFamily: '"Barlow", sans-serif' },
        dropdown: { background: v("ink-850"), borderColor: v("line-strong") },
        option: { fontSize: 14, color: v("bone") },
      },
    },
    Tooltip: {
      defaultProps: { withArrow: true, arrowSize: 6, openDelay: 150 },
      styles: { tooltip: { background: v("ink-800"), border: `1px solid ${v("line-strong")}`, color: v("bone"), fontSize: 13 } },
    },
    Modal: {
      styles: {
        content: { background: v("ink-900"), border: `1px solid ${v("line")}`, color: v("bone") },
        header: { background: v("ink-900") },
        title: { fontFamily: '"Barlow Condensed", sans-serif', fontSize: 20, fontWeight: 600, letterSpacing: "0.02em" },
      },
    },
    Menu: {
      styles: {
        dropdown: { background: v("ink-850"), borderColor: v("line-strong") },
        item: { color: v("bone"), fontSize: 14 },
      },
    },
    TextInput: {
      defaultProps: { radius: "sm" },
      styles: {
        input: { background: v("ink-850"), borderColor: v("line"), color: v("bone"), fontFamily: '"Barlow", sans-serif' },
      },
    },
    Checkbox: {
      defaultProps: { radius: "xs", size: "xs" },
    },
  },
});

const mantineSurfaceVariables = {
  "--mantine-color-body": v("ink-950"),
  "--mantine-color-text": v("bone"),
  "--mantine-color-dimmed": v("mute"),
  "--mantine-color-default": v("ink-850"),
  "--mantine-color-default-hover": v("ink-800"),
  "--mantine-color-default-border": v("line-strong"),
  "--mantine-color-default-color": v("bone"),
  "--mantine-color-placeholder": v("mute"),
};

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: mantineSurfaceVariables,
  dark: mantineSurfaceVariables,
});

export function nivoThemeFor(p: Palette): PartialTheme {
  return {
    background: "transparent",
    text: { fontFamily: '"JetBrains Mono", monospace', fontSize: 10, fill: p.mute },
    axis: {
      domain: { line: { stroke: p.line, strokeWidth: 1 } },
      ticks: { line: { stroke: p.line, strokeWidth: 1 }, text: { fill: p.mute, fontSize: 10 } },
      legend: { text: { fill: p.boneDim, fontSize: 11 } },
    },
    grid: { line: { stroke: p.line, strokeWidth: 1 } },
    crosshair: { line: { stroke: p.boneDim, strokeWidth: 1, strokeOpacity: 0.6 } },
    tooltip: { container: { background: p.ink850, color: p.bone, fontSize: 12, borderRadius: 6 } },
  };
}
