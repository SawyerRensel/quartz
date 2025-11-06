import { QuartzTransformerPlugin } from "../types"
import { Root, Blockquote, Paragraph, BlockContent, DefinitionContent, RootContent } from "mdast"
import { visit } from "unist-util-visit"
import { fromMarkdown } from "mdast-util-from-markdown"
import { gfm } from "micromark-extension-gfm"
import { gfmFromMarkdown } from "mdast-util-gfm"

export interface Options {
  // Enable rendering of markdown admonition blocks
  enableAdmonitions: boolean
}

const defaultOptions: Options = {
  enableAdmonitions: true,
}

/**
 * Parse an admonition code block
 * Format:
 * ```ad-note
 * title: Custom Title
 * collapse: open
 *
 * Content goes here
 * ```
 */
function parseAdmonitionCodeBlock(
  lang: string,
  content: string,
): {
  type: string
  title?: string
  collapse?: "open" | "closed"
  body: string
} | null {
  // Check if language starts with 'ad-'
  if (!lang.startsWith("ad-")) {
    return null
  }

  const type = lang.substring(3) // Remove 'ad-' prefix
  const lines = content.split("\n")
  const metadata: Record<string, string> = {}
  let contentStartIndex = 0

  // Parse metadata lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) {
      contentStartIndex = i + 1
      break
    }

    const colonIndex = line.indexOf(":")
    if (colonIndex === -1) {
      // No more metadata
      contentStartIndex = i
      break
    }

    const key = line.substring(0, colonIndex).trim().toLowerCase()
    const value = line.substring(colonIndex + 1).trim()
    metadata[key] = value
  }

  const body = lines.slice(contentStartIndex).join("\n").trim()

  let collapse: "open" | "closed" | undefined = undefined
  if (metadata.collapse) {
    collapse = metadata.collapse.toLowerCase() === "open" ? "open" : "closed"
  }

  return {
    type,
    title: metadata.title,
    collapse,
    body,
  }
}

/**
 * Obsidian Admonitions Transformer
 *
 * Converts Obsidian-style admonition code blocks (```ad-type) into
 * Obsidian-style blockquote callouts that Quartz's OFM plugin already handles.
 *
 * The key insight is to use raw HTML for the callout directive line,
 * then let the markdown parser handle the body content normally.
 */
export const Admonitions: QuartzTransformerPlugin<Partial<Options>> = (userOpts) => {
  const opts = { ...defaultOptions, ...userOpts }

  return {
    name: "Admonitions",
    markdownPlugins() {
      if (!opts.enableAdmonitions) return []

      return [
        () => {
          return (tree: Root, _file) => {
            visit(tree, "code", (node, index, parent) => {
              // Check if this is an admonition code block (ad-*)
              if (node.lang && node.lang.startsWith("ad-")) {
                const parsed = parseAdmonitionCodeBlock(node.lang, node.value)
                if (!parsed) return

                // Determine collapse character
                let collapseChar = ""
                if (parsed.collapse === "open") {
                  collapseChar = "+"
                } else if (parsed.collapse === "closed") {
                  collapseChar = "-"
                }

                // Build the callout directive
                const titleText = parsed.title || ""
                const calloutDirective = `[!${parsed.type}]${collapseChar}${titleText ? " " + titleText : ""}`

                // Convert body markdown to AST nodes
                // We need to parse the body as markdown so ALL markdown syntax works
                // This includes: headings, lists, checkboxes, code blocks, tables, etc.
                let bodyNodes: RootContent[] = []
                if (parsed.body) {
                  try {
                    // Parse the body as markdown with GFM support (includes task lists/checkboxes)
                    const bodyAst = fromMarkdown(parsed.body, {
                      extensions: [gfm()],
                      mdastExtensions: [gfmFromMarkdown()],
                    })
                    // Extract ALL children (not just paragraphs!)
                    // This includes headings, lists, code blocks, checkboxes, etc.
                    bodyNodes = bodyAst.children
                  } catch (e) {
                    // If parsing fails, fall back to plain text
                    bodyNodes = [
                      {
                        type: "paragraph",
                        children: [
                          {
                            type: "text",
                            value: parsed.body,
                          },
                        ],
                      },
                    ]
                  }
                }

                // Create the first paragraph with just the callout directive
                const titleParagraph: Paragraph = {
                  type: "paragraph",
                  children: [
                    {
                      type: "text",
                      value: calloutDirective,
                    },
                  ],
                }

                // Combine title and body
                // Filter to only include valid blockquote children
                const validChildren = bodyNodes.filter(
                  (node): node is BlockContent | DefinitionContent =>
                    node.type === "paragraph" ||
                    node.type === "heading" ||
                    node.type === "list" ||
                    node.type === "code" ||
                    node.type === "blockquote" ||
                    node.type === "html" ||
                    node.type === "table" ||
                    node.type === "thematicBreak" ||
                    node.type === "definition" ||
                    node.type === "footnoteDefinition",
                )

                const children: Array<BlockContent | DefinitionContent> = [
                  titleParagraph,
                  ...validChildren,
                ]

                // Create a blockquote node
                const blockquote: Blockquote = {
                  type: "blockquote",
                  children,
                }

                // Replace the code block with the blockquote
                if (parent && index !== undefined) {
                  parent.children[index] = blockquote
                }
              }
            })
          }
        },
      ]
    },
  }
}
