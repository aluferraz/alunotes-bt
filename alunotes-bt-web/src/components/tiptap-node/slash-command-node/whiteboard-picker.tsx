"use client"

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react"
import { useQuery } from "@tanstack/react-query"
import { orpc } from "~/orpc/react"
import type { SuggestionKeyDownProps } from "@tiptap/suggestion"
import type { Editor, Range } from "@tiptap/core"
import { Search } from "lucide-react"
import { Skeleton } from "~/components/ui/skeleton"
import "~/components/tiptap-node/slash-command-node/slash-command.scss"

export interface WhiteboardPickerRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

interface WhiteboardPickerProps {
  editor: Editor
  range: Range
  onClose: () => void
}

export const WhiteboardPicker = forwardRef<WhiteboardPickerRef, WhiteboardPickerProps>(
  ({ editor, range, onClose }, ref) => {
    const { data: boards, isLoading } = useQuery(orpc.whiteboard.list.queryOptions())
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [filter, setFilter] = useState("")
    const listRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    // Auto-focus the filter input
    useEffect(() => {
      inputRef.current?.focus()
    }, [])

    const filteredBoards = useMemo(() => {
      if (!boards) return []
      if (!filter) return boards
      const q = filter.toLowerCase()
      return boards.filter((b) =>
        (b.name || "Untitled").toLowerCase().includes(q)
      )
    }, [boards, filter])

    // Reset selection when filter changes
    useEffect(() => {
      setSelectedIndex(0)
    }, [filter])

    useEffect(() => {
      // +1 offset for the search input row
      const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | undefined
      el?.scrollIntoView({ block: "nearest" })
    }, [selectedIndex])

    const selectBoard = useCallback(
      (boardId: string) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setIframe({
            src: `/embed/whiteboard/${boardId}?locked`,
            width: "100%",
            height: "400px",
          })
          .run()
        onClose()
      },
      [editor, range, onClose]
    )

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((prev) => (prev - 1 + filteredBoards.length) % filteredBoards.length)
          return true
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((prev) => (prev + 1) % filteredBoards.length)
          return true
        }
        if (event.key === "Enter") {
          const board = filteredBoards[selectedIndex]
          if (board) selectBoard(board.id)
          return true
        }
        if (event.key === "Escape") {
          onClose()
          return true
        }
        // Let all other keys (including Backspace) go to the filter input
        return false
      },
    }))

    return (
      <div className="slash-command-list" ref={listRef}>
        <div className="slash-command-header">Embed whiteboard</div>

        <div className="slash-command-filter">
          <Search className="slash-command-filter-icon" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Filter whiteboards..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="slash-command-filter-input"
            onKeyDown={(e) => {
              // Let ArrowUp/Down/Enter/Escape bubble to the imperative handler
              if (["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(e.key)) return
              // Prevent the editor from capturing other keys
              e.stopPropagation()
            }}
          />
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-1 py-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        ) : filteredBoards.length === 0 ? (
          <div className="slash-command-empty">
            {filter ? "No matches" : "No whiteboards yet"}
          </div>
        ) : (
          filteredBoards.map((board, index) => (
            <button
              key={board.id}
              data-index={index}
              className={`slash-command-item ${index === selectedIndex ? "is-selected" : ""}`}
              onClick={() => selectBoard(board.id)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="slash-command-item-content">
                <span className="slash-command-item-title">{board.name || "Untitled"}</span>
              </div>
            </button>
          ))
        )}
      </div>
    )
  }
)

WhiteboardPicker.displayName = "WhiteboardPicker"
