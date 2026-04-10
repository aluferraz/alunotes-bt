import { Extension } from "@tiptap/core"
import { Suggestion } from "@tiptap/suggestion"
import { PluginKey } from "@tiptap/pm/state"
import type { SuggestionOptions } from "@tiptap/suggestion"

export const SlashCommandPluginKey = new PluginKey("slash-command")

export interface SlashCommandItem {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  command: (props: { editor: import("@tiptap/core").Editor; range: import("@tiptap/core").Range }) => void
  /** If set, opens a sub-menu instead of running command immediately */
  submenuId?: "whiteboard" | "iframe-url"
}

export const SlashCommand = Extension.create<{
  suggestion: Partial<SuggestionOptions<SlashCommandItem>>
}>({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        pluginKey: SlashCommandPluginKey,
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        ...this.options.suggestion,
        char: "/",
        pluginKey: SlashCommandPluginKey,
        allowToIncludeChar: false,
      }),
    ]
  },
})
