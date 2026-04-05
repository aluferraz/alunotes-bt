"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { GlassCard } from "~/components/ui/glass-card";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";

export default function NotesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: notes, isLoading } = useQuery(orpc.notes.list.queryOptions());
  const { mutate: createNote, isPending } = useMutation(orpc.notes.create.mutationOptions({
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: orpc.notes.list.queryKey() });
      router.push(`/notes/${data.id}`);
    },
  }));

  return (
    <div className="flex flex-col gap-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-4xl font-manrope font-bold text-foreground tracking-tight">Your Notes</h1>
        <button
          onClick={() => void createNote({ title: "" })}
          disabled={isPending}
          className="flex items-center gap-2 px-6 py-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-medium shadow-glass"
        >
          <Plus className="w-5 h-5" />
          {isPending ? "Creating..." : "New Note"}
        </button>
      </div>

      {isLoading ? (
        <div className="flex gap-4 animate-pulse">
          <div className="w-1/2 h-32 bg-glass-border/50 rounded-3xl" />
          <div className="w-1/2 h-32 bg-glass-border/50 rounded-3xl" />
        </div>
      ) : notes?.length === 0 ? (
        <GlassCard className="p-12 text-center text-muted-foreground flex flex-col items-center gap-4">
          <p>No notes found. Create your first document.</p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {notes?.map((note) => (
            <Link key={note.id} href={`/notes/${note.id}`}>
              <GlassCard className="p-6 hover:bg-glass-border transition-colors cursor-pointer group">
                <h2 className="text-xl font-semibold mb-2 group-hover:text-primary transition-colors">
                  {note.title || "Untitled"}
                </h2>
                <div className="text-sm text-muted-foreground">
                  Last updated {new Date(note.updatedAt).toLocaleDateString()}
                </div>
              </GlassCard>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
