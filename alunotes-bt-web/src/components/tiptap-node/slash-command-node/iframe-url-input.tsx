"use client"

import {
  forwardRef,
  useImperativeHandle,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react"
import type { SuggestionKeyDownProps } from "@tiptap/suggestion"
import type { Editor, Range } from "@tiptap/core"
import { Globe } from "lucide-react"
import "~/components/tiptap-node/slash-command-node/slash-command.scss"

export interface IframeUrlInputRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

interface IframeUrlInputProps {
  editor: Editor
  range: Range
  onClose: () => void
}

/** Parse an <iframe> HTML string into src/width/height */
function parseIframeTag(input: string): { src: string; width?: string; height?: string } | null {
  const match = input.match(/<iframe\s[^>]*>/i)
  if (!match) return null

  const tag = match[0]
  const srcMatch = tag.match(/src=["']([^"']+)["']/i)
  if (!srcMatch?.[1]) return null

  const widthMatch = tag.match(/width=["']([^"']+)["']/i)
  const heightMatch = tag.match(/height=["']([^"']+)["']/i)
  const w = widthMatch?.[1]
  const h = heightMatch?.[1]

  return {
    src: srcMatch[1],
    width: w ? (/^\d+$/.test(w) ? `${w}px` : w) : undefined,
    height: h ? (/^\d+$/.test(h) ? `${h}px` : h) : undefined,
  }
}

export const IframeUrlInput = forwardRef<IframeUrlInputRef, IframeUrlInputProps>(
  ({ editor, range, onClose }, ref) => {
    const [value, setValue] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
      inputRef.current?.focus()
    }, [])

    const submit = useCallback(() => {
      const trimmed = value.trim()
      if (!trimmed) return

      // Try parsing as <iframe> tag first
      const parsed = parseIframeTag(trimmed)
      if (parsed) {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setIframe({
            src: parsed.src,
            width: parsed.width ?? "100%",
            height: parsed.height ?? "400px",
          })
          .run()
        onClose()
        return
      }

      // Otherwise treat as a plain URL
      let src = trimmed
      if (!/^https?:\/\//i.test(src)) {
        src = `https://${src}`
      }

      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setIframe({ src, width: "100%", height: "400px" })
        .run()
      onClose()
    }, [value, editor, range, onClose])

    // Handle Enter directly on the input — don't rely on the suggestion keyDown chain
    const handleInputKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault()
          e.stopPropagation()
          submit()
        } else if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        } else {
          // Prevent editor from capturing typing
          e.stopPropagation()
        }
      },
      [submit, onClose]
    )

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === "Enter") {
          submit()
          return true
        }
        if (event.key === "Escape") {
          onClose()
          return true
        }
        return false
      },
    }))

    return (
      <div className="slash-command-list">
        <div className="slash-command-header">Embed website</div>
        <div className="slash-command-filter">
          <Globe className="slash-command-filter-icon" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Paste URL or <iframe> tag..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="slash-command-filter-input"
            onKeyDown={handleInputKeyDown}
          />
        </div>
      </div>
    )
  }
)

IframeUrlInput.displayName = "IframeUrlInput"
