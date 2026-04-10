"use client"

import { useState, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTiptapEditor } from "~/hooks/use-tiptap-editor"
import { Button } from "~/components/tiptap-ui-primitive/button"
import { orpc } from "~/orpc/react"
import { PenTool } from "lucide-react"

export function WhiteboardEmbedButton() {
  const { editor } = useTiptapEditor()
  const [isOpen, setIsOpen] = useState(false)
  const { data: boards } = useQuery({
    ...orpc.whiteboard.list.queryOptions(),
    enabled: isOpen,
  })

  const handleInsert = useCallback(
    (boardId: string) => {
      if (!editor) return
      editor.commands.setIframe({
        src: `/embed/whiteboard/${boardId}?locked`,
        width: "100%",
        height: "400px",
      })
      setIsOpen(false)
    },
    [editor]
  )

  if (!editor) return null

  return (
    <div style={{ position: "relative" }}>
      <Button
        type="button"
        variant="ghost"
        aria-label="Embed whiteboard"
        tooltip="Embed whiteboard"
        onClick={() => setIsOpen(!isOpen)}
      >
        <PenTool className="tiptap-button-icon" />
      </Button>

      {isOpen && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={() => setIsOpen(false)}
          />
          <div
            className="absolute top-full left-0 mt-1 z-50 w-64 max-h-64 overflow-y-auto rounded-xl border border-glass-border bg-glass-bg/95 backdrop-blur-xl shadow-glass-lg p-2"
          >
            {!boards?.length ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                No whiteboards found
              </div>
            ) : (
              boards.map((board) => (
                <button
                  key={board.id}
                  onClick={() => handleInsert(board.id)}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-foreground hover:bg-glass-border transition-colors truncate"
                >
                  {board.name || "Untitled"}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
