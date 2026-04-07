import { create } from "zustand";

interface NoteEditorState {
  noteId: string | null;
  title: string;
  content: string | null;
  initialized: boolean;

  initialize: (note: { id: string; title: string; content: string | null }) => void;
  reset: () => void;
  setTitle: (title: string) => void;
  setContent: (content: string) => void;
}

const initialState = {
  noteId: null,
  title: "",
  content: null,
  initialized: false,
};

export const useNoteEditorStore = create<NoteEditorState>()((set, get) => ({
  ...initialState,

  initialize: (note) => {
    if (get().initialized) return;
    set({
      noteId: note.id,
      title: note.title,
      content: note.content ?? "",
      initialized: true,
    });
  },

  reset: () => set(initialState),

  setTitle: (title) => set({ title }),

  setContent: (content) => set({ content }),
}));
