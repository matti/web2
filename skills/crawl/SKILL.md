---
name: web2-crawl
description: "Crawl a website and extract all pages as markdown. Use for scraping documentation sites, blogs, or any multi-page content."
allowed-tools: Bash, Write, Read
argument-hint: <url> [--depth N] [--limit N] [--merge] [--output path]
---

Crawl a website starting from a URL, extracting each page as clean markdown.
Your browser starts automatically — no setup needed.

```bash
web2 go <url>
web2 crawl $ARGUMENTS
```

## Examples

```bash
# Crawl docs into one file
web2 go https://docs.example.com
web2 crawl --depth 2 --merge --output docs.md

# Crawl with page limit
web2 go https://example.com/blog
web2 crawl --limit 20 --output blog/

# Shallow crawl (just linked pages)
web2 go https://example.com
web2 crawl --depth 1 --merge --output site.md
```

## Options

- `--depth N` -- max link depth (default: 2)
- `--limit N` -- max pages to crawl
- `--merge` -- combine all pages into one file
- `--output PATH` -- output file or directory
- `--rate N` -- ms between requests (default: 500)
- `--screenshots` -- save PNG alongside markdown
