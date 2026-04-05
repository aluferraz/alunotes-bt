"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useUIPreferences } from "~/stores/ui-preferences";

/**
 * Mounted once inside the root layout.
 * Keeps next-themes in sync with the Zustand UI preferences store.
 * This ensures localStorage → next-themes on initial mount and on every store change.
 */
export function ThemeApplier() {
  const { setTheme } = useTheme();
  const theme = useUIPreferences((s) => s.theme);

  useEffect(() => {
    setTheme(theme);
  }, [theme, setTheme]);

  return null;
}
