"use client";

import { use, useEffect, useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { debounce } from "lodash";

export default function NotePage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const noteId = params.id;

  const { data: note, isLoading } = useQuery(orpc.notes.get.queryOptions({ input: { id: noteId } }));
  const { mutate: updateNote, isPending: isSaving } = useMutation(orpc.notes.update.mutationOptions());

  const [title, setTitle] = useState("");
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    if (note && title === "" && content === null) {
      setTitle(note.title);
      setContent(note.content ?? "");
    }
  }, [note, title, content]);

  const debouncedSave = useMemo(
    () =>
      debounce((newTitle: string, newContent: string) => {
        updateNote({ id: noteId, title: newTitle, content: newContent });
      }, 1000),
    [noteId, updateNote]
  );

  const handleUpdateContent = useCallback(
    (newContent: string) => {
      setContent(newContent);
      debouncedSave(title, newContent);
    },
    [debouncedSave, title]
  );

  const handleUpdateTitle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    debouncedSave(newTitle, content ?? "");
  };

  const editorState = useSimpleEditor({
    initialContent: content ?? undefined,
    onUpdate: handleUpdateContent,
  });

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
      <div className="flex flex-col gap-6 max-w-4xl mx-auto min-h-screen">

        {/* Minimal sticky header — back button + save status only */}
        <div className="flex items-center justify-between sticky top-0 z-20 py-3 -mx-4 px-4 sm:mx-0 sm:px-0 bg-background/60 backdrop-blur-xl border-b border-glass-border">
          <Link
            href="/notes"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors p-2 -ml-2 rounded-full hover:bg-glass-border"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="hidden sm:inline font-medium text-sm">Notes</span>
          </Link>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-glass-bg border border-glass-border backdrop-blur-md text-xs font-medium text-muted-foreground">
            {isSaving ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</>
            ) : (
              <><Save className="w-3 h-3" /> Saved</>
            )}
          </div>
        </div>

        {/* Editor card: toolbar → title → content */}
        <GlassCard className="p-6 sm:p-10 min-h-[70vh] flex flex-col gap-0 transition-all duration-500 ease-out hover:shadow-glass-lg overflow-hidden">
          {/* Toolbar at top of card, spanning full width */}
          <div className="pb-5 border-b border-glass-border">
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
            <div className="simple-editor-wrapper flex-1">
              <SimpleEditorContent editor={editorState.editor} />
            </div>
          )}
        </GlassCard>
      </div>
    </EditorContext.Provider>
  );
}
