import { AmbientStream } from "~/components/ambient-stream";
import Link from "next/link";
import { TopNavbar } from "~/components/top-navbar";
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
      <TopNavbar />

      {/* Fade-out gradient below the top navbar */}
      <div className="fixed top-0 w-full z-40 pointer-events-none h-24 sm:h-28" aria-hidden="true">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background/60 to-transparent backdrop-blur-sm [mask-image:linear-gradient(to_bottom,black_40%,transparent)]" />
      </div>

      {/* Fade-out gradient above the navigation bar */}
      <div className="fixed bottom-0 w-full z-40 pointer-events-none h-40 sm:h-48" aria-hidden="true">
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent backdrop-blur-sm [mask-image:linear-gradient(to_top,black_40%,transparent)]" />
      </div>

      {/* Mobile-first bottom navigation, desktop side rail could also be derived here */}
      <nav className="fixed bottom-0 sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 w-full sm:w-auto z-50 p-2 sm:p-4 pb-safe">
        <div className="flex items-center justify-around sm:justify-center gap-2 sm:gap-6 px-6 py-4 glass-bg sm:rounded-full rounded-t-3xl border-t sm:border border-glass-border overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {navItems.map((item) => (
            <Link 
              key={item.href} 
              href={item.href}
              className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 text-muted-foreground hover:text-foreground transition-colors p-2 sm:p-3 rounded-xl sm:rounded-full hover:bg-glass-bg/50 shrink-0"
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] sm:text-sm font-medium tracking-wide whitespace-nowrap">{item.label}</span>
            </Link>
          ))}
          <Link
            href="/settings"
            className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 text-muted-foreground hover:text-foreground transition-colors p-2 sm:p-3 rounded-xl sm:rounded-full hover:bg-glass-bg/50 shrink-0"
          >
            <Settings className="w-5 h-5" />
            <span className="text-[10px] sm:text-sm font-medium tracking-wide">Settings</span>
          </Link>
        </div>
      </nav>

      <main className="container mx-auto p-4 sm:p-8 pb-32 sm:pb-40 pt-20 sm:pt-24">
        {children}
      </main>
    </div>
  );
}
