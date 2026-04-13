"use client";

import { use, useEffect, useCallback, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAsyncDebouncer } from "@tanstack/react-pacer";
import { useCompletion } from "@ai-sdk/react";
import { orpc } from "~/orpc/react";
import {
  useSimpleEditor,
  SimpleEditorToolbar,
  SimpleEditorContent,
} from "~/components/tiptap-templates/simple/simple-editor";
import { EditorContext } from "@tiptap/react";
import { GlassCard } from "~/components/ui/glass-card";
import { Save, ArrowLeft, Loader2, Wand2, MoreVertical } from "lucide-react";
import Link from "next/link";
import { useUIPreferences } from "~/stores/ui-preferences";
import { useNoteEditorStore } from "~/stores/note-editor";
import { FolderPicker } from "~/components/folder-picker";

type GenerationPhase = "idle" | "transcribing" | "generating" | "done" | "error";
type ProgressStage = string | null;

export default function AudioNotePage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const noteId = params.id;
  const [showOverwriteMenu, setShowOverwriteMenu] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [generationPhase, setGenerationPhase] = useState<GenerationPhase>("idle");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<ProgressStage>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const queryClient = useQueryClient();
  const { data: note, isLoading } = useQuery(orpc.notes.get.queryOptions({ input: { id: noteId } }));
  const { mutateAsync: updateNote } = useMutation(orpc.notes.update.mutationOptions());
  const updateNoteRef = useRef(updateNote);
  useEffect(() => { updateNoteRef.current = updateNote; }, [updateNote]);

  const { mutateAsync: setAlunoteGenerated } = useMutation(orpc.notes.setAlunoteGenerated.mutationOptions());

  // Fetch recording details for the audio player
  const { data: recording } = useQuery({
    ...orpc.recordings.get.queryOptions({ input: { sessionId: note?.recordingSessionId ?? "" } }),
    enabled: !!note?.recordingSessionId,
  });

  const { title, content, initialized } = useNoteEditorStore();
  const initialize = useNoteEditorStore((s) => s.initialize);
  const setTitle = useNoteEditorStore((s) => s.setTitle);
  const setContent = useNoteEditorStore((s) => s.setContent);
  const reset = useNoteEditorStore((s) => s.reset);

  // Sync initial data from server, stripping any audio nodes from content
  useEffect(() => {
    if (note) {
      let cleanContent = note.content ?? "";
      if (cleanContent) {
        try {
          const parsed = JSON.parse(cleanContent) as { content?: Array<{ type?: string }> };
          if (parsed.content) {
            parsed.content = parsed.content.filter((n) => n.type !== "audio");
            cleanContent = JSON.stringify(parsed);
          }
        } catch { /* keep as-is */ }
      }
      initialize({ id: noteId, title: note.title, content: cleanContent });
    }
  }, [note, noteId, initialize]);

  // Reset store on unmount so next note starts fresh
  useEffect(() => () => reset(), [reset]);

  // Close menu on outside click
  useEffect(() => {
    if (!showOverwriteMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowOverwriteMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showOverwriteMenu]);

  // Stable save function
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

  // LLM streaming via Vercel AI SDK
  const { complete, isLoading: isGenerating } = useCompletion({
    api: "/api/ai/generate-note",
    onFinish: async (_prompt: string, completion: string) => {
      // Insert the generated markdown as paragraphs into the editor
      if (editorState.editor && completion) {
        // Set content as markdown-like plain text (the editor will parse it)
        editorState.editor
          .chain()
          .focus("end")
          .insertContent(
            completion.split("\n").map((line) => {
              if (!line.trim()) return { type: "paragraph" };
              return { type: "paragraph", content: [{ type: "text", text: line }] };
            })
          )
          .run();

        // Save and mark as generated
        const newContent = JSON.stringify(editorState.editor.getJSON());
        handleUpdateContent(newContent);
        await setAlunoteGenerated({ id: noteId, generated: true });
        void queryClient.invalidateQueries({ queryKey: orpc.notes.get.queryOptions({ input: { id: noteId } }).queryKey });
        setGenerationPhase("done");
        setProgressMessage(null);
      }
    },
    onError: (err: Error) => {
      setGenerationError(err.message);
      setGenerationPhase("error");
      setProgressMessage(null);
    },
  });

  /** Run the full AI pipeline: diarize (SSE) → insert transcript → generate notes */
  const handleGenerateAlunote = useCallback(async () => {
    if (generationPhase !== "idle" && generationPhase !== "done" && generationPhase !== "error") return;

    setGenerationPhase("transcribing");
    setGenerationError(null);
    setProgressMessage("Starting...");

    try {
      // Step 1: Diarize via SSE stream
      const res = await fetch("/api/ai/diarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(err.error ?? `Diarization failed (${res.status})`);
      }

      // Parse SSE events
      const segments: Array<{ speaker: string; start: number; end: number; text: string }> = [];
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let sseError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;

          try {
            const event = JSON.parse(raw) as {
              type: string;
              stage?: string;
              message?: string;
              speaker?: string;
              start?: number;
              end?: number;
              text?: string;
              total_segments?: number;
            };

            if (event.type === "progress") {
              setProgressMessage(event.message ?? event.stage ?? "Processing...");
            } else if (event.type === "segment") {
              segments.push({
                speaker: event.speaker ?? "UNKNOWN",
                start: event.start ?? 0,
                end: event.end ?? 0,
                text: event.text ?? "",
              });
              setProgressMessage(`${segments.length} segment(s) found...`);
            } else if (event.type === "error") {
              sseError = event.message ?? "Unknown error";
            }
          } catch { /* skip malformed */ }
        }
      }

      if (sseError) throw new Error(sseError);

      // Build transcript text
      const transcript = segments.length === 0
        ? "(No speech detected)"
        : segments
            .map((s) => {
              const start = `${Math.floor(s.start / 60).toString().padStart(2, "0")}:${Math.floor(s.start % 60).toString().padStart(2, "0")}`;
              const end = `${Math.floor(s.end / 60).toString().padStart(2, "0")}:${Math.floor(s.end % 60).toString().padStart(2, "0")}`;
              return `[${start} - ${end}] ${s.speaker}: ${s.text}`;
            })
            .join("\n");

      setProgressMessage("Inserting transcript...");

      // Step 2: Insert transcript into a Details (collapsible) block in the editor
      if (editorState.editor) {
        const transcriptLines = transcript.split("\n").map((line) => {
          if (!line.trim()) return { type: "paragraph" };
          return { type: "paragraph", content: [{ type: "text", text: line }] };
        });

        editorState.editor.commands.setContent({
          type: "doc",
          content: [
            {
              type: "details",
              attrs: { class: "details-node" },
              content: [
                {
                  type: "detailsSummary",
                  content: [{ type: "text", text: "Transcript" }],
                },
                {
                  type: "detailsContent",
                  content: transcriptLines,
                },
              ],
            },
            { type: "horizontalRule" },
            { type: "paragraph" },
          ],
        });
      }

      // Step 3: Stream LLM note generation
      setGenerationPhase("generating");
      setProgressMessage("Generating notes...");
      await complete(transcript);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : "Generation failed");
      setGenerationPhase("error");
      setProgressMessage(null);
    }
  }, [generationPhase, noteId, editorState.editor, complete]);

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

  const isProcessing = generationPhase === "transcribing" || generationPhase === "generating";

  return (
    <EditorContext.Provider value={{ editor: editorState.editor }}>
      <div className="flex flex-col max-w-5xl mx-auto min-h-screen pb-20">

        {/* Sticky header */}
        <div className="flex items-center justify-between sticky top-0 z-20 py-3 px-1 sm:px-0">
          <Link
            href="/audio"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors p-2 -ml-2 rounded-full hover:bg-glass-border"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="hidden sm:inline font-medium text-sm">Audio</span>
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

        {/* Toolbar */}
        <div className="sticky top-[3.5rem] sm:top-[3.75rem] z-[45] py-2">
          <SimpleEditorToolbar {...editorState} />
        </div>

        {/* Editor card */}
        <GlassCard
          className={`transition-all duration-500 ease-out hover:shadow-glass-lg overflow-hidden editor-theme-${editorTheme}`}
        >
          <div className="simple-editor-wrapper flex flex-col p-6 sm:p-10 min-h-[70vh]">
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

            {/* Audio player + action */}
            {recording?.streamUrl && (
              <div className="flex flex-col items-center gap-3 py-4">
                <audio
                  controls
                  preload="metadata"
                  src={recording.streamUrl}
                  className="w-full max-w-md"
                />

                {note.alunoteGenerated ? (
                  /* Three-dot menu */
                  <div className="relative" ref={menuRef}>
                    <button
                      onClick={() => setShowOverwriteMenu(!showOverwriteMenu)}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-glass-border/50 transition-colors"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {showOverwriteMenu && (
                      <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 z-50 min-w-[280px] rounded-xl bg-glass-bg border border-glass-border backdrop-blur-xl shadow-glass-lg p-1">
                        <button
                          onClick={() => {
                            setShowOverwriteMenu(false);
                            setShowConfirmDialog(true);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground hover:bg-glass-border/50 transition-colors"
                        >
                          <Wand2 className="w-4 h-4 text-primary" />
                          Generate new note and overwrite content
                        </button>
                      </div>
                    )}
                  </div>
                ) : isProcessing ? (
                  /* Processing indicator with live status */
                  <div className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-glass-bg border border-glass-border text-sm font-medium text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span>
                      {progressMessage ?? (generationPhase === "transcribing"
                        ? "Transcribing audio..."
                        : "Generating notes...")}
                    </span>
                  </div>
                ) : (
                  /* Create Alunote button */
                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={handleGenerateAlunote}
                      className="group relative inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-primary-foreground font-semibold text-sm shadow-glass hover:shadow-[0_0_24px_rgba(var(--primary-rgb),0.3)] transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] overflow-hidden"
                    >
                      <div className="absolute inset-0 overflow-hidden pointer-events-none">
                        <div className="sparkle sparkle-1" />
                        <div className="sparkle sparkle-2" />
                        <div className="sparkle sparkle-3" />
                        <div className="sparkle sparkle-4" />
                        <div className="sparkle sparkle-5" />
                        <div className="sparkle sparkle-6" />
                      </div>

                      <Wand2 className="w-4 h-4 relative z-10 group-hover:rotate-12 transition-transform duration-300" />
                      <span className="relative z-10">Create Alunote for Recording</span>
                    </button>
                    {generationPhase === "error" && generationError && (
                      <p className="text-xs text-destructive">{generationError}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Editor body */}
            {content !== null && (
              <div className="simple-editor-content-area flex-1">
                <SimpleEditorContent editor={editorState.editor} />
              </div>
            )}
          </div>
        </GlassCard>
      </div>

      {/* Confirm overwrite dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowConfirmDialog(false)} />
          <div className="relative bg-glass-bg border border-glass-border backdrop-blur-xl rounded-2xl shadow-glass-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-foreground mb-2">Overwrite note content?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              This will regenerate the note from the recording and replace all existing content. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-glass-border/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowConfirmDialog(false);
                  void handleGenerateAlunote();
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Overwrite
              </button>
            </div>
          </div>
        </div>
      )}
    </EditorContext.Provider>
  );
}
