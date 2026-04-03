"use client"

import * as React from "react"
import { Card as BaseCard, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card"
import { cn } from "~/lib/utils"
import { hoverEffects, type HoverEffect } from "~/lib/hover-effects"

export interface CardProps extends React.ComponentProps<typeof BaseCard> {
  gradient?: boolean
  animated?: boolean
  hover?: HoverEffect
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, gradient = false, animated = false, hover = "none", children, ...props }, ref) => {
    return (
      <BaseCard
        ref={ref}
        className={cn(
          "relative overflow-hidden glass-bg",
          gradient && "bg-gradient-to-br from-purple-500/10 via-blue-500/10 to-pink-500/10",
          animated && "transition-all duration-300 hover:scale-[1.02] hover:shadow-[var(--glass-shadow-lg)]",
          hoverEffects({ hover }),
          className
        )}
        {...props}
      >
        {children}
      </BaseCard>
    )
  }
)
Card.displayName = "Card"

export {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
}
