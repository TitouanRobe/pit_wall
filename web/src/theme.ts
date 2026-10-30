import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from "@mantine/core";
import type { PartialTheme } from "@nivo/theming";

export const palette = {
  ink950: "#070b14",
  ink900: "#0b1120",
  ink850: "#0e1526",
  ink800: "#131c33",
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

const signal: MantineColorsTuple = [
  "#fff9e1", "#fdf0cc", "#f9e09b", "#f6cf65", "#f2c230", "#f0b81c", "#efb20b", "#d49c00", "#bc8a00", "#a37600",
];

const ink: MantineColorsTuple = [
  "#eceef3", "#a9b2c3", "#7a859b", "#4a5878", "#2b3b5e", "#1b2641", "#131c33", "#0e1526", "#0b1120", "#070b14",
];

export const mantineTheme = createTheme({
  primaryColor: "signal",
  primaryShade: 4,
  colors: { signal, dark: ink },
  black: palette.ink950,
  white: palette.bone,
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
        input: { background: palette.ink850, borderColor: palette.line, fontFamily: '"Barlow", sans-serif' },
        dropdown: { background: palette.ink850, borderColor: palette.lineStrong },
        option: { fontSize: 14 },
      },
    },
    Tooltip: {
      defaultProps: { color: "dark.6", withArrow: true, arrowSize: 6, openDelay: 150 },
      styles: { tooltip: { border: `1px solid ${palette.lineStrong}`, color: palette.bone, fontSize: 13 } },
    },
    Modal: {
      styles: {
        content: { background: palette.ink900, border: `1px solid ${palette.line}` },
        header: { background: palette.ink900 },
        title: { fontFamily: '"Barlow Condensed", sans-serif', fontSize: 20, fontWeight: 600, letterSpacing: "0.02em" },
      },
    },
    Menu: {
      styles: { dropdown: { background: palette.ink850, borderColor: palette.lineStrong } },
    },
    Checkbox: {
      defaultProps: { radius: "xs", size: "xs" },
    },
  },
});

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {},
  dark: {
    "--mantine-color-body": palette.ink950,
    "--mantine-color-text": palette.bone,
    "--mantine-color-dimmed": palette.mute,
    "--mantine-color-default": palette.ink850,
    "--mantine-color-default-hover": palette.ink800,
    "--mantine-color-default-border": palette.lineStrong,
    "--mantine-color-placeholder": palette.mute,
  },
});

export const nivoTheme: PartialTheme = {
  background: "transparent",
  text: { fontFamily: '"JetBrains Mono", monospace', fontSize: 10, fill: palette.mute },
  axis: {
    domain: { line: { stroke: palette.line, strokeWidth: 1 } },
    ticks: { line: { stroke: palette.line, strokeWidth: 1 }, text: { fill: palette.mute, fontSize: 10 } },
    legend: { text: { fill: palette.boneDim, fontSize: 11 } },
  },
  grid: { line: { stroke: palette.line, strokeWidth: 1 } },
  crosshair: { line: { stroke: palette.boneDim, strokeWidth: 1, strokeOpacity: 0.6 } },
  tooltip: { container: { background: palette.ink850, color: palette.bone, fontSize: 12, borderRadius: 6 } },
};
