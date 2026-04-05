"use client";

import { GlassCard } from "~/components/ui/glass-card";
import { Folder, Briefcase, Archive, Tag, Lightbulb, FolderOpen } from "lucide-react";

export default function FoldersPage() {
  const categories = [
    { name: "Personal", icon: Folder, color: "text-blue-400", bg: "bg-blue-400/10" },
    { name: "Work", icon: Briefcase, color: "text-orange-400", bg: "bg-orange-400/10" },
    { name: "Archived", icon: Archive, color: "text-gray-400", bg: "bg-gray-400/10" },
    { name: "Priority", icon: Tag, color: "text-red-400", bg: "bg-red-400/10" },
    { name: "Idea", icon: Lightbulb, color: "text-yellow-400", bg: "bg-yellow-400/10" },
  ];

  const activeFolders = [
    { title: "Personal", desc: "Private journals, travel plans, and life goals." },
    { title: "Work", desc: "Meeting minutes, project specs, and roadmap." },
    { title: "Ideas", desc: "Late night sparks and future side projects." },
  ];

  return (
    <div className="flex flex-col gap-8 max-w-4xl mx-auto">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-extrabold text-foreground tracking-tight">Folders & Tags</h1>
        <p className="text-muted-foreground text-lg">Manage your organizational structure</p>
      </div>

      {/* Horizontal Nav / Shortcuts */}
      <div className="flex items-center space-x-4 overflow-x-auto pb-4 scrollbar-none">
        {categories.map((c) => (
          <button 
            key={c.name}
            className="flex flex-col items-center gap-2 p-4 rounded-3xl hover:bg-glass-bg/50 border border-transparent hover:border-glass-border transition-all min-w-[80px]"
          >
            <div className={`w-14 h-14 rounded-full flex items-center justify-center ${c.bg}`}>
              <c.icon className={`w-6 h-6 ${c.color}`} />
            </div>
            <span className="text-xs font-semibold">{c.name}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Active Folders Section */}
        <GlassCard className="p-6 md:p-8 flex flex-col gap-6">
          <h2 className="text-2xl font-bold flex items-center gap-3">
             <FolderOpen className="w-5 h-5 text-secondary" />
             Active Folders
          </h2>
          <div className="flex flex-col gap-4">
             {activeFolders.map(folder => (
               <div key={folder.title} className="p-4 rounded-xl bg-background/40 hover:bg-background/60 border border-glass-border cursor-pointer transition-colors group">
                 <h3 className="font-semibold text-lg flex items-center gap-2 group-hover:text-secondary transition-colors">
                   <Folder className="w-4 h-4 text-muted-foreground group-hover:text-secondary" />
                   {folder.title}
                 </h3>
                 <p className="text-sm text-muted-foreground mt-1">{folder.desc}</p>
               </div>
             ))}
          </div>
        </GlassCard>

        {/* Global Tags Section */}
        <GlassCard className="p-6 md:p-8 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-bold flex items-center gap-3">
              <Tag className="w-5 h-5 text-primary" />
              Global Tags
            </h2>
            <p className="text-sm text-muted-foreground">
              A high-level view of your classification system. Drill down into specific contexts across all folders.
            </p>
          </div>
          
          <div className="flex flex-wrap gap-2 mt-4">
             {["#urgent", "#read-later", "#meeting-notes", "#drafts", "#planning", "#reference"].map((tag) => (
               <span key={tag} className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold font-mono hover:bg-primary/20 cursor-pointer transition-colors">
                 {tag}
               </span>
             ))}
          </div>
        </GlassCard>

      </div>
    </div>
  );
}
