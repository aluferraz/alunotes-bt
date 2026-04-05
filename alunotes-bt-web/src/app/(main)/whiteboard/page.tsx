"use client";

import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { GlassCard } from "~/components/ui/glass-card";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";

export default function WhiteboardIndexPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: boards, isLoading } = useQuery(orpc.whiteboard.list.queryOptions());
  const { mutate: createBoard, isPending } = useMutation(orpc.whiteboard.create.mutationOptions({
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: orpc.whiteboard.list.queryKey() });
      router.push(`/whiteboard/${data.id}`);
    },
  }));

  return (
    <div className="flex flex-col gap-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-4xl font-manrope font-bold text-foreground">Whiteboards</h1>
        <button
          onClick={() => void createBoard({ name: "New Canvas" })}
          disabled={isPending}
          className="flex items-center gap-2 px-6 py-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-medium shadow-glass"
        >
          <Plus className="w-5 h-5" />
          {isPending ? "Creating..." : "New Canvas"}
        </button>
      </div>

      {isLoading ? (
        <div className="flex gap-4 animate-pulse">
          <div className="w-1/2 h-32 bg-glass-border/50 rounded-3xl" />
        </div>
      ) : boards?.length === 0 ? (
        <GlassCard className="p-12 text-center text-muted-foreground flex flex-col items-center gap-4">
          <p>No whiteboards found. Start a new canvas.</p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards?.map((board) => (
            <Link key={board.id} href={`/whiteboard/${board.id}`}>
              <GlassCard className="p-6 h-40 hover:bg-glass-border transition-colors cursor-pointer group flex flex-col justify-between">
                <h2 className="text-xl font-semibold group-hover:text-primary transition-colors">
                  {board.name || "Untitled Canvas"}
                </h2>
                <div className="text-xs text-muted-foreground">
                  Updated {new Date(board.updatedAt).toLocaleDateString()}
                </div>
              </GlassCard>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
