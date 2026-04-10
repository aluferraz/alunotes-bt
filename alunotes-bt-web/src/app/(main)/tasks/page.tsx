"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  useQueryClient,
  useQuery,
  useMutation,
} from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { GlassCard } from "~/components/ui/glass-card";
import {
  Check,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Calendar,
  Flame,
  Clock,
  Search,
  Loader2,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  useSimpleEditor,
  SimpleEditorToolbar,
  SimpleEditorContent,
} from "~/components/tiptap-templates/simple/simple-editor";
import { EditorContext } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { useUIPreferences } from "~/stores/ui-preferences";
import { FolderPicker } from "~/components/folder-picker";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import type { EventInput } from "@fullcalendar/core";

// ─── Types ───────────────────────────────────────────────────────────────────

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | null;
  folderId: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
};

type ViewTab = "all" | "by-status" | "completed" | "calendar";
type StatusFilter = "TODO" | "IN_PROGRESS" | "DONE";
type PriorityFilter = "HIGH" | "MEDIUM" | "LOW";

// ─── Priority Config ─────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<
  string,
  { label: string; color: string; glow: string; icon?: boolean }
> = {
  HIGH: {
    label: "P1",
    color: "text-red-400",
    glow: "shadow-[0_0_12px_rgba(239,68,68,0.3)]",
    icon: true,
  },
  MEDIUM: {
    label: "P2",
    color: "text-amber-400",
    glow: "shadow-[0_0_12px_rgba(245,158,11,0.2)]",
  },
  LOW: {
    label: "P3",
    color: "text-primary",
    glow: "shadow-[0_0_12px_rgba(124,185,232,0.15)]",
  },
};

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  TODO: {
    label: "Not Started",
    bg: "bg-muted/40",
    text: "text-muted-foreground",
  },
  IN_PROGRESS: {
    label: "In Progress",
    bg: "bg-primary/15",
    text: "text-primary",
  },
  DONE: {
    label: "Completed",
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
  },
};

// ─── Inline Editable Title ───────────────────────────────────────────────────

function InlineTitle({
  value,
  done,
  onSave,
}: {
  value: string;
  done: boolean;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== value) onSave(draft.trim());
    else setDraft(value);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="bg-transparent text-foreground font-medium text-[0.95rem] outline-none w-full px-0 py-0 border-none focus:ring-0"
      />
    );
  }

  return (
    <span
      onDoubleClick={() => setEditing(true)}
      className={cn(
        "font-medium text-[0.95rem] cursor-text select-none transition-colors",
        done
          ? "line-through text-muted-foreground/40"
          : "text-foreground hover:text-primary/80"
      )}
    >
      {value}
    </span>
  );
}

// ─── Priority Badge ──────────────────────────────────────────────────────────

function PriorityBadge({
  priority,
  onChange,
}: {
  priority: string;
  onChange: (p: string) => void;
}) {
  const fallback = { label: "P2", color: "text-amber-400", glow: "shadow-[0_0_12px_rgba(245,158,11,0.2)]" } as const;
  const config = PRIORITY_CONFIG[priority] ?? fallback;
  const cycle = () => {
    const order: PriorityFilter[] = ["HIGH", "MEDIUM", "LOW"];
    const idx = order.indexOf(priority as PriorityFilter);
    onChange(order[(idx + 1) % order.length]!);
  };

  return (
    <button
      onClick={cycle}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wider transition-all",
        "bg-white/5 backdrop-blur-sm",
        config.color,
        config.glow
      )}
      title={`Priority: ${priority} (click to cycle)`}
    >
      {"icon" in config && config.icon && <Flame className="w-3 h-3" />}
      {config.label}
    </button>
  );
}

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  onChange,
}: {
  status: string;
  onChange: (s: string) => void;
}) {
  const fallback = { label: "Not Started", bg: "bg-muted/40", text: "text-muted-foreground" } as const;
  const config = STATUS_CONFIG[status] ?? fallback;
  const cycle = () => {
    const order: StatusFilter[] = ["TODO", "IN_PROGRESS", "DONE"];
    const idx = order.indexOf(status as StatusFilter);
    onChange(order[(idx + 1) % order.length]!);
  };

  return (
    <button
      onClick={cycle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold tracking-wide transition-all",
        config.bg,
        config.text
      )}
      title={`Status: ${config.label} (click to cycle)`}
    >
      {status === "IN_PROGRESS" && (
        <Clock className="w-3 h-3 animate-pulse" />
      )}
      {config.label}
    </button>
  );
}

