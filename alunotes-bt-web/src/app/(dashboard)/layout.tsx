import { redirect } from "next/navigation";
import { getSession } from "~/server/better-auth/server";
import { SidebarProvider, SidebarInset } from "~/components/ui/sidebar";
import { TooltipProvider } from "~/components/ui/tooltip";
import { AppSidebar } from "~/components/app-sidebar";
import { AppHeader } from "~/components/app-header";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session?.user) {
    redirect("/auth/signin");
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <AppHeader />
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
