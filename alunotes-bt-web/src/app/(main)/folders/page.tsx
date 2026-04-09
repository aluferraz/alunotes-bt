"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { GlassCard } from "~/components/ui/glass-card";
import { ColorDot, FOLDER_COLORS } from "~/components/folder-picker";
import Link from "next/link";
import {
  Plus,
  FolderOpen,
  Edit3,
  CheckSquare,
  PenTool,
  Loader2,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

const COLOR_OPTIONS = [
  "#7CB9E8",
  "#9D85FF",
  "#F87171",
  "#FB923C",
  "#FBBF24",
  "#34D399",
  "#60A5FA",
  "#A78BFA",
  "#F472B6",
];

export default function FoldersPage() {
  const queryClient = useQueryClient();
  const { data: folders, isLoading } = useQuery(orpc.folders.list.queryOptions());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<{ id: string; name: string; color: string | null } | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLOR_OPTIONS[0]!);

  const { mutate: createFolder, isPending: isCreating } = useMutation(
    orpc.folders.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.folders.list.queryKey() });
        closeDialog();
      },
    })
  );

  const { mutate: updateFolder, isPending: isUpdating } = useMutation(
    orpc.folders.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.folders.list.queryKey() });
        closeDialog();
      },
    })
  );

  const { mutate: deleteFolder } = useMutation(
    orpc.folders.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.folders.list.queryKey() });
      },
    })
  );

  function closeDialog() {
    setDialogOpen(false);
    setEditingFolder(null);
    setName("");
    setColor(COLOR_OPTIONS[0]!);
  }

  function openCreate() {
    setEditingFolder(null);
    setName("");
    setColor(COLOR_OPTIONS[0]!);
    setDialogOpen(true);
  }

  function openEdit(folder: { id: string; name: string; color: string | null }) {
    setEditingFolder(folder);
    setName(folder.name);
    setColor(folder.color ?? COLOR_OPTIONS[0]!);
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (editingFolder) {
      updateFolder({ id: editingFolder.id, name: name.trim(), color });
    } else {
      createFolder({ name: name.trim(), color });
    }
  }

  return (
    <div className="flex flex-col gap-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-4xl font-manrope font-bold text-foreground tracking-tight">
            Folders
          </h1>
          <p className="text-muted-foreground">
            Organize your notes, tasks and whiteboards
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-6 py-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-medium shadow-glass"
        >
          <Plus className="w-5 h-5" />
          New Folder
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : folders?.length === 0 ? (
        <GlassCard className="p-12 text-center text-muted-foreground flex flex-col items-center gap-4">
          <FolderOpen className="w-12 h-12 text-muted-foreground/40" />
          <p>No folders yet. Create one to start organizing.</p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {folders?.map((folder) => {
            const total =
              folder._count.notes + folder._count.tasks + folder._count.whiteboards;
            return (
              <Link key={folder.id} href={`/folders/${folder.id}`}>
                <GlassCard className="p-6 hover:bg-glass-border transition-colors cursor-pointer group flex flex-col gap-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{ backgroundColor: `${folder.color ?? "#7CB9E8"}20` }}
                      >
                        <FolderOpen
                          className="w-5 h-5"
                          style={{ color: folder.color ?? "#7CB9E8" }}
                        />
                      </div>
                      <div>
                        <h2 className="font-semibold text-lg group-hover:text-primary transition-colors">
                          {folder.name}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {total} {total === 1 ? "item" : "items"}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openEdit(folder);
                      }}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-glass-bg/50 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {folder._count.notes > 0 && (
                      <span className="flex items-center gap-1">
                        <Edit3 className="w-3 h-3" />
                        {folder._count.notes}
                      </span>
                    )}
                    {folder._count.tasks > 0 && (
                      <span className="flex items-center gap-1">
                        <CheckSquare className="w-3 h-3" />
                        {folder._count.tasks}
                      </span>
                    )}
                    {folder._count.whiteboards > 0 && (
                      <span className="flex items-center gap-1">
                        <PenTool className="w-3 h-3" />
                        {folder._count.whiteboards}
                      </span>
                    )}
                  </div>
                </GlassCard>
              </Link>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>
                {editingFolder ? "Edit Folder" : "New Folder"}
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <Input
                placeholder="Folder name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted-foreground">Color</span>
                <div className="flex flex-wrap gap-2">
                  {COLOR_OPTIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={cn(
                        "w-7 h-7 rounded-full transition-all",
                        color === c
                          ? "ring-2 ring-offset-2 ring-offset-popover ring-foreground/30 scale-110"
                          : "hover:scale-110"
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              {editingFolder && (
                <Button
                  type="button"
                  variant="ghost"
                  className="mr-auto text-destructive hover:text-destructive"
                  onClick={() => {
                    deleteFolder({ id: editingFolder.id });
                    closeDialog();
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete
                </Button>
              )}
              <Button
                type="submit"
                disabled={!name.trim() || isCreating || isUpdating}
              >
                {isCreating || isUpdating ? "Saving..." : editingFolder ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