// ─── Due Date Display ────────────────────────────────────────────────────────

function DueDateDisplay({
  date,
  onChange,
}: {
  date: Date | null;
  onChange: (d: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const formatRelative = (dateVal: Date) => {
    const d = new Date(dateVal);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffH = Math.round(diffMs / (1000 * 60 * 60));
    const diffD = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffD < 0) return { text: `${Math.abs(diffD)}d overdue`, overdue: true };
    if (diffH < 1) return { text: "Due now", overdue: true };
    if (diffH < 24) return { text: `Due in ${diffH}h`, overdue: false };
    if (diffD < 7) return { text: `Due in ${diffD}d`, overdue: false };
    return {
      text: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      overdue: false,
    };
  };

  if (!date) {
    return (
      <button
        onClick={() => inputRef.current?.showPicker()}
        className="inline-flex items-center gap-1 text-[0.7rem] text-muted-foreground/50 hover:text-muted-foreground transition-colors rounded-full px-2 py-0.5"
      >
        <Calendar className="w-3 h-3" />
        <span>Set date</span>
        <input
          ref={inputRef}
          type="date"
          className="sr-only"
          onChange={(e) => onChange(e.target.value || null)}
        />
      </button>
    );
  }

  const { text, overdue } = formatRelative(date);
  return (
    <button
      onClick={() => inputRef.current?.showPicker()}
      className={cn(
        "inline-flex items-center gap-1 text-[0.7rem] rounded-full px-2 py-0.5 transition-colors",
        overdue
          ? "text-red-400/80"
          : "text-muted-foreground/60 hover:text-muted-foreground"
      )}
    >
      <Calendar className="w-3 h-3" />
      <span>{text}</span>
      <input
        ref={inputRef}
        type="date"
        value={new Date(date).toISOString().split("T")[0]}
        className="sr-only"
        onChange={(e) => onChange(e.target.value || null)}
      />
    </button>
  );
}

// ─── Task Description (TipTap) ──────────────────────────────────────────────

function TaskDescription({
  taskId,
  initialContent,
}: {
  taskId: string;
  initialContent: string | null;
}) {
  const queryClient = useQueryClient();
  const editorTheme = useUIPreferences((s) => s.editorTheme);
  const { mutateAsync: updateTask } = useMutation(
    orpc.tasks.update.mutationOptions()
  );

  const handleUpdate = useCallback(
    (content: string) => {
      void updateTask({ id: taskId, description: content });
      void queryClient.invalidateQueries({
        queryKey: orpc.tasks.list.queryKey(),
      });
    },
    [taskId, updateTask, queryClient]
  );

  const editorState = useSimpleEditor({
    initialContent: initialContent ?? undefined,
    onUpdate: handleUpdate,
    extraExtensions: [
      Placeholder.configure({ placeholder: "Add details to this task..." }),
    ],
  });

  return (
    <EditorContext.Provider value={{ editor: editorState.editor }}>
      <div className={`simple-editor-wrapper flex flex-col editor-theme-${editorTheme} rounded-2xl overflow-clip p-4`}>
        <div className="pb-3 mb-3">
          <SimpleEditorToolbar {...editorState} />
        </div>
        <div className="simple-editor-content-area min-h-[120px]">
          <SimpleEditorContent editor={editorState.editor} />
        </div>
      </div>
    </EditorContext.Provider>
  );
}

// ─── Task Row ────────────────────────────────────────────────────────────────

function TaskRow({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.tasks.list.queryKey() });
    void queryClient.invalidateQueries({ queryKey: orpc.folders.list.queryKey() });
  };

  const { mutate: updateTask } = useMutation({
    ...orpc.tasks.update.mutationOptions(),
    onSuccess: invalidate,
  });

  const { mutate: deleteTask } = useMutation({
    ...orpc.tasks.delete.mutationOptions(),
    onSuccess: invalidate,
  });

  const isDone = task.status === "DONE";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <GlassCard
        className={cn(
          "group transition-all duration-300 overflow-hidden",
          "rounded-2xl sm:rounded-3xl",
          isDone && "opacity-60"
        )}
      >
        {/* Main row */}
        <div className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5">
          {/* Expand chevron */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0"
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>

          {/* Checkbox */}
          <button
            onClick={() =>
              updateTask({
                id: task.id,
                status: isDone ? "TODO" : "DONE",
              })
            }
            className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-300",
              isDone
                ? "bg-gradient-to-r from-primary to-secondary text-primary-foreground shadow-[0_0_15px_rgba(124,185,232,0.3)]"
                : "border border-white/15 hover:border-primary/50 text-transparent hover:text-primary/30"
            )}
          >
            <Check className="w-3.5 h-3.5" />
          </button>

          {/* Title */}
          <div className="flex-1 min-w-0">
            <InlineTitle
              value={task.title}
              done={isDone}
              onSave={(title) => updateTask({ id: task.id, title })}
            />
          </div>

          {/* Properties: badges + date + delete */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex items-center gap-2">
              <FolderPicker
                value={task.folderId}
                onChange={(folderId) =>
                  updateTask({ id: task.id, folderId })
                }
              />
              <PriorityBadge
                priority={task.priority}
                onChange={(priority) =>
                  updateTask({ id: task.id, priority })
                }
              />
              <StatusBadge
                status={task.status}
                onChange={(status) =>
                  updateTask({ id: task.id, status })
                }
              />
              <DueDateDisplay
                date={task.dueDate}
                onChange={(dueDate) =>
                  updateTask({ id: task.id, dueDate })
                }
              />
            </div>

            <button
              onClick={() => deleteTask({ id: task.id })}
              className="opacity-0 group-hover:opacity-100 p-1.5 text-destructive/60 hover:text-destructive hover:bg-destructive/10 rounded-full transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Mobile badges row */}
        <div className="flex sm:hidden items-center gap-2 px-4 pb-3 pl-[4.25rem] flex-wrap">
          <FolderPicker
            value={task.folderId}
            onChange={(folderId) =>
              updateTask({ id: task.id, folderId })
            }
          />
          <PriorityBadge
            priority={task.priority}
            onChange={(priority) =>
              updateTask({ id: task.id, priority })
            }
          />
          <StatusBadge
            status={task.status}
            onChange={(status) =>
              updateTask({ id: task.id, status })
            }
          />
          <DueDateDisplay
            date={task.dueDate}
            onChange={(dueDate) =>
              updateTask({ id: task.id, dueDate })
            }
          />
        </div>

        {/* Expanded: TipTap description */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="px-4 sm:px-5 pb-4 pt-1 ml-[2.75rem] sm:ml-[3.25rem] border-t border-white/5">
                <div className="mt-3">
                  <TaskDescription
                    taskId={task.id}
                    initialContent={task.description}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  );
}

