"use client";

import { use, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAsyncDebouncer } from "@tanstack/react-pacer";
import { orpc } from "~/orpc/react";
import {
  useSimpleEditor,
  SimpleEditorToolbar,
  SimpleEditorContent,
} from "~/components/tiptap-templates/simple/simple-editor";
import { EditorContext } from "@tiptap/react";
import { GlassCard } from "~/components/ui/glass-card";
import { Save, ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useUIPreferences } from "~/stores/ui-preferences";
import { useNoteEditorStore } from "~/stores/note-editor";
import { FolderPicker } from "~/components/folder-picker";

export default function NotePage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const noteId = params.id;

  const queryClient = useQueryClient();
  const { data: note, isLoading } = useQuery(orpc.notes.get.queryOptions({ input: { id: noteId } }));
  const { mutateAsync: updateNote } = useMutation(orpc.notes.update.mutationOptions());
  const updateNoteRef = useRef(updateNote);
  useEffect(() => { updateNoteRef.current = updateNote; }, [updateNote]);

  const { title, content, initialized } = useNoteEditorStore();
  const initialize = useNoteEditorStore((s) => s.initialize);
  const setTitle = useNoteEditorStore((s) => s.setTitle);
  const setContent = useNoteEditorStore((s) => s.setContent);
  const reset = useNoteEditorStore((s) => s.reset);

  // Sync initial data from server
  useEffect(() => {
    if (note) {
      initialize({ id: noteId, title: note.title, content: note.content ?? "" });
    }
  }, [note, noteId, initialize]);

  // Reset store on unmount so next note starts fresh
  useEffect(() => () => reset(), [reset]);

  // Stable save function — invalidates query cache after success
  const saveFn = useCallback(
    async (newTitle: string, newContent: string) => {
      await updateNoteRef.current({ id: noteId, title: newTitle, content: newContent });
      void queryClient.invalidateQueries({ queryKey: orpc.notes.get.queryOptions({ input: { id: noteId } }).queryKey });
      void queryClient.invalidateQueries({ queryKey: orpc.notes.list.queryKey() });
    },
    [noteId, queryClient]
  );

  const saveDebouncer = useAsyncDebouncer(
    saveFn,
    {
      wait: 1500,
      onUnmount: (d) => d.flush(),
      asyncRetryerOptions: {
        maxAttempts: 3,
        backoff: 'exponential',
        baseWait: 1000,
        maxWait: 10000,
        jitter: 0.3,
      },
    },
  );

  // Keep latest content in ref so saves always use freshest data
  const latestContentRef = useRef<string>("");
  useEffect(() => {
    if (content !== null) latestContentRef.current = content;
  }, [content]);

  // Flush pending saves when the page becomes hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        saveDebouncer.flush();
      }
    };
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveDebouncer.store.state.isPending) {
        e.preventDefault();
        saveDebouncer.flush();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [saveDebouncer]);

  const handleUpdateTitle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newTitle = e.target.value;
      setTitle(newTitle);
      saveDebouncer.maybeExecute(newTitle, latestContentRef.current);
    },
    [setTitle, saveDebouncer]
  );

  const handleUpdateContent = useCallback(
    (newContent: string) => {
      setContent(newContent);
      latestContentRef.current = newContent;
      const currentTitle = useNoteEditorStore.getState().title;
      saveDebouncer.maybeExecute(currentTitle, newContent);
    },
    [setContent, saveDebouncer]
  );

  const editorState = useSimpleEditor({
    initialContent: content ?? undefined,
    onUpdate: handleUpdateContent,
  });

  const editorTheme = useUIPreferences((s) => s.editorTheme);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!note) {
    return <div className="text-center text-muted-foreground mt-20">Note not found.</div>;
  }

  return (
    <EditorContext.Provider value={{ editor: editorState.editor }}>
      <div className="flex flex-col max-w-5xl mx-auto min-h-screen pb-20">

        {/* Sticky header — aligned with top navbar */}
        <div className="flex items-center justify-between sticky top-0 z-20 py-3 px-1 sm:px-0">
          <Link
            href="/notes"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors p-2 -ml-2 rounded-full hover:bg-glass-border"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="hidden sm:inline font-medium text-sm">Notes</span>
          </Link>

          <div className="flex items-center gap-2">
            <FolderPicker
              value={note.folderId}
              onChange={(folderId) => {
                void updateNote({ id: noteId, folderId }).then(() => {
                  void queryClient.invalidateQueries({ queryKey: orpc.notes.get.queryOptions({ input: { id: noteId } }).queryKey });
                  void queryClient.invalidateQueries({ queryKey: orpc.folders.list.queryKey() });
                });
              }}
            />
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-glass-bg border border-glass-border backdrop-blur-md text-xs font-medium text-muted-foreground">
              <saveDebouncer.Subscribe selector={(state) => ({ isSaving: state.isPending || state.isExecuting })}>
                {({ isSaving }) => isSaving ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</>
                ) : (
                  <><Save className="w-3 h-3" /> Saved</>
                )}
              </saveDebouncer.Subscribe>
            </div>
          </div>
        </div>
        {/* Editor card */}
        <GlassCard
          className={`transition-all duration-500 ease-out hover:shadow-glass-lg overflow-hidden editor-theme-${editorTheme}`}
        >
          {/* Internal layout - p-6/p-10 and flex column */}
          <div className="simple-editor-wrapper flex flex-col p-6 sm:p-10 min-h-[70vh]">
            {/* Toolbar at top of card */}
            <div className="pb-5 border-b border-white/10">
              <SimpleEditorToolbar {...editorState} />
            </div>

            {/* Title */}
            <input
              type="text"
              value={title}
              onChange={handleUpdateTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  editorState.editor?.commands.focus("start");
                }
              }}
              placeholder="Note Title"
              className="text-4xl sm:text-5xl font-manrope font-extrabold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/30 px-0 focus:ring-0 w-full pt-8 pb-4"
            />

            {/* Editor body */}
            {content !== null && (
              <div className="simple-editor-content-area flex-1">
                <SimpleEditorContent editor={editorState.editor} />
              </div>
            )}
          </div>
        </GlassCard>
      </div>
    </EditorContext.Provider>
  );
}
