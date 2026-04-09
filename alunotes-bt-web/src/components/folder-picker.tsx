"use client";

import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { Folder, X } from "lucide-react";
import { cn } from "~/lib/utils";
import { useState, useRef, useEffect, useCallback } from "react";

const FOLDER_COLORS: Record<string, string> = {
  "#7CB9E8": "bg-[#7CB9E8]",
  "#9D85FF": "bg-[#9D85FF]",
  "#F87171": "bg-red-400",
  "#FB923C": "bg-orange-400",
  "#FBBF24": "bg-amber-400",
  "#34D399": "bg-emerald-400",
  "#60A5FA": "bg-blue-400",
  "#A78BFA": "bg-violet-400",
  "#F472B6": "bg-pink-400",
};

function ColorDot({ color, className }: { color?: string | null; className?: string }) {
  return (
    <span
      className={cn("inline-block w-2.5 h-2.5 rounded-full shrink-0", className)}
      style={{ backgroundColor: color ?? "#7CB9E8" }}
    />
  );
}

export function FolderPicker({
  value,
  onChange,
  className,
}: {
  value: string | null | undefined;
  onChange: (folderId: string | null) => void;
  className?: string;
}) {
  const { data: folders } = useQuery(orpc.folders.list.queryOptions());
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 6,
      left: rect.left,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      )
        return;
      setOpen(false);
    }

    function handleScroll() {
      setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, updatePosition]);

  const selected = folders?.find((f) => f.id === value);

  const dropdown =
    open && pos
      ? createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[999] min-w-[200px] rounded-2xl bg-popover/95 backdrop-blur-xl px-1.5 py-1.5 shadow-[0_20px_40px_rgba(0,0,0,0.35),0_0_1px_rgba(255,255,255,0.06)] animate-in fade-in-0 zoom-in-95 duration-100"
            style={{ top: pos.top, left: pos.left }}
          >
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className={cn(
                "flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-colors rounded-lg",
                !value
                  ? "text-foreground bg-white/8"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-muted-foreground/30" />
              No folder
            </button>
            {folders?.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => {
                  onChange(folder.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-colors rounded-lg",
                  value === folder.id
                    ? "text-foreground bg-white/8"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                <ColorDot color={folder.color} />
                {folder.name}
              </button>
            ))}
            {folders?.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No folders yet
              </div>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
          selected
            ? "glass-bg backdrop-blur-sm text-foreground hover:bg-white/10"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5"
        )}
      >
        {selected ? (
          <>
            <ColorDot color={selected.color} />
            <span className="max-w-[100px] truncate">{selected.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              className="ml-0.5 p-0.5 rounded-full hover:bg-white/10 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </>
        ) : (
          <>
            <Folder className="w-3.5 h-3.5" />
            <span>Folder</span>
          </>
        )}
      </button>
      {dropdown}
    </div>
  );
}

export { ColorDot, FOLDER_COLORS };