// ─── New Task Input ──────────────────────────────────────────────────────────

function NewTaskInput() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { mutate: createTask, isPending } = useMutation({
    ...orpc.tasks.create.mutationOptions(),
    onSuccess: () => {
      setTitle("");
      queryClient.invalidateQueries({ queryKey: orpc.tasks.list.queryKey() });
      inputRef.current?.focus();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim()) createTask({ title: title.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3">
      <div className="flex-1 relative">
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs to be done?"
          className="w-full bg-white/5 backdrop-blur-xl rounded-full px-5 py-3 text-foreground text-sm placeholder:text-muted-foreground/40 outline-none transition-all focus:bg-white/8 focus:shadow-[0_0_20px_rgba(124,185,232,0.08)]"
        />
      </div>
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        type="submit"
        disabled={!title.trim() || isPending}
        className="shrink-0 p-3 rounded-full bg-gradient-to-r from-primary to-secondary text-primary-foreground disabled:opacity-40 transition-all shadow-[0_8px_24px_rgba(124,185,232,0.2)] disabled:shadow-none"
      >
        {isPending ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Plus className="w-5 h-5" />
        )}
      </motion.button>
    </form>
  );
}

// ─── Calendar View ──────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: "#ef4444",
  MEDIUM: "#f59e0b",
  LOW: "#22c55e",
};

