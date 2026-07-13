import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";

// ---------------------------------------------------------------------------
// Text extraction: walk the DOM, emit one record per text string
// ---------------------------------------------------------------------------

interface TextRecord {
  text: string;     // the actual text content
  context: string;  // element type: h1, p, link, img-alt, button, nav, th, td, etc.
  url: string;      // page URL where this string was found
  href: string;     // link target (for links) or empty
}

const SKIP_TAGS = new Set(["script", "style", "noscript", "link", "meta", "svg", "br", "hr"]);

function extractRecords(el: any, url: string, parentCtx?: string): TextRecord[] {
  const tag = el.tagName?.toLowerCase() || "";

  if (SKIP_TAGS.has(tag)) return [];

  // Images — alt text
  if (tag === "img") {
    const alt = (el.getAttribute?.("alt") || "").trim();
    if (alt) return [{ text: alt, context: "img-alt", url, href: el.getAttribute?.("src") || "" }];
    return [];
  }

  // Determine context
  let ctx = parentCtx || "";
  if (/^h[1-6]$/.test(tag)) ctx = tag;
  else if (tag === "a") ctx = parentCtx === "nav" ? "nav-link" : "link";
  else if (tag === "button") ctx = "button";
  else if (tag === "label") ctx = "label";
  else if (tag === "nav") ctx = "nav";
  else if (tag === "footer") ctx = "footer";
  else if (tag === "header") ctx = "header";
  else if (tag === "figcaption") ctx = "caption";
  else if (tag === "th") ctx = "th";
  else if (tag === "td") ctx = "td";
  else if (tag === "blockquote") ctx = "blockquote";
  else if (tag === "p") ctx = ctx || "p";
  else if (tag === "li") ctx = ctx || "li";
  else if (tag === "title") ctx = "title";

  // Input/textarea — placeholder or aria-label
  if (tag === "input" || tag === "textarea") {
    const text = (el.getAttribute?.("placeholder") || el.getAttribute?.("aria-label") || "").trim();
    if (text) return [{ text, context: "input", url, href: "" }];
    return [];
  }

  // Link — collect all text, emit as one record with href
  if (tag === "a") {
    const text = (el.textContent || "").trim();
    if (!text) return [];
    const href = el.getAttribute?.("href") || "";
    return [{ text, context: ctx, url, href }];
  }

  // Heading — collect all child text as one record
  if (/^h[1-6]$/.test(tag)) {
    const text = (el.textContent || "").trim();
    if (!text) return [];
    return [{ text, context: tag, url, href: "" }];
  }

  // Table row — join cells
  if (tag === "tr") {
    const cells: string[] = [];
    let isHeader = false;
    for (const child of el.children || []) {
      if (child.tagName?.toLowerCase() === "th") isHeader = true;
      const t = (child.textContent || "").trim();
      if (t) cells.push(t);
    }
    if (cells.length === 0) return [];
    const records: TextRecord[] = [{ text: cells.join(" | "), context: isHeader ? "th" : "td", url, href: "" }];
    // Also extract links within the row
    if (el.querySelectorAll) {
      for (const a of el.querySelectorAll("a")) {
        const linkText = (a.textContent || "").trim();
        const linkHref = a.getAttribute?.("href") || "";
        if (linkText && linkHref) {
          records.push({ text: linkText, context: "link", url, href: linkHref });
        }
      }
    }
    return records;
  }

  // Paragraph/li/blockquote — emit full text + links inside
  if (tag === "p" || tag === "li" || tag === "blockquote" || tag === "figcaption") {
    const records: TextRecord[] = [];
    const text = (el.textContent || "").trim();
    if (text) {
      records.push({ text, context: ctx || tag, url, href: "" });
    }
    if (el.querySelectorAll) {
      for (const a of el.querySelectorAll("a")) {
        const linkText = (a.textContent || "").trim();
        const linkHref = a.getAttribute?.("href") || "";
        if (linkText && linkHref) {
          records.push({ text: linkText, context: "link", url, href: linkHref });
        }
      }
      for (const img of el.querySelectorAll("img")) {
        const alt = (img.getAttribute?.("alt") || "").trim();
        if (alt) records.push({ text: alt, context: "img-alt", url, href: img.getAttribute?.("src") || "" });
      }
    }
    return records;
  }

  // Leaf node — no children
  if (!el.children || el.children.length === 0) {
    const text = (el.textContent || "").trim();
    if (!text) return [];
    return [{ text, context: ctx || "text", url, href: "" }];
  }

  // Recurse
  const records: TextRecord[] = [];
  for (const child of el.children) {
    records.push(...extractRecords(child, url, ctx));
  }
  return records;
}

