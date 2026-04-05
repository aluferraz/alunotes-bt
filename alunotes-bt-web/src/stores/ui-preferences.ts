import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "dark" | "light";

interface UIPreferencesState {
  /** App-wide theme */
  theme: Theme;
  /** Theme applied only inside the Tiptap editor wrapper */
  editorTheme: Theme;

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setEditorTheme: (theme: Theme) => void;
  toggleEditorTheme: () => void;
}

export const useUIPreferences = create<UIPreferencesState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      editorTheme: "dark",

      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),

      setEditorTheme: (editorTheme) => set({ editorTheme }),
      toggleEditorTheme: () =>
        set((s) => ({
          editorTheme: s.editorTheme === "dark" ? "light" : "dark",
        })),
    }),
    {
      name: "alunotes-ui-preferences", // localStorage key
    }
  )
);
