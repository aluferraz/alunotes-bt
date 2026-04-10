import { mergeAttributes, Node } from "@tiptap/react"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { IframeNodeComponent } from "~/components/tiptap-node/iframe-node/iframe-node"

export interface IframeNodeOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    iframe: {
      setIframe: (options: { src: string; width?: string; height?: string }) => ReturnType
    }
  }
}

export const IframeNode = Node.create<IframeNodeOptions>({
  name: "iframe",

  group: "block",

  draggable: true,

  selectable: true,

  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      src: {
        default: null,
      },
      width: {
        default: "100%",
      },
      height: {
        default: "400px",
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="iframe"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "iframe" }, HTMLAttributes),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(IframeNodeComponent)
  },

  addCommands() {
    return {
      setIframe:
        (options) =>
        ({ commands }) => {
          // Block dangerous protocols
          if (/^(javascript|data):/i.test(options.src)) return false
          return commands.insertContent({
            type: this.name,
            attrs: options,
          })
        },
    }
  },
})

export default IframeNode
