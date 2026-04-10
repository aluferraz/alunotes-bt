"use client"

import { useCallback, useRef, useState } from "react"
import type { NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper } from "@tiptap/react"
import { Skeleton } from "~/components/ui/skeleton"
import { ExternalLink } from "lucide-react"
import "~/components/tiptap-node/iframe-node/iframe-node.scss"

/** Only allow relative paths (same-site) — block any absolute URLs to external sites */
function isSameOriginSrc(src: string): boolean {
  if (!src) return false
  if (src.startsWith("/")) return true
  try {
    const url = new URL(src, window.location.origin)
    return url.origin === window.location.origin
  } catch {
    return false
  }
}

export const IframeNodeComponent: React.FC<NodeViewProps> = (props) => {
  const { src, width, height } = props.node.attrs as {
    src: string
    width: string
    height: string
  }

  const [currentHeight, setCurrentHeight] = useState(parseInt(height) || 400)
  const [isResizing, setIsResizing] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const startYRef = useRef(0)
  const startHeightRef = useRef(0)
  const heightRef = useRef(currentHeight)

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsResizing(true)
      startYRef.current = e.clientY
      startHeightRef.current = currentHeight

      const handleMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientY - startYRef.current
        const newHeight = Math.max(200, startHeightRef.current + delta)
        heightRef.current = newHeight
        setCurrentHeight(newHeight)
      }

      const handleUp = () => {
        setIsResizing(false)
        document.removeEventListener("mousemove", handleMove)
        document.removeEventListener("mouseup", handleUp)
        props.updateAttributes({ height: `${heightRef.current}px` })
      }

      document.addEventListener("mousemove", handleMove)
      document.addEventListener("mouseup", handleUp)
    },
    [currentHeight, props]
  )

  // Extract board ID from embed src like /embed/whiteboard/{id}?locked
  const editHref = src.match(/\/embed\/whiteboard\/([^?]+)/)?.[1]
    ? `/whiteboard/${src.match(/\/embed\/whiteboard\/([^?]+)/)![1]}`
    : null

  return (
    <NodeViewWrapper className="tiptap-iframe-wrapper" data-drag-handle>
      {editHref && (
        <a
          href={editHref}
          className="tiptap-iframe-edit-link"
          contentEditable={false}
          target="_blank"
        >
          Edit Whiteboard
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
      <div
        className={`tiptap-iframe-container ${isResizing ? "is-resizing" : ""}`}
        style={{ width, height: `${currentHeight}px` }}
      >
        {isSameOriginSrc(src) ? (
          <>
            {!isLoaded && (
              <div className="absolute inset-0 flex flex-col gap-4 p-4 rounded-[inherit]">
                <div className="flex gap-2">
                  <Skeleton className="h-7 w-[120px]" />
                  <Skeleton className="h-7 w-16" />
                </div>
                <div className="flex-1 flex items-center justify-center gap-6">
                  <Skeleton className="h-20 w-[100px] rounded-lg" />
                  <Skeleton className="h-[72px] w-[72px] rounded-full" />
                </div>
              </div>
            )}
            <iframe
              src={src}
              width="100%"
              height="100%"
              style={{
                border: "none",
                borderRadius: "inherit",
                background: "transparent",
                opacity: isLoaded ? 1 : 0,
                position: isLoaded ? "static" : "absolute",
              }}
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              referrerPolicy="same-origin"
              allow="clipboard-write"
              onLoad={() => setIsLoaded(true)}
            />
          </>
        ) : (
          <div className="tiptap-iframe-blocked">
            Blocked: only same-site embeds are allowed
          </div>
        )}
        {isResizing && <div className="tiptap-iframe-overlay" />}
      </div>
      <div className="tiptap-iframe-resize-handle" onMouseDown={handleResizeStart}>
        <div className="tiptap-iframe-resize-bar" />
      </div>
    </NodeViewWrapper>
  )
}
