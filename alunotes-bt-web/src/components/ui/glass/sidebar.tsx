"use client"

import * as React from "react"
import {
  Sidebar as BaseSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "~/components/ui/sidebar"
import { cn } from "~/lib/utils"

export interface SidebarProps extends React.ComponentProps<typeof BaseSidebar> {
  glow?: boolean
}

export const Sidebar = React.forwardRef<HTMLDivElement, SidebarProps>(
  ({ className, glow = false, ...props }, ref) => {
    return (
      <BaseSidebar
        ref={ref}
        className={cn(
          "glass-bg",
          glow && "shadow-lg shadow-purple-500/20",
          className
        )}
        {...props}
      />
    )
  }
)
Sidebar.displayName = "Sidebar"

export {
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
}
