import { withPage } from "../lib/browser.js";
import { extractMeta } from "../lib/extract.js";

interface TextEntry {
  section: string;
  role: string;
  text: string;
}

export async function text(): Promise<void> {
  await withPage(async (page) => {
    const entries: TextEntry[] = await page.evaluate(() => {
      (globalThis as any).__name = (globalThis as any).__name || ((fn: any) => fn);
      const SKIP = new Set([
        "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "TEMPLATE", "IFRAME", "BR", "HR",
      ]);

      const TAG_SECTIONS: Record<string, string> = {
        HEADER: "header", NAV: "nav", MAIN: "main", FOOTER: "footer", ASIDE: "aside",
      };
      const ROLE_SECTIONS: Record<string, string> = {
        banner: "header", navigation: "nav", main: "main",
        contentinfo: "footer", complementary: "aside", search: "search",
      };

      const NOISE = /^(go to (last |next )?(slide|page)|previous (slide|page)|next (slide|page))/i;

      const getSection = (el: Element): string | undefined => {
        return TAG_SECTIONS[el.tagName] || ROLE_SECTIONS[el.getAttribute("role") || ""];
      };

      const isVisible = (el: Element): boolean => {
        const s = getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden";
      };

      const collectText = (el: Element): string => {
        return (el.textContent || "").replace(/\s+/g, " ").trim();
      };

      const hasBlockContent = (el: Element): boolean => {
        return !!el.querySelector("h1,h2,h3,h4,h5,h6,p,div,section,article,ul,ol,table");
      };

      const results: { section: string; role: string; text: string }[] = [];

      const walk = (el: Element, section: string): void => {
        if (SKIP.has(el.tagName)) return;
        if (el instanceof HTMLElement && !isVisible(el)) return;

        const newSection = getSection(el);
        if (newSection) section = newSection;

        const tag = el.tagName;

        // Headings
        if (/^H[1-6]$/.test(tag)) {
          const text = collectText(el);
          if (text) results.push({ section, role: tag.toLowerCase(), text });
          return;
        }

        // Links — recurse if structured, otherwise emit as link
        if (tag === "A") {
          if (hasBlockContent(el)) {
            for (const child of el.children) walk(child as Element, section);
          } else {
            const text = collectText(el);
            if (text && !NOISE.test(text)) results.push({ section, role: "link", text });
          }
          return;
        }

        // Buttons
        if (tag === "BUTTON") {
          if (hasBlockContent(el)) {
            for (const child of el.children) walk(child as Element, section);
          } else {
            const text = collectText(el);
            if (text && !NOISE.test(text)) results.push({ section, role: "button", text });
          }
          return;
        }
        if (tag === "INPUT" && ((el as HTMLInputElement).type === "button" || (el as HTMLInputElement).type === "submit")) {
          const text = (el as HTMLInputElement).value?.trim();
          if (text) results.push({ section, role: "button", text });
          return;
        }

        // Images
        if (tag === "IMG") {
          const alt = (el as HTMLImageElement).alt?.trim();
          if (alt) results.push({ section, role: "img", text: alt });
          return;
        }

        // Paragraphs — if all children are inline semantic, recurse; otherwise emit as block
        if (tag === "P") {
          const kids = [...el.children];
          const allLinks = kids.length > 0 && kids.every((c) => c.tagName === "A" || c.tagName === "BUTTON");
          if (allLinks) {
            for (const child of kids) walk(child as Element, section);
          } else {
            const text = collectText(el);
            if (text) results.push({ section, role: "p", text });
          }
          return;
        }
        if (tag === "BLOCKQUOTE") {
          const text = collectText(el);
          if (text) results.push({ section, role: "blockquote", text });
          return;
        }
        if (tag === "PRE") {
          const text = (el.textContent || "").trim();
          if (text) results.push({ section, role: "pre", text });
          return;
        }
        if (tag === "FIGCAPTION") {
          const text = collectText(el);
          if (text) results.push({ section, role: "figcaption", text });
          return;
        }

        // Table cells
        if (tag === "TH") {
          const text = collectText(el);
          if (text) results.push({ section, role: "th", text });
          return;
        }
        if (tag === "TD") {
          const text = collectText(el);
          if (text) results.push({ section, role: "td", text });
          return;
        }

        // Definition terms / descriptions
        if (tag === "DT") {
          const text = collectText(el);
          if (text) results.push({ section, role: "dt", text });
          return;
        }
        if (tag === "DD") {
          const text = collectText(el);
          if (text) results.push({ section, role: "dd", text });
          return;
        }

        // Labels
        if (tag === "LABEL") {
          const text = collectText(el);
          if (text) results.push({ section, role: "label", text });
          return;
        }

        // Input placeholders
        if (tag === "INPUT" || tag === "TEXTAREA") {
          const ph = (el as HTMLInputElement).placeholder?.trim();
          if (ph) results.push({ section, role: "placeholder", text: ph });
          return;
        }

        // Summary (inside <details>)
        if (tag === "SUMMARY") {
          const text = collectText(el);
          if (text) results.push({ section, role: "summary", text });
          return;
        }

        // Skip form/select internals
        if (tag === "SELECT" || tag === "OPTION" || tag === "OPTGROUP") return;

        // Structural: recurse through child nodes (elements + text nodes)
        for (const child of el.childNodes) {
          if (child.nodeType === 1) {
            walk(child as Element, section);
          } else if (child.nodeType === 3) {
            const text = (child.textContent || "").replace(/\s+/g, " ").trim();
            if (text) results.push({ section, role: "text", text });
          }
        }
      }

      walk(document.body, "main");
      return results;
    });

    if (entries.length === 0) {
      process.stderr.write("No content extracted.\n");
      process.exit(1);
    }

    // Group by section, dedup within each section
    const sections: Record<string, TextEntry[]> = {};
    for (const entry of entries) {
      (sections[entry.section] ??= []).push(entry);
    }
    for (const key of Object.keys(sections)) {
      const seen = new Set<string>();
      sections[key] = sections[key].filter((e) => {
        const k = `${e.role}\0${e.text}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }

    const url = page.url();
    const { title, excerpt } = await extractMeta(page);
    process.stdout.write(formatYaml(url, title, excerpt, sections));
  });
}

export function yamlEscape(s: string): string {
  if (
    !s ||
    /[:#\[\]{}&*!|>'"%@`\n]/.test(s) ||
    s.trim() !== s ||
    s === "true" || s === "false" || s === "null" ||
    !isNaN(Number(s)) ||
    s.startsWith("- ") || s.startsWith("? ")
  ) {
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
  }
  return s;
}

export function formatYaml(
  url: string,
  title: string,
  description: string,
  sections: Record<string, TextEntry[]>,
): string {
  const lines: string[] = [];

  lines.push(`url: ${yamlEscape(url)}`);
  if (title) lines.push(`title: ${yamlEscape(title)}`);
  if (description) lines.push(`description: ${yamlEscape(description)}`);

  const order = ["header", "nav", "search", "main", "aside", "footer"];
  const emitted = new Set<string>();

  for (const key of order) {
    if (sections[key]) {
      emitted.add(key);
      lines.push("");
      lines.push(`${key}:`);
      for (const entry of sections[key]) {
        lines.push(`  - ${entry.role}: ${yamlEscape(entry.text)}`);
      }
    }
  }

  for (const key of Object.keys(sections)) {
    if (!emitted.has(key)) {
      lines.push("");
      lines.push(`${key}:`);
      for (const entry of sections[key]) {
        lines.push(`  - ${entry.role}: ${yamlEscape(entry.text)}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}
