"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { useEffect, useState } from "react";
import { Bold, Italic, List, ListOrdered, CheckSquare } from "lucide-react";

interface EditorProps {
  initialContent?: string;
  onUpdate?: (content: string) => void;
}

export function TiptapEditor({ initialContent, onUpdate }: EditorProps) {
  const [mounted, setMounted] = useState(false);
  
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Start typing your notes here...",
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
    ],
    immediatelyRender: false,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    content: initialContent ? JSON.parse(initialContent) : "",
    onUpdate: ({ editor }) => {
      onUpdate?.(JSON.stringify(editor.getJSON()));
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm sm:prose-base dark:prose-invert focus:outline-none max-w-none prose-headings:font-manrope prose-p:font-sans",
      },
    },
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !editor) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Formatting Toolbar */}
      <div className="flex flex-wrap items-center gap-1 p-2 bg-glass-bg border border-glass-border rounded-2xl shadow-glass-sm max-w-max backdrop-blur-md sticky top-6 z-10 transition-colors">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          icon={<Bold className="w-4 h-4" />}
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          icon={<Italic className="w-4 h-4" />}
        />
        <div className="w-px h-4 bg-border mx-1" />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          icon={<List className="w-4 h-4" />}
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          icon={<ListOrdered className="w-4 h-4" />}
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          active={editor.isActive("taskList")}
          icon={<CheckSquare className="w-4 h-4" />}
        />
      </div>

      <div className="min-h-[500px]">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function ToolbarButton({ onClick, active, icon }: { onClick: () => void; active: boolean; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-2 rounded-xl transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-glass-border hover:text-foreground"
      }`}
    >
      {icon}
    </button>
  );
}
