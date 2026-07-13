import { writeFileSync } from "node:fs";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { scrollToBottom, dismissCookieBanner, navigate as navPage } from "../lib/extract.js";
import { withPage } from "../lib/browser.js";

export function htmlToMarkdown(html: string): string {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const lines: string[] = [];

  function walk(node: any): void {
    if (node.nodeType === 3) {
      const text = node.textContent.replace(/\s+/g, " ");
      if (text.trim()) lines.push(text);
      return;
    }
    if (node.nodeType !== 1) return;

    const tag = node.tagName?.toLowerCase() ?? "";

    switch (tag) {
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
        const level = parseInt(tag[1], 10);
        const text = node.textContent.trim();
        if (text) lines.push("\n" + "#".repeat(level) + " " + text + "\n");
        return;
      }
      case "p": {
        const text = inlineText(node);
        if (text) lines.push("\n" + text + "\n");
        return;
      }
      case "div": {
        // Divs may contain block-level children — recurse with walk, not inlineText
        for (const child of node.childNodes) {
          walk(child);
        }
        return;
      }
      case "blockquote": {
        const text = inlineText(node);
        if (text) lines.push("\n> " + text + "\n");
        return;
      }
      case "pre": {
        const code = node.textContent;
        if (code) lines.push("\n```\n" + code + "\n```\n");
        return;
      }
      case "ul": case "ol": {
        let i = 0;
        for (const child of node.childNodes) {
          if (child.tagName?.toLowerCase() === "li") {
            i++;
            const prefix = tag === "ol" ? `${i}. ` : "- ";
            const text = inlineText(child);
            if (text) lines.push(prefix + text);
          }
        }
        lines.push("");
        return;
      }
      case "br": {
        lines.push("");
        return;
      }
      case "hr": {
        lines.push("\n---\n");
        return;
      }
      case "figure": {
        // skip figures (images, captions)
        return;
      }
      case "img": {
        return;
      }
    }

    for (const child of node.childNodes) {
      walk(child);
    }
  }

  function inlineText(node: any): string {
    const parts: string[] = [];
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        parts.push(child.textContent.replace(/\s+/g, " "));
      } else if (child.nodeType === 1) {
        const ctag = child.tagName?.toLowerCase() ?? "";
        if (ctag === "a") {
          const href = child.getAttribute("href") || "";
          const text = child.textContent.trim();
          if (text && href) parts.push(`[${text}](${href})`);
          else if (text) parts.push(text);
        } else if (ctag === "strong" || ctag === "b") {
          const text = child.textContent.trim();
          if (text) parts.push(`**${text}**`);
        } else if (ctag === "em" || ctag === "i") {
          const text = child.textContent.trim();
          if (text) parts.push(`*${text}*`);
        } else if (ctag === "code") {
          const text = child.textContent.trim();
          if (text) parts.push(`\`${text}\``);
        } else if (ctag === "br") {
          parts.push("\n");
        } else {
          parts.push(inlineText(child));
        }
      }
    }
    return parts.join("").replace(/  +/g, " ").trim();
  }

  walk(document.body || document.documentElement);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export async function reader(url: string | undefined, opts: { output?: string }): Promise<void> {
  const t0 = performance.now();

  await withPage(async (page) => {
    if (url) {
      await navPage(page, url);
    } else if (!page.url() || page.url() === "about:blank") {
      process.stderr.write("Error: no URL provided and no page loaded. Navigate first or pass a URL.\n");
      process.exit(1);
    }

    await dismissCookieBanner(page);
    await scrollToBottom(page);

    const html = await page.content();
    const pageUrl = page.url();
    const { document } = parseHTML(html);
    const parsed = new Readability(document as any, { charThreshold: 50 }).parse();

    if (!parsed || !parsed.content) {
      process.stderr.write("Error: could not extract article content\n");
      process.exit(1);
      return;
    }

    let md = "";
    if (parsed.title) md += `# ${parsed.title}\n\n`;
    if (parsed.excerpt) md += `> ${parsed.excerpt}\n\n`;
    md += htmlToMarkdown(parsed.content);

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

    if (opts.output) {
      writeFileSync(opts.output, md);
      process.stderr.write(`Saved to ${opts.output} (${elapsed}s)\n`);
    } else {
      process.stderr.write(`Scraped in ${elapsed}s\n`);
      process.stdout.write(md);
    }
  });
}
