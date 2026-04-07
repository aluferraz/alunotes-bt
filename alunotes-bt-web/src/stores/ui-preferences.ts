import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "dark" | "light";

interface UIPreferencesState {
  /** App-wide theme */
  theme: Theme;
  /** Theme applied only inside the Tiptap editor wrapper */
  editorTheme: Theme;
  /** Theme applied only inside the Excalidraw whiteboard */
  whiteboardTheme: Theme;

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setEditorTheme: (theme: Theme) => void;
  toggleEditorTheme: () => void;
  setWhiteboardTheme: (theme: Theme) => void;
  toggleWhiteboardTheme: () => void;
}

export const useUIPreferences = create<UIPreferencesState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      editorTheme: "dark",
      whiteboardTheme: "dark",

      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),

      setEditorTheme: (editorTheme) => set({ editorTheme }),
      toggleEditorTheme: () =>
        set((s) => ({
          editorTheme: s.editorTheme === "dark" ? "light" : "dark",
        })),

      setWhiteboardTheme: (whiteboardTheme) => set({ whiteboardTheme }),
      toggleWhiteboardTheme: () =>
        set((s) => ({
          whiteboardTheme: s.whiteboardTheme === "dark" ? "light" : "dark",
        })),
    }),
    {
      name: "alunotes-ui-preferences", // localStorage key
    }
  )
);
