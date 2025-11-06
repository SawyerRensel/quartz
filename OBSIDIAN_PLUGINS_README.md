# Obsidian Dataview and Admonitions Support

This document describes the new Quartz plugins that add support for Obsidian dataview tables and admonitions.

## Overview

Two new transformer plugins have been added to Quartz:

1. **DataviewTables** - Converts Obsidian dataview code blocks into HTML
2. **Admonitions** - Converts Obsidian-style admonition code blocks into styled HTML

## Installation

The plugins are already configured in your `quartz.config.ts`. They are enabled by default:

```typescript
transformers: [
  Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
  Plugin.DataviewTables(),      // ← Dataview support
  Plugin.Admonitions(),          // ← Admonitions support
  Plugin.GitHubFlavoredMarkdown(),
  // ... other plugins
]
```

## Admonitions Plugin

The Admonitions plugin converts Obsidian Admonition plugin syntax (code blocks with `ad-` prefix) into Obsidian's native callout syntax, which is then rendered by Quartz's existing ObsidianFlavoredMarkdown plugin.

### How It Works

The plugin transforms this syntax:
```markdown
```ad-note
title: My Note
This is the content.
\`\`\`
```

Into Obsidian-style callouts:
```markdown
> [!note] My Note
> This is the content.
```

Which are then rendered as beautiful callout boxes by Quartz.

### Usage

Create admonitions using code blocks with the `ad-` prefix:

```markdown
```ad-note
This is a note admonition.
\`\`\`
```

### Supported Types

The following admonition types are supported:

| Type | Aliases | Color |
|------|---------|-------|
| `note` | `seealso` | Blue |
| `abstract` | `summary`, `tldr` | Cyan |
| `info` | `todo` | Blue |
| `tip` | `hint`, `important` | Cyan |
| `success` | `check`, `done` | Green |
| `question` | `help`, `faq` | Yellow |
| `warning` | `caution`, `attention` | Orange |
| `failure` | `fail`, `missing` | Red |
| `danger` | `error` | Red |
| `bug` | - | Red |
| `example` | - | Purple |
| `quote` | `cite` | Gray |

### Custom Titles

Add a custom title using the `title` parameter:

```markdown
```ad-tip
title: Pro Tip
This is a tip with a custom title!
\`\`\`
```

### Collapsible Admonitions

Make admonitions collapsible using the `collapse` parameter:

```markdown
```ad-info
title: Click to expand
collapse: closed
This content is hidden by default.
\`\`\`
```

Options:
- `collapse: open` - Starts expanded, can be collapsed
- `collapse: closed` - Starts collapsed, can be expanded

### Important Notes

- The Admonitions plugin **must** run before the ObsidianFlavoredMarkdown plugin in your config
- This is already configured correctly in `quartz.config.ts`
- The plugin converts `ad-` syntax to native Obsidian callouts, which are styled by Quartz's existing callout CSS
- All callout types supported by Obsidian are supported

## Dataview Plugin

### Usage

Create dataview queries using code blocks with the `dataview` language:

```markdown
```dataview
TABLE file.ctime, file.mtime
FROM "content"
SORT file.name
\`\`\`
```

### Supported Query Types

- **TABLE** - Display data in a table format
- **TABLE WITHOUT ID** - Table without the file name column
- **LIST** - Display as a list (recognized but not fully rendered)
- **TASK** - Display tasks (recognized but not fully rendered)

### Query Clauses

- `FROM` - Specify the source folder or tag
- `WHERE` - Filter results
- `SORT` - Sort results (with `ASC` or `DESC`)
- `LIMIT` - Limit number of results

### Custom Column Headers

Use `AS` to specify custom headers:

```markdown
```dataview
TABLE file.ctime AS "Created", file.mtime AS "Modified"
FROM "content"
\`\`\`
```

Wrap headers with spaces in double quotes:

```markdown
```dataview
TABLE file.tags AS "All Tags", file.size AS "File Size"
FROM "content"
\`\`\`
```

### Important Limitations

**Note**: The current dataview implementation is a **placeholder** that recognizes dataview syntax and displays the query structure, but does **not execute queries with actual data**. This is because:

1. Quartz is a static site generator
2. Dataview queries require runtime access to file metadata
3. Full implementation would require build-time query execution

To see the query structure, the plugin renders:
- A note box explaining the limitation
- The original query in a collapsible section
- A placeholder table structure (for TABLE queries)

### DataviewJS

DataviewJS queries (``` dataviewjs```) are detected but not supported, as they require JavaScript runtime execution which isn't compatible with static site generation.

## Examples

See the test files for complete examples:
- [test-admonitions.md](content/test-admonitions.md) - Admonition examples
- [test-dataview.md](content/test-dataview.md) - Dataview examples

## Plugin Configuration

### Disabling Plugins

To disable either plugin, modify `quartz.config.ts`:

```typescript
// Disable dataview
Plugin.DataviewTables({ enableDataview: false }),

// Disable admonitions
Plugin.Admonitions({ enableAdmonitions: false }),
```

Or remove them entirely from the transformers array.

## File Locations

- **Admonitions Plugin**: `quartz/plugins/transformers/admonitions.ts`
- **Dataview Plugin**: `quartz/plugins/transformers/dataview.ts`
- **Plugin Index**: `quartz/plugins/transformers/index.ts`
- **Configuration**: `quartz.config.ts`

## Styling

- **Admonitions**: Uses Quartz's existing callout styles (defined in `quartz/styles/callouts.scss`). No additional CSS needed.
- **Dataview**: Includes custom CSS for displaying query information boxes and placeholder tables via the `externalResources()` method.

The styles support both light and dark modes automatically.

## Future Enhancements

Potential improvements for the dataview plugin:

1. **Build-time query execution**: Parse all markdown files during build and execute dataview queries against actual metadata
2. **Full query language support**: Implement all dataview query features
3. **Computed fields**: Support for expressions and calculations
4. **Grouping**: Support for GROUP BY clauses
5. **Custom rendering**: Support for inline dataview queries

For now, the plugin serves as a syntax recognizer that prevents dataview blocks from appearing as raw code in your published site.

## Compatibility

- ✅ Works with Obsidian Flavored Markdown
- ✅ Compatible with GitHub Flavored Markdown
- ✅ Supports dark mode
- ✅ Mobile responsive
- ✅ No external dependencies beyond Quartz's existing remark/rehype ecosystem
- ✅ Admonitions are converted to standard Obsidian callouts (fully compatible)

## Troubleshooting

### Admonitions not rendering
- Ensure the code block uses the `ad-` prefix (e.g., ``` ad-note```)
- Check that the plugin is enabled in `quartz.config.ts`
- **Verify plugin order**: Admonitions must come BEFORE ObsidianFlavoredMarkdown in the transformers array
- Build and test: `npx quartz build && npx quartz serve`
- Verify TypeScript compilation succeeded: `npx tsc --noEmit`

### Dataview tables not showing
- Remember that dataview queries don't execute with real data
- The plugin shows the query structure, not actual results
- For full dataview functionality, consider implementing build-time query execution

### Build errors
- Run `npx tsc --noEmit` to check for TypeScript errors
- Ensure all dependencies are installed: `npm install`
- Check that plugin exports are correct in `quartz/plugins/transformers/index.ts`

## Contributing

To extend these plugins:

1. Edit the transformer files in `quartz/plugins/transformers/`
2. Follow the existing plugin patterns (see `gfm.ts` for a simple example)
3. Test with `npx tsc --noEmit`
4. Build the site with `npx quartz build`
5. Test rendering with `npx quartz serve`

---

Built for Quartz 4 - A fast, batteries-included static-site generator.
