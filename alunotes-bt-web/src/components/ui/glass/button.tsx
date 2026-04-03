"use client"

import * as React from "react"
import { Button as BaseButton } from "~/components/ui/button"
import { cn } from "~/lib/utils"
import { hoverEffects, type HoverEffect } from "~/lib/hover-effects"

export interface ButtonProps
  extends React.ComponentProps<typeof BaseButton> {
  effect?: HoverEffect
}

export const Button = React.forwardRef<
  HTMLButtonElement,
  ButtonProps
>(({ className, effect = "glow", variant = "default", ...props }, ref) => {
  return (
    <BaseButton
      ref={ref}
      variant={variant}
      className={cn(
        "relative overflow-hidden glass-bg",
        hoverEffects({ hover: effect }),
        className
      )}
      {...props}
    />
  )
})
Button.displayName = "Button"