const STATUS_COLORS: Record<string, string> = {
  DONE: "#6b7280",
};

type Recording = {
  sessionId: string;
  date: string;
  time: string;
  label: string | null;
};

function CalendarView({ tasks, recordings }: { tasks: Task[]; recordings: Recording[] }) {
  const taskEvents: EventInput[] = tasks
    .filter((t) => t.dueDate)
    .map((t) => ({
      id: t.id,
      title: t.title,
      date: new Date(t.dueDate!).toISOString().split("T")[0],
      color:
        STATUS_COLORS[t.status] ?? PRIORITY_COLORS[t.priority] ?? "#6366f1",
    }));

  const recordingEvents: EventInput[] = recordings.map((r) => ({
    id: `rec-${r.sessionId}`,
    title: r.label || `Recording ${r.time.replace(/-/g, ":")}`,
    date: r.date,
    color: "#a855f7",
  }));

  const events = [...taskEvents, ...recordingEvents];

  return (
    <div className="glass-bg rounded-2xl p-4 sm:p-6 shadow-glass-sm backdrop-blur-md [--fc-border-color:theme(--color-glass-border)] [--fc-today-bg-color:theme(--color-primary/0.08)] [--fc-page-bg-color:transparent] [--fc-neutral-bg-color:transparent]">
      <style>{`
        .fc {
          --fc-small-font-size: 0.85em;
        }
        .fc .fc-toolbar-title {
          font-family: var(--font-manrope), system-ui, sans-serif;
          font-weight: 700;
          color: hsl(var(--foreground));
        }
        .fc .fc-col-header-cell-cushion,
        .fc .fc-daygrid-day-number {
          color: hsl(var(--foreground));
          text-decoration: none;
        }
        .fc .fc-button {
          background: hsl(var(--muted));
          border: 1px solid hsl(var(--border));
          color: hsl(var(--foreground));
          font-weight: 500;
          border-radius: 0.5rem;
          padding: 0.35rem 0.75rem;
          text-transform: capitalize;
        }
        .fc .fc-button:hover {
          background: hsl(var(--accent));
        }
        .fc .fc-button-active,
        .fc .fc-button:active {
          background: hsl(var(--primary)) !important;
          color: hsl(var(--primary-foreground)) !important;
        }
        .fc .fc-event {
          border: none;
          border-radius: 0.375rem;
          padding: 1px 4px;
          font-size: 0.8rem;
          cursor: pointer;
        }
        .fc .fc-daygrid-day.fc-day-today {
          border-radius: 0.5rem;
        }
        .fc td, .fc th {
          border-color: hsl(var(--border) / 0.3);
        }
      `}</style>
      <FullCalendar
        plugins={[dayGridPlugin]}
        initialView="dayGridMonth"
        events={events}
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,dayGridWeek",
        }}
        height="auto"
        dayMaxEvents={3}
      />
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function TasksPage() {
  const [activeTab, setActiveTab] = useState<ViewTab>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: tasks, isLoading } = useQuery(
    orpc.tasks.list.queryOptions()
  );
  const { data: recordings } = useQuery(orpc.recordings.list.queryOptions());

  // Filter tasks based on active tab and search
  const filteredTasks = (tasks ?? []).filter((task) => {
    // Search filter
    if (
      searchQuery &&
      !task.title.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;

    // Tab filter
    if (activeTab === "completed") return task.status === "DONE";
    if (activeTab === "by-status") return true; // show all, grouped
    return true;
  });

  // Group by status for "By Status" view
  const groupedTasks =
    activeTab === "by-status"
      ? {
          IN_PROGRESS: filteredTasks.filter(
            (t) => t.status === "IN_PROGRESS"
          ),
          TODO: filteredTasks.filter((t) => t.status === "TODO"),
          DONE: filteredTasks.filter((t) => t.status === "DONE"),
        }
      : null;

  const tabs: { key: ViewTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "by-status", label: "By Status" },
    { key: "completed", label: "Completed" },
    { key: "calendar", label: "Calendar" },
  ];

  const taskCount = filteredTasks.length;
  const activeCount = (tasks ?? []).filter(
    (t) => t.status !== "DONE"
  ).length;

  return (
    <div className="relative flex flex-col gap-8 pb-32">
      {/* Ambient glow orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
        <div className="absolute top-[15%] left-[10%] w-[300px] h-[300px] rounded-full bg-primary/[0.07] blur-[120px]" />
        <div className="absolute top-[40%] right-[5%] w-[250px] h-[250px] rounded-full bg-secondary/[0.05] blur-[100px]" />
      </div>

      {/* Header */}
      <div className="flex items-end justify-between pt-4">
        <div>
          <h1 className="text-[3rem] sm:text-[3.5rem] leading-[1.1] font-sans font-medium text-foreground tracking-[-0.02em]">
            Tasks
          </h1>
          <p className="text-muted-foreground/60 text-sm mt-1 tracking-wide">
            {activeCount} active task{activeCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 p-1 rounded-full bg-white/5 backdrop-blur-md">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-medium transition-all",
                activeTab === tab.key
                  ? "bg-white/10 text-foreground shadow-[0_0_12px_rgba(124,185,232,0.1)]"
                  : "text-muted-foreground/60 hover:text-muted-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex-1 relative ml-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter..."
            className="w-full bg-white/5 backdrop-blur-md rounded-full pl-8 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground/30 outline-none transition-all focus:bg-white/8 focus:shadow-[0_0_12px_rgba(124,185,232,0.06)]"
          />
        </div>
      </div>

      {/* New task input */}
      <NewTaskInput />

      {/* Calendar view */}
      {activeTab === "calendar" ? (
        <CalendarView tasks={(tasks ?? []) as Task[]} recordings={(recordings?.items ?? []) as Recording[]} />
      ) : (
      /* Task list */
      <div className="flex flex-col gap-3">
        {isLoading ? (
          <>
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-14 rounded-2xl bg-white/5 animate-pulse backdrop-blur-sm"
              />
            ))}
          </>
        ) : filteredTasks.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground/40 text-lg">
              {searchQuery
                ? "No tasks match your search."
                : activeTab === "completed"
                  ? "No completed tasks yet."
                  : "No tasks yet. Create one above!"}
            </p>
          </div>
        ) : groupedTasks ? (
          // By Status view
          <>
            {(
              Object.entries(groupedTasks) as [string, typeof filteredTasks][]
            ).map(
              ([status, statusTasks]) =>
                statusTasks.length > 0 && (
                  <div key={status} className="flex flex-col gap-3">
                    <div className="flex items-center gap-3 px-2 pt-3">
                      <span
                        className={cn(
                          "text-xs font-semibold uppercase tracking-[0.05em]",
                          STATUS_CONFIG[status]?.text ??
                            "text-muted-foreground"
                        )}
                      >
                        {STATUS_CONFIG[status]?.label ?? status}
                      </span>
                      <span className="text-xs text-muted-foreground/40">
                        {statusTasks.length}
                      </span>
                      <div className="flex-1 h-px bg-white/5" />
                    </div>
                    <AnimatePresence mode="popLayout">
                      {statusTasks.map((task) => (
                        <TaskRow key={task.id} task={task as Task} />
                      ))}
                    </AnimatePresence>
                  </div>
                )
            )}
          </>
        ) : (
          // All / Completed view
          <AnimatePresence mode="popLayout">
            {filteredTasks.map((task) => (
              <TaskRow key={task.id} task={task as Task} />
            ))}
          </AnimatePresence>
        )}
      </div>
      )}
    </div>
  );
}
