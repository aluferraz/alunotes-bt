"use client";

import { useState } from "react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { GlassCard } from "~/components/ui/glass-card";
import { Check, Plus, Trash2 } from "lucide-react";
import { cn } from "~/lib/utils";

export default function TasksPage() {
  const queryClient = useQueryClient();
  const { data: tasks, isLoading } = useQuery(orpc.tasks.list.queryOptions());
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const { mutate: createTask } = useMutation(orpc.tasks.create.mutationOptions({
    onSuccess: () => {
      setNewTaskTitle("");
      queryClient.invalidateQueries({ queryKey: orpc.tasks.list.queryKey() });
    },
  }));

  const { mutate: updateTask } = useMutation(orpc.tasks.update.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.tasks.list.queryKey() }),
  }));

  const { mutate: deleteTask } = useMutation(orpc.tasks.delete.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.tasks.list.queryKey() }),
  }));

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTaskTitle.trim()) {
      void createTask({ title: newTaskTitle.trim() });
    }
  };

  return (
    <div className="flex flex-col gap-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-4xl font-manrope font-bold text-foreground">Tasks</h1>
      </div>

      <GlassCard className="p-2 backdrop-blur-md">
        <form onSubmit={handleCreate} className="flex gap-2 p-2">
          <input
            type="text"
            placeholder="Add a new task..."
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            className="flex-1 bg-transparent px-4 py-2 text-foreground focus:outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            className="p-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
            disabled={!newTaskTitle.trim()}
          >
            <Plus className="w-5 h-5" />
          </button>
        </form>
      </GlassCard>

      <div className="flex flex-col gap-3">
        {isLoading ? (
          <div className="h-16 bg-glass-border/50 animate-pulse rounded-2xl" />
        ) : tasks?.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No tasks yet! You're all caught up.</div>
        ) : (
          tasks?.map((task) => (
            <GlassCard key={task.id} className="p-4 flex items-center justify-between group transition-all hover:bg-glass-border/30">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => updateTask({ id: task.id, status: task.status === "DONE" ? "TODO" : "DONE" })}
                  className={cn(
                    "w-6 h-6 rounded flex items-center justify-center border transition-colors",
                    task.status === "DONE" 
                      ? "bg-primary border-primary text-primary-foreground" 
                      : "border-muted-foreground/30 hover:border-primary/50 text-transparent"
                  )}
                >
                  <Check className="w-4 h-4" />
                </button>
                <span className={cn(
                  "font-medium transition-all",
                  task.status === "DONE" && "line-through text-muted-foreground"
                )}>
                  {task.title}
                </span>
              </div>
              <button
                onClick={() => deleteTask({ id: task.id })}
                className="opacity-0 group-hover:opacity-100 p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </GlassCard>
          ))
        )}
      </div>
    </div>
  );
}
