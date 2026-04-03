"use client"

import * as React from "react"
import { Badge as BaseBadge } from "~/components/ui/badge"
import { cn } from "~/lib/utils"
import { hoverEffects, type HoverEffect } from "~/lib/hover-effects"

export interface BadgeProps extends React.ComponentProps<typeof BaseBadge> {
  glow?: boolean
  hover?: HoverEffect
}

export function Badge({ className, variant = "default", glow = false, hover = "none", ...props }: BadgeProps) {
  return (
    <BaseBadge
      variant={variant}
      className={cn(
        "relative overflow-hidden glass-bg",
        glow && "shadow-lg shadow-purple-500/30",
        "transition-all duration-200",
        hoverEffects({ hover }),
        className
      )}
      {...props}
    />
  )
}
