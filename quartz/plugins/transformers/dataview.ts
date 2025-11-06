import { QuartzTransformerPlugin } from "../types"
import { Root } from "mdast"
import { visit } from "unist-util-visit"

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
    const tableMatch = firstLine.match(/^TABLE\s+(WITHOUT\s+ID\s+)?(.*)$/)
    if (tableMatch) {
      withoutId = !!tableMatch[1]
      const fieldsStr = tableMatch[2].trim()
      if (fieldsStr) {
        fields = fieldsStr.split(",").map((f) => f.trim())
      }
    }
  } else if (firstLine.startsWith("LIST")) {
    queryType = "LIST"
    const listMatch = firstLine.match(/^LIST\s+(.*)$/)
    if (listMatch && listMatch[1].trim()) {
      fields = listMatch[1].split(",").map((f) => f.trim())
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
 */
function parseField(fieldDef: string): { field: string; alias: string } {
  const asMatch = fieldDef.match(/^(.+?)\s+AS\s+"?([^"]+)"?$/i)
  if (asMatch) {
    return { field: asMatch[1].trim(), alias: asMatch[2].trim() }
  }
  return { field: fieldDef.trim(), alias: fieldDef.trim() }
}

/**
 * Convert a dataview query to an HTML table placeholder
 * Note: This is a static conversion. Actual data will need to be populated
 * at build time or runtime with access to the file metadata.
 */
function renderDataviewTable(query: DataviewQuery): string {
  const headers: string[] = []

  // Add file/page column if not WITHOUT ID
  if (!query.withoutId) {
    headers.push("File")
  }

  // Add field columns
  query.fields.forEach((field) => {
    const { alias } = parseField(field)
    headers.push(alias)
  })

  // Build table HTML
  let html = '<div class="dataview-container">\n'
  html += '  <blockquote class="dataview dataview-note">\n'
  html += "    <p><strong>Dataview Query</strong></p>\n"
  html += `    <p>This is a Dataview query that cannot be fully rendered in static output.</p>\n`
  html += "    <details>\n"
  html += "      <summary>View Query</summary>\n"
  html += "      <pre><code>"

  // Add the query
  html += `${query.type}`
  if (query.withoutId) html += " WITHOUT ID"
  if (query.fields.length > 0) html += ` ${query.fields.join(", ")}`
  html += "\n"
  if (query.from) html += `FROM ${query.from}\n`
  if (query.where) html += `WHERE ${query.where}\n`
  if (query.sort) html += `SORT ${query.sort}\n`
  if (query.limit) html += `LIMIT ${query.limit}\n`

  html += "</code></pre>\n"
  html += "    </details>\n"

  // Add a basic table structure
  if (query.type === "TABLE" && headers.length > 0) {
    html += '    <table class="dataview-table">\n'
    html += "      <thead>\n"
    html += "        <tr>\n"
    headers.forEach((header) => {
      html += `          <th>${header}</th>\n`
    })
    html += "        </tr>\n"
    html += "      </thead>\n"
    html += "      <tbody>\n"
    html += '        <tr><td colspan="' + headers.length + '">'
    html += "<em>No data available (static site generation)</em>"
    html += "</td></tr>\n"
    html += "      </tbody>\n"
    html += "    </table>\n"
  }

  html += "  </blockquote>\n"
  html += "</div>\n"

  return html
}

/**
 * Obsidian Dataview Transformer
 *
 * Converts Obsidian dataview code blocks into HTML representations.
 * Note: Full dataview functionality requires access to file metadata at build time.
 * This transformer provides a basic conversion showing the query structure.
 */
export const DataviewTables: QuartzTransformerPlugin<Partial<Options>> = (userOpts) => {
  const opts = { ...defaultOptions, ...userOpts }

  return {
    name: "DataviewTables",
    markdownPlugins() {
      if (!opts.enableDataview) return []

      return [
        () => {
          return (tree: Root, _file) => {
            visit(tree, "code", (node, index, parent) => {
              // Check if this is a dataview code block
              if (node.lang === "dataview" || node.lang === "dataviewjs") {
                if (node.lang === "dataviewjs") {
                  // For dataviewjs, just show a note that it's not supported
                  const html = `<div class="dataview-container">
  <blockquote class="dataview dataview-error">
    <p><strong>DataviewJS Query</strong></p>
    <p>DataviewJS queries are not supported in static site generation.</p>
    <details>
      <summary>View Query</summary>
      <pre><code>${node.value}</code></pre>
    </details>
  </blockquote>
</div>`

                  // Replace the code block with HTML
                  if (parent && index !== undefined) {
                    parent.children[index] = {
                      type: "html",
                      value: html,
                    }
                  }
                  return
                }

                // Parse the dataview query
                const query = parseDataviewQuery(node.value)
                if (!query) {
                  // If parsing fails, leave the code block as-is
                  return
                }

                // Convert to HTML
                const html = renderDataviewTable(query)

                // Replace the code block with HTML
                if (parent && index !== undefined) {
                  parent.children[index] = {
                    type: "html",
                    value: html,
                  }
                }
              }
            })
          }
        },
      ]
    },
    externalResources() {
      return {
        css: [
          {
            content: `
/* Dataview Styles */
.dataview-container {
  margin: 1.5rem 0;
}

.dataview {
  border-left: 0.2rem solid #448aff;
  border-radius: 0.2rem;
  padding: 1rem;
  background-color: rgba(68, 138, 255, 0.1);
  margin: 0;
}

.dataview-note {
  border-left-color: #00b8d4;
  background-color: rgba(0, 184, 212, 0.1);
}

.dataview-error {
  border-left-color: #db4242;
  background-color: rgba(219, 66, 66, 0.1);
}

.dataview p {
  margin: 0.5rem 0;
}

.dataview p:first-child {
  margin-top: 0;
}

.dataview p:last-child {
  margin-bottom: 0;
}

.dataview details {
  margin-top: 1rem;
}

.dataview summary {
  cursor: pointer;
  font-weight: 600;
  padding: 0.5rem;
  background-color: rgba(0, 0, 0, 0.05);
  border-radius: 0.2rem;
  user-select: none;
}

.dataview summary:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

.dataview pre {
  margin: 0.5rem 0 0 0;
  padding: 0.8rem;
  background-color: rgba(0, 0, 0, 0.05);
  border-radius: 0.2rem;
  overflow-x: auto;
}

.dataview code {
  font-family: var(--codeFont, 'Source Code Pro', monospace);
  font-size: 0.9em;
}

.dataview-table {
  width: 100%;
  margin-top: 1rem;
  border-collapse: collapse;
  border: 1px solid var(--lightgray);
}

.dataview-table th,
.dataview-table td {
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--lightgray);
  text-align: left;
}

.dataview-table th {
  background-color: rgba(0, 0, 0, 0.05);
  font-weight: 600;
  color: var(--dark);
}

.dataview-table tbody tr:nth-child(even) {
  background-color: rgba(0, 0, 0, 0.02);
}

.dataview-table tbody tr:hover {
  background-color: rgba(68, 138, 255, 0.1);
}

.dataview-table em {
  color: var(--gray);
  font-style: italic;
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  .dataview summary:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  .dataview pre {
    background-color: rgba(255, 255, 255, 0.05);
  }

  .dataview-table th {
    background-color: rgba(255, 255, 255, 0.05);
    color: var(--light);
  }

  .dataview-table tbody tr:nth-child(even) {
    background-color: rgba(255, 255, 255, 0.02);
  }
}
`,
          },
        ],
      }
    },
  }
}