// ---------------------------------------------------------------------------
// URL extraction from DOM file
// ---------------------------------------------------------------------------

function getPageUrl(html: string, doc: any, file: string): string {
  const webUrlMatch = html.match(/^<!--\s*web-url:\s*(.+?)\s*-->/);
  if (webUrlMatch) return webUrlMatch[1];

  const canonical = doc.querySelector?.('link[rel="canonical"]');
  if (canonical) {
    const href = canonical.getAttribute?.("href");
    if (href) return href;
  }
  const ogUrl = doc.querySelector?.('meta[property="og:url"]');
  if (ogUrl) {
    const content = ogUrl.getAttribute?.("content");
    if (content) return content;
  }
  return file.replace(/\.html$/, "");
}

// ---------------------------------------------------------------------------
// Dedup + sort
// ---------------------------------------------------------------------------

interface Deduped {
  text: string;
  context: string;
  pageCount: number;
  exampleUrl: string;
  href: string;
}

function dedupAndSort(records: TextRecord[]): Deduped[] {
  // Key: text + context + href → aggregate
  const map = new Map<string, { text: string; context: string; urls: Set<string>; href: string }>();

  for (const r of records) {
    const clean = r.text.replace(/\s+/g, " ").trim();
    if (!clean) continue;

    const key = `${clean}\t${r.context}\t${r.href}`;
    const existing = map.get(key);
    if (existing) {
      existing.urls.add(r.url);
    } else {
      map.set(key, { text: clean, context: r.context, urls: new Set([r.url]), href: r.href });
    }
  }

  const result: Deduped[] = [];
  for (const entry of map.values()) {
    result.push({
      text: entry.text,
      context: entry.context,
      pageCount: entry.urls.size,
      exampleUrl: [...entry.urls][0],
      href: entry.href,
    });
  }

  // Sort by text (case-insensitive), then context, then href
  result.sort((a, b) => {
    const cmp = a.text.localeCompare(b.text, undefined, { sensitivity: "base" });
    if (cmp !== 0) return cmp;
    const cmp2 = a.context.localeCompare(b.context);
    if (cmp2 !== 0) return cmp2;
    return (a.href || "").localeCompare(b.href || "");
  });

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function normalize(dir: string, opts: {
  output?: string;
}): Promise<void> {
  const outPath = opts.output ?? join(dir, "..", "content.tsv");

  const files = readdirSync(dir).filter(f => f.endsWith(".html"));
  if (files.length === 0) {
    process.stderr.write("No .html files found.\n");
    process.exit(1);
  }

  process.stderr.write(`Extracting text from ${files.length} pages...\n`);

  // Extract all text records from all pages
  const allRecords: TextRecord[] = [];

  for (const file of files) {
    const html = readFileSync(join(dir, file), "utf-8");
    const { document } = parseHTML(html);
    const body = document.body;
    if (!body) continue;

    const url = getPageUrl(html, document, file);

    // Strip noise elements before extraction
    for (const sel of ["style", "script", "noscript"]) {
      for (const el of [...body.querySelectorAll(sel)]) {
        el.remove();
      }
    }

    const records = extractRecords(body, url);
    allRecords.push(...records);
  }

  process.stderr.write(`${allRecords.length} strings extracted, deduplicating...\n`);

  const deduped = dedupAndSort(allRecords);

  // Write TSV: text \t context \t pages \t url \t href
  const lines: string[] = [];
  lines.push(`# ${files.length} pages, ${deduped.length} unique strings`);
  lines.push(`# text\tcontext\tpages\turl\thref`);

  for (const d of deduped) {
    const escapedText = d.text.replace(/\t/g, " ").replace(/\n/g, " ");
    lines.push(`${escapedText}\t${d.context}\t${d.pageCount}\t${d.exampleUrl}\t${d.href}`);
  }

  const result = lines.join("\n") + "\n";
  writeFileSync(outPath, result);
  process.stderr.write(`Output: ${outPath} (${deduped.length} strings, ${(result.length / 1024).toFixed(0)} KB)\n`);
}
