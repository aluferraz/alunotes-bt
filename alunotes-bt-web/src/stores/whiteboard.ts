import { create } from "zustand";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

interface WhiteboardState {
  boardId: string | null;
  name: string;
  elements: ExcalidrawElement[] | null;
  appState: Partial<AppState> | null;
  isFullscreen: boolean;
  initialized: boolean;
  /** Serialized elements snapshot used to diff against incoming onChange */
  lastSavedElements: string;

  initialize: (board: {
    id: string;
    name: string;
    elements: string | null;
    appState: string | null;
  }) => void;
  reset: () => void;
  setName: (name: string) => void;
  setElements: (elements: ExcalidrawElement[]) => void;
  setAppState: (appState: Partial<AppState>) => void;
  toggleFullscreen: () => void;
  /** Returns true if elements changed (should trigger save), false if unchanged */
  hasElementsChanged: (elements: readonly ExcalidrawElement[]) => boolean;
}

const initialState = {
  boardId: null,
  name: "",
  elements: null,
  appState: null,
  isFullscreen: false,
  initialized: false,
  lastSavedElements: "[]",
};

export const useWhiteboardStore = create<WhiteboardState>()((set, get) => ({
  ...initialState,

  initialize: (board) => {
    if (get().initialized) return;
    const elements = board.elements ? JSON.parse(board.elements) : [];
    const appState = board.appState ? JSON.parse(board.appState) : {};
    set({
      boardId: board.id,
      name: board.name,
      elements,
      appState,
      initialized: true,
      lastSavedElements: board.elements ?? "[]",
    });
  },

  reset: () => set(initialState),

  setName: (name) => set({ name }),

  setElements: (elements) => set({ elements }),

  setAppState: (appState) => set({ appState }),

  toggleFullscreen: () => set((s) => ({ isFullscreen: !s.isFullscreen })),

  hasElementsChanged: (elements) => {
    const elStr = JSON.stringify(elements);
    if (elStr === get().lastSavedElements) return false;
    set({ lastSavedElements: elStr, elements: [...elements] as ExcalidrawElement[] });
    return true;
  },
}));