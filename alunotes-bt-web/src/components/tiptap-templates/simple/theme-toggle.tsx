"use client"

import { Button } from "~/components/tiptap-ui-primitive/button"
import { MoonStarIcon } from "~/components/tiptap-icons/moon-star-icon"
import { SunIcon } from "~/components/tiptap-icons/sun-icon"
import { useUIPreferences } from "~/stores/ui-preferences"

/**
 * Toggles ONLY the editor theme (dark/light).
 * The app-wide theme is controlled separately via the Settings page.
 */
export function ThemeToggle() {
  const editorTheme = useUIPreferences((s) => s.editorTheme)
  const toggleEditorTheme = useUIPreferences((s) => s.toggleEditorTheme)
  const isDark = editorTheme === "dark"

  return (
    <Button
      onClick={toggleEditorTheme}
      aria-label={`Switch editor to ${isDark ? "light" : "dark"} mode`}
      variant="ghost"
    >
      {isDark ? (
        <MoonStarIcon className="tiptap-button-icon" />
      ) : (
        <SunIcon className="tiptap-button-icon" />
      )}
    </Button>
  )
}
