import { QuartzTransformerPlugin } from "../types"
import { Root, Code, Paragraph } from "mdast"
import { visit } from "unist-util-visit"
import { fromMarkdown } from "mdast-util-from-markdown"
import { gfm } from "micromark-extension-gfm"
import { gfmFromMarkdown } from "mdast-util-gfm"
import path from "path"

export interface Options {
  // Enable rendering of dataview queries
  enableDataview: boolean
}

const defaultOptions: Options = {
  enableDataview: true,
}

interface DataviewQuery {
  type: "TABLE" | "LIST" | "TASK" | "CALENDAR"
  fields: string[]
  from: string
  where?: string
  sort?: string
  limit?: number
  withoutId: boolean
}

interface FileMetadata {
  file: {
    name: string
    path: string
    folder: string
    link: string
    size: number
    ctime: Date | null
    mtime: Date | null
    cday: Date | null
    mday: Date | null
    tags: string[]
  }
  frontmatter: Record<string, any>
  [key: string]: any
}

/**
 * Smart split by comma that respects parentheses, brackets, and quotes
 * e.g., 'link(file.link, " ") + title, other AS Name' -> ['link(file.link, " ") + title', 'other AS Name']
 */
function smartSplit(str: string): string[] {
  const result: string[] = []
  let current = ""
  let depth = 0 // Track parentheses depth
  let inQuotes = false
  let quoteChar = ""

  for (let i = 0; i < str.length; i++) {
    const char = str[i]

    if ((char === '"' || char === "'") && (i === 0 || str[i - 1] !== "\\")) {
      if (!inQuotes) {
        inQuotes = true
        quoteChar = char
      } else if (char === quoteChar) {
        inQuotes = false
        quoteChar = ""
      }
      current += char
    } else if (!inQuotes && char === "(") {
      depth++
      current += char
    } else if (!inQuotes && char === ")") {
      depth--
      current += char
    } else if (!inQuotes && char === "," && depth === 0) {
      if (current.trim()) {
        result.push(current.trim())
      }
      current = ""
    } else {
      current += char
    }
  }

  if (current.trim()) {
    result.push(current.trim())
  }

  return result
}

/**
 * Parse a dataview query string into a structured format
 */
function parseDataviewQuery(query: string): DataviewQuery | null {
  const lines = query.trim().split("\n")
  if (lines.length === 0) return null

  const firstLine = lines[0].trim()
  let queryType: DataviewQuery["type"]
  let withoutId = false
  let fields: string[] = []

  // Parse query type and fields
  if (firstLine.startsWith("TABLE")) {
    queryType = "TABLE"
    const tableMatch = firstLine.match(/^TABLE\s+(WITHOUT\s+ID\s+)?(.*)$/i)
    if (tableMatch) {
      withoutId = !!tableMatch[1]
      const fieldsStr = tableMatch[2].trim()
      if (fieldsStr) {
        // Smart split by comma - respect parentheses and quotes
        fields = smartSplit(fieldsStr)
      }
    }
  } else if (firstLine.startsWith("LIST")) {
    queryType = "LIST"
    const listMatch = firstLine.match(/^LIST\s+(.*)$/i)
    if (listMatch && listMatch[1].trim()) {
      fields = smartSplit(listMatch[1].trim())
    }
  } else if (firstLine.startsWith("TASK")) {
    queryType = "TASK"
  } else if (firstLine.startsWith("CALENDAR")) {
    queryType = "CALENDAR"
  } else {
    return null
  }

  const result: DataviewQuery = {
    type: queryType,
    fields,
    from: "",
    withoutId,
  }

  // Parse additional clauses
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const fromMatch = line.match(/^FROM\s+(.+)$/i)
    if (fromMatch) {
      result.from = fromMatch[1].trim()
      continue
    }

    const whereMatch = line.match(/^WHERE\s+(.+)$/i)
    if (whereMatch) {
      result.where = whereMatch[1].trim()
      continue
    }

    const sortMatch = line.match(/^SORT\s+(.+)$/i)
    if (sortMatch) {
      result.sort = sortMatch[1].trim()
      continue
    }

    const limitMatch = line.match(/^LIMIT\s+(\d+)$/i)
    if (limitMatch) {
      result.limit = parseInt(limitMatch[1])
      continue
    }
  }

  return result
}

