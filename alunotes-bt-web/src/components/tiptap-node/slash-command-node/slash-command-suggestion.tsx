"use client"

import { createRoot } from "react-dom/client"
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"
import type { SlashCommandItem } from "./slash-command-extension"
import { SlashCommandList, type SlashCommandListRef } from "./slash-command-list"
import { WhiteboardPicker, type WhiteboardPickerRef } from "./whiteboard-picker"
import { ORPCReactProvider } from "~/orpc/react"
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code,
  Minus,
  ImagePlus,
  PenTool,
  Bold,
  Italic,
  Strikethrough,
} from "lucide-react"

function getSlashCommandItems({ query }: { query: string }): SlashCommandItem[] {
  const items: SlashCommandItem[] = [
    {
      title: "Heading 1",
      description: "Large heading",
      icon: Heading1,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
      },
    },
    {
      title: "Heading 2",
      description: "Medium heading",
      icon: Heading2,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
      },
    },
    {
      title: "Heading 3",
      description: "Small heading",
      icon: Heading3,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
      },
    },
    {
      title: "Bullet List",
      description: "Unordered list",
      icon: List,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run()
      },
    },
    {
      title: "Numbered List",
      description: "Ordered list",
      icon: ListOrdered,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run()
      },
    },
    {
      title: "Task List",
      description: "Checklist with checkboxes",
      icon: ListChecks,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run()
      },
    },
    {
      title: "Blockquote",
      description: "Quote block",
      icon: Quote,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setBlockquote().run()
      },
    },
    {
      title: "Code Block",
      description: "Fenced code block",
      icon: Code,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setCodeBlock().run()
      },
    },
    {
      title: "Horizontal Rule",
      description: "Divider line",
      icon: Minus,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run()
      },
    },
    {
      title: "Image",
      description: "Upload an image",
      icon: ImagePlus,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setImageUploadNode().run()
      },
    },
    {
      title: "Bold",
      description: "Bold text",
      icon: Bold,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBold().run()
      },
    },
    {
      title: "Italic",
      description: "Italic text",
      icon: Italic,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleItalic().run()
      },
    },
    {
      title: "Strikethrough",
      description: "Strikethrough text",
      icon: Strikethrough,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleStrike().run()
      },
    },
    {
      title: "Whiteboard",
      description: "Embed a whiteboard",
      icon: PenTool,
      hasSubmenu: true,
      command: () => {
        // handled by submenu
      },
    },
  ]

  if (!query) return items
  return items.filter((item) =>
    item.title.toLowerCase().includes(query.toLowerCase())
  )
}

export function createSlashCommandSuggestion(): Partial<SuggestionOptions<SlashCommandItem>> {
  return {
    items: ({ query }) => getSlashCommandItems({ query }),

    render: () => {
      let popup: HTMLDivElement | null = null
      let root: ReturnType<typeof createRoot> | null = null
      let listRef: SlashCommandListRef | null = null
      let pickerRef: WhiteboardPickerRef | null = null
      let mode: "commands" | "whiteboard" = "commands"
      let currentProps: SuggestionProps<SlashCommandItem> | null = null

      function createPopup(editor: import("@tiptap/core").Editor) {
        popup = document.createElement("div")
        popup.style.position = "absolute"
        popup.style.zIndex = "50"

        // Inherit the editor's theme scope so CSS vars match
        const themeEl = editor.view.dom.closest("[class*='editor-theme-']")
        if (themeEl) {
          const match = themeEl.className.match(/editor-theme-\w+/)
          if (match) popup.classList.add(match[0])
        }

        document.body.appendChild(popup)
        root = createRoot(popup)
      }

      function positionPopup(props: SuggestionProps<SlashCommandItem>) {
        if (!popup) return
        const rect = props.clientRect?.()
        if (!rect) return
        popup.style.left = `${rect.left}px`
        popup.style.top = `${rect.bottom + 4}px`
      }

      function renderCommands(props: SuggestionProps<SlashCommandItem>) {
        root?.render(
          <SlashCommandList
            {...props}
            ref={(r) => { listRef = r }}
            onWhiteboardSubmenu={(suggestionProps) => {
              mode = "whiteboard"
              renderWhiteboardPicker(suggestionProps)
            }}
          />
        )
      }

      function renderWhiteboardPicker(props: SuggestionProps<SlashCommandItem>) {
        pickerRef = null
        root?.render(
          <ORPCReactProvider>
            <WhiteboardPicker
              ref={(r) => { pickerRef = r }}
              editor={props.editor}
              range={props.range}
              onClose={() => {
                destroy()
              }}
            />
          </ORPCReactProvider>
        )
      }

      function destroy() {
        root?.unmount()
        popup?.remove()
        popup = null
        root = null
        listRef = null
        pickerRef = null
        mode = "commands"
        currentProps = null
      }

      return {
        onStart: (props) => {
          currentProps = props
          mode = "commands"
          createPopup(props.editor)
          positionPopup(props)
          renderCommands(props)
        },

        onUpdate: (props) => {
          currentProps = props
          positionPopup(props)
          if (mode === "commands") {
            renderCommands(props)
          }
          // In whiteboard mode, don't re-render — query changes shouldn't affect the picker
        },

        onKeyDown: (props) => {
          if (props.event.key === "Escape") {
            destroy()
            return true
          }
          if (mode === "whiteboard") {
            return pickerRef?.onKeyDown(props) ?? false
          }
          return listRef?.onKeyDown(props) ?? false
        },

        onExit: () => {
          // Only destroy if we're not in whiteboard submenu mode
          if (mode !== "whiteboard") {
            destroy()
          }
        },
      }
    },
  }
}
