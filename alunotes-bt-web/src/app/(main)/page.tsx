"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { GlassCard } from "~/components/ui/glass-card";
import Link from "next/link";
import { CheckSquare, Edit3, PenTool, Mic, LayoutDashboard, Calendar, Search, ArrowRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
export default function TimelinePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const { data: notes } = useQuery(orpc.notes.list.queryOptions());
  const { data: tasks } = useQuery(orpc.tasks.list.queryOptions());
  const { data: boards } = useQuery(orpc.whiteboard.list.queryOptions());
  const { data: recordings } = useQuery(orpc.recordings.list.queryOptions());

  // Combine feeds into one timeline
  const feed = [
    ...(notes || []).map((n) => ({
      id: n.id,
      type: "note",
      title: n.title,
      date: new Date(n.updatedAt),
      url: `/notes/${n.id}`,
      icon: Edit3,
    })),
    ...(tasks || []).map((t) => ({
      id: t.id,
      type: "task",
      title: t.title,
      date: new Date(t.updatedAt),
      url: `/tasks`,
      icon: CheckSquare,
    })),
    ...(boards || []).map((b) => ({
      id: b.id,
      type: "board",
      title: b.name,
      date: new Date(b.updatedAt),
      url: `/whiteboard/${b.id}`,
      icon: PenTool,
    })),
    ...(recordings?.items || []).map((r) => ({
      id: r.sessionId,
      type: "recording",
      title: r.label || `Recording ${r.date} ${r.time.replace(/-/g, ":")}`,
      date: new Date(`${r.date}T${r.time.replace(/-/g, ":")}`),
      url: `/audio`,
      icon: Mic,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const filteredFeed = searchQuery
    ? feed.filter((item) =>
        item.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : feed;

  return (
    <div className="flex flex-col gap-8 max-w-4xl mx-auto mt-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-manrope font-extrabold text-foreground tracking-tight">Morning, Alu.</h1>
        <p className="text-muted-foreground text-lg">Here's your latest activity.</p>
      </div>

      <div className="relative">
        <div className="absolute inset-y-0 left-4 pl-1 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-muted-foreground" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="block w-full rounded-2xl border-none bg-glass-bg py-4 pl-12 pr-4 text-foreground shadow-glass-sm outline-none backdrop-blur-md placeholder:text-muted-foreground"
          placeholder="Search your notes, tasks, and canvas..."
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        <div className="md:col-span-8 flex flex-col gap-6">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <LayoutDashboard className="w-5 h-5 text-primary" />
            Recent Activity
          </h2>
          {filteredFeed.length === 0 ? (
            <GlassCard className="p-12 text-center text-muted-foreground">
              {searchQuery ? "No results found." : "No recent activity. Start exploring!"}
            </GlassCard>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredFeed.slice(0, 10).map((item) => (
                <Link key={`${item.type}-${item.id}`} href={item.url}>
                  <GlassCard className="p-4 sm:p-5 flex items-center gap-4 hover:shadow-glass hover:bg-glass-border/50 transition-all group">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <item.icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">{item.title}</h3>
                      <p className="text-sm text-muted-foreground capitalize">Modified {item.type}</p>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap hidden sm:block">
                      {formatDistanceToNow(item.date, { addSuffix: true })}
                    </div>
                  </GlassCard>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="md:col-span-4 flex flex-col gap-6">
          <Link href="/tasks" className="flex items-center gap-2 group">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Calendar className="w-5 h-5 text-secondary" />
              Agenda
            </h2>
            <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
          </Link>
          <GlassCard className="p-6 h-[400px] flex flex-col gap-4">
             {tasks?.filter(t => t.status !== "DONE").slice(0, 5).map(task => (
                <div key={task.id} className="flex items-center gap-3">
                   <div className="w-2 h-2 rounded-full bg-secondary shrink-0" />
                   <span className="text-sm font-medium truncate">{task.title}</span>
                </div>
             )) || <div className="text-muted-foreground text-sm flex-1 flex items-center justify-center">No pending tasks today.</div>}

             {tasks?.length && tasks.filter(t => t.status !== "DONE").length === 0 ? (
                 <div className="text-muted-foreground text-sm flex-1 flex items-center justify-center text-center">Done with everything!</div>
             ) : null}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