/**
 * Extract field name and alias from a field definition
 * e.g., "file.name AS Name" -> { field: "file.name", alias: "Name" }
 * e.g., 'link(file.link, " ") + "<strong>" + title + "</strong>" AS Entries' -> {expression: ..., alias: "Entries"}
 */
function parseField(fieldDef: string): { expression: string; alias: string } {
  const asMatch = fieldDef.match(/^(.+?)\s+AS\s+"?([^"]+)"?$/i)
  if (asMatch) {
    return { expression: asMatch[1].trim(), alias: asMatch[2].trim() }
  }
  return { expression: fieldDef.trim(), alias: fieldDef.trim() }
}

/**
 * Evaluate a dataview expression against a file's metadata
 * Supports:
 * - Field access: file.name, file.link, title, summary, etc.
 * - Functions: link(file.link, "text")
 * - String concatenation: "text" + field + "more"
 * - HTML tags in strings: "<strong>text</strong>"
 */
function evaluateExpression(expr: string, file: FileMetadata): string {
  try {
    // Now evaluate the expression with string concatenation
    // Split by + operator but respect quoted strings and function calls
    const parts: string[] = []
    let current = ""
    let inQuotes = false
    let quoteChar = ""
    let depth = 0 // Track parentheses for functions

    for (let i = 0; i < expr.length; i++) {
      const char = expr[i]

      if ((char === '"' || char === "'") && (i === 0 || expr[i - 1] !== "\\")) {
        if (!inQuotes) {
          inQuotes = true
          quoteChar = char
        } else if (char === quoteChar) {
          inQuotes = false
          quoteChar = ""
        }
        current += char
      } else if (!inQuotes && char === "(") {
        depth++
        current += char
      } else if (!inQuotes && char === ")") {
        depth--
        current += char
      } else if (char === "+" && !inQuotes && depth === 0) {
        if (current.trim()) {
          parts.push(current.trim())
        }
        current = ""
      } else {
        current += char
      }
    }
    if (current.trim()) {
      parts.push(current.trim())
    }

    // Evaluate each part and concatenate
    const evaluated = parts.map((part) => {
      // Handle link() function: link(file.link, "display text")
      const linkMatch = part.match(/^link\(([^,]+),\s*"([^"]*)"\)$/i)
      if (linkMatch) {
        const linkValue = evaluateSimpleExpression(linkMatch[1].trim(), file)
        const displayText = linkMatch[2]
        // link() with empty display text returns empty string (Obsidian behavior)
        if (!displayText.trim()) {
          return ""
        }
        // For non-empty display text, return just the display text
        // We can't create clickable links in markdown tables easily
        return displayText
      }

      // String literal
      if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
        return part.slice(1, -1)
      }

      // Field reference
      return evaluateSimpleExpression(part, file)
    })

    return evaluated.join("")
  } catch (e) {
    // If evaluation fails, return empty string
    return ""
  }
}

/**
 * Evaluate a simple field reference
 */
function evaluateSimpleExpression(expr: string, file: FileMetadata): string {
  const trimmedExpr = expr.trim()
  const value = getValue(file, trimmedExpr)

  // If this is a file.link or file.path reference, convert to an HTML anchor tag
  // We use HTML instead of wikilinks because these expressions often contain HTML tags
  if (trimmedExpr === "file.link" || trimmedExpr === "file.path") {
    const linkPath = String(value)
    const displayName = file.file.name
    // Convert path to URL-friendly format (add leading slash if needed)
    const href = linkPath.startsWith('/') ? linkPath : `/${linkPath}`
    return `<a href="${href}" class="internal">${displayName}</a>`
  }

  // Just return the formatted value
  return formatValue(value)
}

/**
 * Get a value from an object using dot notation
 * e.g., getValue(obj, "file.name") returns obj.file.name
 */
function getValue(obj: any, path: string): any {
  const parts = path.split(".")
  let current = obj
  for (const part of parts) {
    if (current == null) return undefined
    current = current[part]
  }
  return current
}

