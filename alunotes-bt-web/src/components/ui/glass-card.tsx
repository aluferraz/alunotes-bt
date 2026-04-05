import * as React from "react"
import { cn } from "~/lib/utils"

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "frosted" | "fluted" | "crystal"
}

const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-[1.5rem] border border-border text-card-foreground shadow-sm",
        variant === "default" && "glass-bg",
        variant === "frosted" && "glass-frosted",
        variant === "fluted" && "glass-fluted",
        variant === "crystal" && "glass-crystal",
        className
      )}
      {...props}
    />
  )
)
GlassCard.displayName = "GlassCard"

export { GlassCard }
