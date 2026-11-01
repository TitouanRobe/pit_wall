import { MantineProvider } from "@mantine/core";
import { createContext, type ReactNode, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import { applyMode, cssVariablesResolver, heat, type Mode, mantineTheme, nivoThemeFor, type Palette, palettes } from "../theme";

const STORAGE_KEY = "pitwall-theme";

type ModeState = { mode: Mode; toggle: () => void };

const ModeContext = createContext<ModeState>({ mode: "dark", toggle: () => {} });

function storedMode(): Mode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function ThemeRoot({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(storedMode);

  useLayoutEffect(() => {
    applyMode(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* storage can be blocked, the choice then lasts for the visit only */
    }
  }, [mode]);

  const toggle = useCallback(() => setMode((m) => (m === "dark" ? "light" : "dark")), []);
  const value = useMemo(() => ({ mode, toggle }), [mode, toggle]);

  return (
    <ModeContext value={value}>
      <MantineProvider theme={mantineTheme} cssVariablesResolver={cssVariablesResolver} forceColorScheme={mode}>
        {children}
      </MantineProvider>
    </ModeContext>
  );
}

export const useMode = () => useContext(ModeContext);

export function usePalette(): Palette {
  return palettes[useMode().mode];
}

export function useNivoTheme() {
  const palette = usePalette();
  return useMemo(() => nivoThemeFor(palette), [palette]);
}

export function useHeat() {
  return heat[useMode().mode];
}
