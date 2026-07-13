---
name: web2-screenshot
description: "Take a screenshot of a web page. Use when you need a visual capture of a page."
allowed-tools: Bash, Read
argument-hint: <url> [--output file.png] [--full-page]
---

Take a PNG screenshot of a web page. Your browser starts automatically — no
setup needed.

```bash
web2 go <url>
web2 page screenshot --output <file>
```

## Examples

```bash
# Screenshot a page
web2 go https://example.com
web2 page screenshot --output example.png

# Full-page screenshot (scrolls entire page)
web2 go https://example.com
web2 page screenshot --output full.png --full-page

# Screenshot a specific element
web2 go https://example.com
web2 page screenshot --output header.png --selector "header"
```
