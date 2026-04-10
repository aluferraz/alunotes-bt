"use client"

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
  useRef,
} from "react"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"
import type { SlashCommandItem } from "./slash-command-extension"
import "~/components/tiptap-node/slash-command-node/slash-command.scss"

export interface SlashCommandListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

export interface SlashCommandListProps extends SuggestionProps<SlashCommandItem> {
  onWhiteboardSubmenu?: (props: SuggestionProps<SlashCommandItem>) => void
}

export const SlashCommandList = forwardRef<SlashCommandListRef, SlashCommandListProps>(
  (props, ref) => {
    const { items, command } = props
    const [selectedIndex, setSelectedIndex] = useState(0)
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    // Scroll selected item into view
    useEffect(() => {
      const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
      el?.scrollIntoView({ block: "nearest" })
    }, [selectedIndex])

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index]
        if (!item) return

        if (item.hasSubmenu && props.onWhiteboardSubmenu) {
          props.onWhiteboardSubmenu(props)
          return
        }

        command(item)
      },
      [items, command, props]
    )

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((prev) => (prev - 1 + items.length) % items.length)
          return true
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((prev) => (prev + 1) % items.length)
          return true
        }
        if (event.key === "Enter") {
          selectItem(selectedIndex)
          return true
        }
        if (event.key === "Escape") {
          return true
        }
        return false
      },
    }))

    if (items.length === 0) {
      return (
        <div className="slash-command-list">
          <div className="slash-command-empty">No results</div>
        </div>
      )
    }

    return (
      <div className="slash-command-list" ref={listRef}>
        {items.map((item, index) => {
          const Icon = item.icon
          return (
            <button
              key={item.title}
              className={`slash-command-item ${index === selectedIndex ? "is-selected" : ""}`}
              onClick={() => selectItem(index)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="slash-command-item-icon">
                <Icon className="w-4 h-4" />
              </div>
              <div className="slash-command-item-content">
                <span className="slash-command-item-title">{item.title}</span>
                <span className="slash-command-item-description">{item.description}</span>
              </div>
            </button>
          )
        })}
      </div>
    )
  }
)

SlashCommandList.displayName = "SlashCommandList"
