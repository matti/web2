---
name: web2-go
description: "Navigate to a URL and interact with the page — click, fill forms, extract data, take screenshots. Use for any multi-step browser task."
allowed-tools: Bash, Write, Read, Glob
argument-hint: <url> [goal]
---

Navigate to a URL and interact with the page. This is the main browser skill
for multi-step tasks. Your browser starts automatically on the first command
and cleans itself up when idle — there is nothing to set up or tear down, and
no other browser is visible to you.

```bash
web2 go <url>
```

Every page-changing command ends with a grounding line on stderr
(`→ <url> — "<title>"`) so you always know where the browser is.

## Commands

### Navigate
- `web2 go <url>` -- navigate to a URL
- `web2 do scroll <down|up|bottom|top>` -- scroll the page

### Observe
- `web2 extract accessibility` -- page structure with selectors
- `web2 extract text` -- structured text dump
- `web2 extract reader [url]` -- clean article text (Readability)
- `web2 extract links` -- all links on the page
- `web2 extract source` -- raw HTML
- `web2 extract selector <sel> [--all] [--attr ATTR]` -- element text/attributes
- `web2 extract table [sel] [--json] [--csv]` -- table data
- `web2 page screenshot [--output FILE] [--full-page] [--selector SEL]` -- screenshot
- `web2 page view [--full-page]` -- terminal page view
- `web2 status` -- where am I: url, title, viewport, tabs

### Interact
- `web2 do click <selector> [--text "Button Text"]` -- click
- `web2 do fill <selector> <value> [--clear]` -- fill input
- `web2 do type <text> [--selector SEL]` -- type text
- `web2 do press <key>` -- press key (Enter, Tab, Escape, ArrowDown, ...)
- `web2 do select <selector> <value>` -- select dropdown
- `web2 do hover <selector>` -- hover
- `web2 do upload <selector> <file...>` -- attach files
- `web2 do dismiss` -- dismiss cookie banners

### Wait
- `web2 wait <selector>` -- wait for element
- `web2 wait text:<content>` -- wait for text
- `web2 wait hidden:<selector>` -- wait for element to disappear
- `web2 wait network-idle` -- wait for network to settle
- `web2 wait url:<pattern>` -- wait for URL match

### Other
- `web2 exec <js>` -- run JavaScript
- `web2 network [--json]` -- network requests
- `web2 pdf [--output FILE]` -- save as PDF
- `web2 cookies list [--json]` / `web2 cookies clear`
- `web2 reset` -- replace your browser with a completely fresh one

## Visual feedback

To see what the page looks like, take a screenshot and read the image file:

```bash
web2 page screenshot --output .web2-screenshot.png
```

## Errors

Errors are one line and tell you what to do next. `browser busy` (exit 5)
means another of your own commands holds the browser — retry shortly.
