---
name: web2-read
description: "Read a web page and extract clean text content. Use when you need to read an article, documentation, or any web page."
allowed-tools: Bash, Write, Read
argument-hint: <url> [--output file.md]
---

Extract clean readable text from a web page using Readability. Your browser
starts automatically — no setup needed.

```bash
web2 extract reader <url> --output <file>
```

## Examples

```bash
# Read an article to stdout
web2 extract reader https://example.com/blog/post

# Save to file
web2 extract reader https://example.com/docs --output docs.md

# Read current page (navigate first)
web2 go https://example.com
web2 extract reader
```
