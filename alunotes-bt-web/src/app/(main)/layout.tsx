import { AmbientStream } from "~/components/ambient-stream";
import Link from "next/link";
import { ThemeToggle } from "~/components/theme-toggle"; // I will create this next
import { Headphones, PenTool, LayoutDashboard, Folders, CheckSquare, Edit3, Settings } from "lucide-react";

const navItems = [
  { href: "/", label: "Timeline", icon: LayoutDashboard },
  { href: "/audio", label: "Bridge", icon: Headphones },
  { href: "/folders", label: "Folders", icon: Folders },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/whiteboard", label: "Board", icon: PenTool },
  { href: "/notes", label: "Notes", icon: Edit3 },
];

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen z-0 selection:bg-primary/30">
      <AmbientStream />
      
      {/* Mobile-first bottom navigation, desktop side rail could also be derived here */}
      <nav className="fixed bottom-0 sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 w-full sm:w-auto z-50 p-2 sm:p-4 pb-safe">
        <div className="flex items-center justify-around sm:justify-center gap-2 sm:gap-6 px-6 py-4 glass-bg sm:rounded-full rounded-t-3xl border-t sm:border border-glass-border">
          {navItems.map((item) => (
            <Link 
              key={item.href} 
              href={item.href}
              className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 text-muted-foreground hover:text-foreground transition-colors p-2 sm:p-3 rounded-xl sm:rounded-full hover:bg-glass-bg/50"
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] sm:text-sm font-medium tracking-wide">{item.label}</span>
            </Link>
          ))}
          <Link 
            href="/settings"
            className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 text-muted-foreground hover:text-foreground transition-colors p-2 sm:p-3 rounded-xl sm:rounded-full hover:bg-glass-bg/50"
          >
            <Settings className="w-5 h-5" />
            <span className="text-[10px] sm:text-sm font-medium tracking-wide">Settings</span>
          </Link>
        </div>
      </nav>

      <main className="container mx-auto p-4 sm:p-8 pb-32 sm:pb-40 pt-16">
        {children}
      </main>
    </div>
  );
}
