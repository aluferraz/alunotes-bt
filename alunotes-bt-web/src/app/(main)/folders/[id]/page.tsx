"use client";

import { use } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { GlassCard } from "~/components/ui/glass-card";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Edit3,
  CheckSquare,
  PenTool,
  FolderOpen,
  Loader2,
  Trash2,
} from "lucide-react";

export default function FolderDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = use(props.params);
  const folderId = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: folder, isLoading } = useQuery(
    orpc.folders.get.queryOptions({ input: { id: folderId } })
  );

  const { mutate: deleteFolder } = useMutation(
    orpc.folders.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.folders.list.queryKey() });
        router.push("/folders");
      },
    })
  );

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!folder) {
    return (
      <div className="text-center text-muted-foreground mt-20">
        Folder not found.
      </div>
    );
  }

  const totalItems =
    folder.notes.length + folder.tasks.length + folder.whiteboards.length;

  return (
    <div className="flex flex-col gap-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/folders"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors p-2 -ml-2 rounded-full hover:bg-glass-border"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                backgroundColor: `${folder.color ?? "#7CB9E8"}20`,
              }}
            >
              <FolderOpen
                className="w-5 h-5"
                style={{ color: folder.color ?? "#7CB9E8" }}
              />
            </div>
            <div>
              <h1 className="text-3xl font-manrope font-bold text-foreground tracking-tight">
                {folder.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                {totalItems} {totalItems === 1 ? "item" : "items"}
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={() => deleteFolder({ id: folderId })}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>

      {totalItems === 0 && (
        <GlassCard className="p-12 text-center text-muted-foreground flex flex-col items-center gap-4">
          <p>
            This folder is empty. Assign notes, tasks or whiteboards to it from
            their pages.
          </p>
        </GlassCard>
      )}

      {/* Notes Section */}
      {folder.notes.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-muted-foreground">
            <Edit3 className="w-4 h-4" />
            Notes
            <span className="text-xs font-normal">({folder.notes.length})</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {folder.notes.map((note) => (
              <Link key={note.id} href={`/notes/${note.id}`}>
                <GlassCard className="p-5 hover:bg-glass-border transition-colors cursor-pointer group">
                  <h3 className="font-semibold group-hover:text-primary transition-colors">
                    {note.title || "Untitled"}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Updated{" "}
                    {new Date(note.updatedAt).toLocaleDateString()}
                  </p>
                </GlassCard>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Tasks Section */}
      {folder.tasks.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-muted-foreground">
            <CheckSquare className="w-4 h-4" />
            Tasks
            <span className="text-xs font-normal">({folder.tasks.length})</span>
          </h2>
          <div className="flex flex-col gap-2">
            {folder.tasks.map((task) => (
              <Link key={task.id} href="/tasks">
                <GlassCard className="p-4 hover:bg-glass-border transition-colors cursor-pointer group flex items-center gap-3">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      task.status === "DONE"
                        ? "bg-emerald-400"
                        : task.status === "IN_PROGRESS"
                          ? "bg-amber-400"
                          : "bg-muted-foreground/40"
                    }`}
                  />
                  <span className="font-medium group-hover:text-primary transition-colors flex-1">
                    {task.title}
                  </span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {task.status.toLowerCase().replace("_", " ")}
                  </span>
                </GlassCard>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Whiteboards Section */}
      {folder.whiteboards.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-muted-foreground">
            <PenTool className="w-4 h-4" />
            Whiteboards
            <span className="text-xs font-normal">
              ({folder.whiteboards.length})
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {folder.whiteboards.map((board) => (
              <Link key={board.id} href={`/whiteboard/${board.id}`}>
                <GlassCard className="p-5 hover:bg-glass-border transition-colors cursor-pointer group">
                  <h3 className="font-semibold group-hover:text-primary transition-colors">
                    {board.name || "Untitled Canvas"}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Updated{" "}
                    {new Date(board.updatedAt).toLocaleDateString()}
                  </p>
                </GlassCard>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
