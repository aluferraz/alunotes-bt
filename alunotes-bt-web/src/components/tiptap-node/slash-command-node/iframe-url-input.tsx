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

export const IframeUrlInput = forwardRef<IframeUrlInputRef, IframeUrlInputProps>(
  ({ editor, range, onClose }, ref) => {
    const [url, setUrl] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
      inputRef.current?.focus()
    }, [])

    const submit = useCallback(() => {
      let src = url.trim()
      if (!src) return

      // Auto-add https:// if no protocol
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
    }, [url, editor, range, onClose])

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
            placeholder="Paste URL and press Enter..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="slash-command-filter-input"
            onKeyDown={(e) => {
              if (["Enter", "Escape"].includes(e.key)) return
              e.stopPropagation()
            }}
          />
        </div>
      </div>
    )
  }
)

IframeUrlInput.displayName = "IframeUrlInput"