/**
 * Format a value for display in a table/list
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return ""
  }
  if (value instanceof Date) {
    return value.toLocaleDateString()
  }
  if (Array.isArray(value)) {
    return value.join(", ")
  }
  if (typeof value === "object") {
    return JSON.stringify(value)
  }
  return String(value)
}

/**
 * Execute a dataview query against the collected metadata
 */
function executeQuery(query: DataviewQuery, allFiles: Map<string, FileMetadata>): FileMetadata[] {
  let results: FileMetadata[] = Array.from(allFiles.values())

  // Apply FROM filter
  if (query.from) {
    const fromSource = query.from.replace(/['"]/g, "").trim()

    if (fromSource.startsWith("#")) {
      // Tag filter
      const tag = fromSource.substring(1)
      results = results.filter((file) => file.file.tags.includes(tag))
    } else {
      // Folder filter
      const folder = fromSource.replace(/^\//, "").replace(/\/$/, "")
      results = results.filter((file) => {
        const filePath = file.file.folder
        return filePath.startsWith(folder) || filePath === folder || folder === ""
      })
    }
  }

  // Apply WHERE filter (basic implementation)
  if (query.where) {
    // Simple WHERE implementation - supports basic expressions
    results = results.filter((file) => {
      try {
        // Very basic evaluation - just check if field exists
        if (query.where!.includes("file.tags")) {
          return file.file.tags && file.file.tags.length > 0
        }
        // Add more WHERE clause support as needed
        return true
      } catch (e) {
        return true
      }
    })
  }

  // Apply SORT
  if (query.sort) {
    const sortParts = query.sort.split(/\s+/)
    const sortField = sortParts[0]
    const sortOrder = sortParts[1]?.toUpperCase() === "DESC" ? -1 : 1

    results.sort((a, b) => {
      const aVal = getValue(a, sortField)
      const bVal = getValue(b, sortField)

      if (aVal === bVal) return 0
      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1

      if (aVal < bVal) return -sortOrder
      if (aVal > bVal) return sortOrder
      return 0
    })
  }

  // Apply LIMIT
  if (query.limit) {
    results = results.slice(0, query.limit)
  }

  return results
}

/**
 * Generate markdown table from query results
 */
function generateMarkdownTable(query: DataviewQuery, results: FileMetadata[]): string {
  if (results.length === 0) {
    return "*No results found*"
  }

  const headers: string[] = []
  const fieldDefs: Array<{ expression: string; alias: string }> = []

  // Add file/page column if not WITHOUT ID
  if (!query.withoutId) {
    headers.push("File")
    fieldDefs.push({ expression: "file.name", alias: "File" })
  }

  // Add field columns
  query.fields.forEach((field) => {
    const parsed = parseField(field)
    headers.push(parsed.alias)
    fieldDefs.push(parsed)
  })

  // Build markdown table
  let markdown = "| " + headers.join(" | ") + " |\n"
  markdown += "| " + headers.map(() => "---").join(" | ") + " |\n"

  // Add rows
  results.forEach((file) => {
    const row: string[] = []

    fieldDefs.forEach((fieldDef) => {
      if (fieldDef.expression === "file.name" && !query.withoutId) {
        // Create an HTML link to the file
        const linkPath = file.file.link
        const href = linkPath.startsWith('/') ? linkPath : `/${linkPath}`
        row.push(`<a href="${href}" class="internal">${file.file.name}</a>`)
      } else {
        // Evaluate the expression
        const value = evaluateExpression(fieldDef.expression, file)
        row.push(value)
      }
    })

    markdown += "| " + row.join(" | ") + " |\n"
  })

  return markdown
}

/**
 * Generate markdown list from query results
 */
function generateMarkdownList(query: DataviewQuery, results: FileMetadata[]): string {
  if (results.length === 0) {
    return "*No results found*"
  }

  let markdown = ""

  results.forEach((file) => {
    const linkPath = file.file.link
    const href = linkPath.startsWith('/') ? linkPath : `/${linkPath}`
    const fileLink = `<a href="${href}" class="internal">${file.file.name}</a>`

    if (query.fields.length === 0) {
      // Simple list of file names
      markdown += `- ${fileLink}\n`
    } else {
      // List with custom fields
      const values = query.fields.map((field) => {
        const parsed = parseField(field)
        const value = evaluateExpression(parsed.expression, file)
        return `${parsed.alias}: ${value}`
      })
      markdown += `- ${fileLink} (${values.join(", ")})\n`
    }
  })

  return markdown
}

/**
 * Obsidian Dataview Transformer
 *
 * Executes Obsidian dataview queries at build time and replaces them with
 * generated markdown content (tables, lists, etc.)
 */
export const DataviewTables: QuartzTransformerPlugin<Partial<Options>> = (userOpts) => {
  const opts = { ...defaultOptions, ...userOpts }

  return {
    name: "DataviewTables",
    markdownPlugins() {
      if (!opts.enableDataview) return []

      // Collect metadata from all files
      const allFilesMetadata = new Map<string, FileMetadata>()

      return [
        // First pass: collect metadata from all files
        () => {
          return (_tree: Root, file) => {
            if (!file.data.slug) return

            const metadata: FileMetadata = {
              file: {
                name: file.data.frontmatter?.title || path.basename(file.path || "", ".md"),
                path: file.data.slug || "",
                folder: path.dirname(file.data.slug || ""),
                link: file.data.slug || "",
                size: 0,
                ctime: file.data.dates?.created ? new Date(file.data.dates.created) : null,
                mtime: file.data.dates?.modified ? new Date(file.data.dates.modified) : null,
                cday: file.data.dates?.created ? new Date(file.data.dates.created) : null,
                mday: file.data.dates?.modified ? new Date(file.data.dates.modified) : null,
                tags: file.data.frontmatter?.tags || [],
              },
              frontmatter: file.data.frontmatter || {},
            }

            // Add frontmatter fields to top level for easy access
            if (file.data.frontmatter) {
              Object.keys(file.data.frontmatter).forEach((key) => {
                if (!metadata[key]) {
                  metadata[key] = file.data.frontmatter![key]
                }
              })
            }

            allFilesMetadata.set(file.data.slug, metadata)
          }
        },
        // Second pass: execute dataview queries
        () => {
          return (tree: Root, _file) => {
            visit(tree, "code", (node: Code, index, parent) => {
              if (node.lang === "dataview") {
                const query = parseDataviewQuery(node.value)
                if (!query) {
                  return
                }

                // Execute the query
                const results = executeQuery(query, allFilesMetadata)

                // Generate markdown based on query type
                let markdown = ""
                if (query.type === "TABLE") {
                  markdown = generateMarkdownTable(query, results)
                } else if (query.type === "LIST") {
                  markdown = generateMarkdownList(query, results)
                } else {
                  // TASK and CALENDAR not yet implemented
                  markdown = `*${query.type} queries are not yet supported*`
                }

                // Parse the generated markdown into AST nodes
                try {
                  const markdownAst = fromMarkdown(markdown, {
                    extensions: [gfm()],
                    mdastExtensions: [gfmFromMarkdown()],
                  })

                  // Replace the code block with the generated markdown nodes
                  if (parent && index !== undefined) {
                    parent.children.splice(index, 1, ...markdownAst.children)
                  }
                } catch (e) {
                  // If parsing fails, replace with error message
                  if (parent && index !== undefined) {
                    const errorNode: Paragraph = {
                      type: "paragraph",
                      children: [
                        {
                          type: "text",
                          value: `Error rendering dataview query: ${e}`,
                        },
                      ],
                    }
                    parent.children[index] = errorNode
                  }
                }
              } else if (node.lang === "dataviewjs") {
                // DataviewJS not supported - replace with message
                if (parent && index !== undefined) {
                  const messageNode: Paragraph = {
                    type: "paragraph",
                    children: [
                      {
                        type: "emphasis",
                        children: [
                          {
                            type: "text",
                            value: "DataviewJS queries are not supported in static site generation.",
                          },
                        ],
                      },
                    ],
                  }
                  parent.children[index] = messageNode
                }
              }
            })
          }
        },
      ]
    },
  }
}
