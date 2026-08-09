import type { Page, BrowserContext } from "playwright";

export interface ArticleMeta {
  ogTitle?: string;
  ogDescription?: string;
  ogType?: string;
  author?: string;
  jsonLd?: any[];
}

export interface Article {
  title: string;
  excerpt: string;
  content: string;
  method: "semdown";
  meta?: ArticleMeta;
}

export interface AriaNode {
  role: string;
  name: string;
  attrs: Record<string, string>;
  children: AriaNode[];
}

export async function blockNonEssentialResources(
  context: BrowserContext,
  opts?: { keepImages?: boolean },
): Promise<void> {
  const keepImages = opts?.keepImages ?? false;
  const blockedExt = keepImages
    ? /\.(woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|flac)(\?.*)?$/i
    : /\.(png|jpe?g|gif|svg|webp|ico|bmp|avif|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|flac)(\?.*)?$/i;

  await context.route(blockedExt, (route) => route.abort());
  await context.route("**/*", (route, request) => {
    const type = request.resourceType();
    if (type === "font") return route.abort();
    if (!keepImages && (type === "image" || type === "media")) return route.abort();
    if (type === "media") return route.abort();
    return route.continue();
  });
}

// Patterns for accept buttons (used in main page and CMP iframes)
const acceptPatterns = /^(accept\s*(all\s*cookies|all|cookies)?|allow\s*(all|cookies)?|agree|got\s*it|ok|i\s*agree|consent|continue|understood|hyväksy|hyväksy\s*kaikki|accepter|akzeptieren|accetta)$/i;

// CMP iframe URL patterns (Sourcepoint, OneTrust, Quantcast, etc.)
const cmpFramePatterns = /privacy-mgmt\.com|sourcepoint|onetrust\.com|quantcast|cookiebot|consent|didomi|usercentrics/i;

function clickAcceptButton(): boolean {
  const patterns = /^(accept\s*(all\s*cookies|all|cookies)?|allow\s*(all|cookies)?|agree|got\s*it|ok|i\s*agree|consent|continue|understood|hyväksy|hyväksy\s*kaikki|accepter|akzeptieren|accetta)$/i;
  const elements = [
    ...document.querySelectorAll("button"),
    ...document.querySelectorAll('a[role="button"]'),
    ...document.querySelectorAll('input[type="button"]'),
    ...document.querySelectorAll('input[type="submit"]'),
  ];
  for (const el of elements) {
    const text = (el.textContent || (el as HTMLInputElement).value || "").trim();
    if (text && patterns.test(text)) {
      (el as HTMLElement).click();
      return true;
    }
  }
  return false;
}

/**
 * Dismiss a cookie consent banner.
 *
 * settleMs is how long to let the banner's dismissal animation finish before
 * the caller reads the page. It is a parameter only so tests can pass 0:
 * against a mocked page the wait proves nothing and cost a real second.
 */
export async function dismissCookieBanner(page: Page, settleMs = 500): Promise<void> {
  const clicked = await page.evaluate(clickAcceptButton);

  if (clicked) {
    await new Promise((r) => setTimeout(r, settleMs));
    return;
  }

  // Try CMP iframes (Sourcepoint, OneTrust, etc.) - cross-origin but accessible via Playwright
  if (typeof page.frames === "function") {
    for (const frame of page.frames()) {
      if (cmpFramePatterns.test(frame.url())) {
        try {
          const frameClicked = await frame.evaluate(clickAcceptButton);
          if (frameClicked) {
            await new Promise((r) => setTimeout(r, settleMs));
            return;
          }
        } catch { /* frame may have navigated away */ }
      }
    }
  }

  // Last resort: remove fixed/sticky cookie overlays
  await page.evaluate(() => {
    const selectors = [
      '[class*="cookie"]',
      '[class*="consent"]',
      '[class*="gdpr"]',
      '[id*="cookie"]',
      '[id*="consent"]',
      '[id*="gdpr"]',
      '[id^="sp_message_container"]',
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const style = getComputedStyle(el);
        if (style.position === "fixed" || style.position === "sticky") {
          el.remove();
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Aria snapshot parsing (fallback extractor)
// ---------------------------------------------------------------------------

export function parseAriaYaml(yaml: string): AriaNode[] {
  const lines = yaml.split("\n");
  const root: AriaNode[] = [];
  const stack: { indent: number; children: AriaNode[] }[] = [
    { indent: -1, children: root },
  ];

  for (const line of lines) {
    const match = line.match(/^(\s*)- (.+)$/);
    if (!match) continue;

    const indent = match[1].length;
    const node = parseAriaLine(match[2]);

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push({ indent, children: node.children });
  }

  return root;
}

function parseAriaLine(content: string): AriaNode {
  const node: AriaNode = { role: "", name: "", attrs: {}, children: [] };
  let rest = content;

  const roleMatch = rest.match(/^(\/?\w[\w-]*)/);
  if (roleMatch) {
    node.role = roleMatch[1];
    rest = rest.slice(roleMatch[0].length).trimStart();
  }

  if (rest.startsWith('"')) {
    let i = 1;
    while (i < rest.length) {
      if (rest[i] === "\\" && i + 1 < rest.length) { i += 2; continue; }
      if (rest[i] === '"') break;
      i++;
    }
    node.name = rest.slice(1, i);
    rest = rest.slice(i + 1).trimStart();
  }

  if (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end !== -1) {
      const attrStr = rest.slice(1, end).trim();
      if (attrStr) {
        for (const pair of attrStr.split(/,\s*/)) {
          const eq = pair.indexOf("=");
          if (eq !== -1) {
            const key = pair.slice(0, eq).trim();
            let val = pair.slice(eq + 1).trim();
            if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
            node.attrs[key] = val;
          } else {
            node.attrs[pair.trim()] = "true";
          }
        }
      }
      rest = rest.slice(end + 1).trimStart();
    }
  }

  if (rest.startsWith(":")) {
    const text = rest.slice(1).trim();
    if (text && !node.name) node.name = text;
  }

  return node;
}


// ---------------------------------------------------------------------------
// Semdown: compact semantic text representation of a full page
// ---------------------------------------------------------------------------

const SEMDOWN_SKIP = new Set([
  "img", "/url",
  "combobox", "textbox", "slider", "option",
  "toolbar", "menubar", "menu", "menuitem",
  "tab", "tablist",
  "scrollbar", "progressbar", "spinbutton",
  "form",
]);

const SECTION_LABELS: Record<string, string> = {
  banner: "header",
  navigation: "nav",
  contentinfo: "footer",
  complementary: "aside",
  search: "search",
};

const CAROUSEL_NOISE = /^\d+\s*\/\s*\d+$/;
const SLIDE_BUTTON = /^(previous|next)\s+(slide|page)/i;

export function treeToSemdown(nodes: AriaNode[]): string {
  const lines: string[] = [];
  semdownBlock(nodes, lines, 0, 0);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function semdownNoise(node: AriaNode): boolean {
  if (CAROUSEL_NOISE.test(node.name)) return true;
  if (node.role === "button" && SLIDE_BUTTON.test(node.name)) return true;
  return false;
}

function semdownIndent(depth: number): string {
  return "  ".repeat(depth);
}

function semdownBlock(nodes: AriaNode[], lines: string[], depth: number, listDepth: number): void {
  for (const node of nodes) {
    if (SEMDOWN_SKIP.has(node.role)) continue;
    if (semdownNoise(node)) continue;

    const label = SECTION_LABELS[node.role];
    if (label) {
      const inner: string[] = [];
      semdownBlock(node.children, inner, 0, 0);
      const text = inner.join("\n").trim();
      if (text) {
        lines.push(semdownIndent(depth) + label + ":");
        for (const l of text.split("\n")) {
          lines.push(l ? semdownIndent(depth + 1) + l : "");
        }
      }
      continue;
    }

    const pre = semdownIndent(depth);

    switch (node.role) {
      case "heading": {
        const level = parseInt(node.attrs.level || "1", 10);
        const text = node.name || semdownCollectText(node.children);
        if (text) lines.push(pre + "#".repeat(level) + " " + text);
        break;
      }
      case "paragraph": {
        const text = node.children.length > 0 ? semdownCollectText(node.children) : node.name;
        if (text) lines.push(pre + text);
        break;
      }
      case "blockquote": {
        const text = node.children.length > 0 ? semdownCollectText(node.children) : node.name;
        if (text) lines.push(pre + "> " + text);
        break;
      }
      case "list": {
        semdownBlock(node.children, lines, depth, listDepth);
        break;
      }
      case "listitem": {
        const inlineKids: AriaNode[] = [];
        const nestedLists: AriaNode[] = [];
        for (const ch of node.children) {
          if (ch.role === "list") nestedLists.push(ch);
          else inlineKids.push(ch);
        }
        const itemLines: string[] = [];
        const inlineText: string[] = [];
        const lp = pre + "  ".repeat(listDepth);
        for (const kid of inlineKids) {
          if (kid.role === "heading") {
            if (inlineText.length > 0) {
              itemLines.push(lp + "- " + inlineText.join(" "));
              inlineText.length = 0;
            }
            const level = parseInt(kid.attrs.level || "1", 10);
            const t = kid.name || semdownCollectText(kid.children);
            if (t) itemLines.push(lp + "  " + "#".repeat(level) + " " + t);
          } else {
            const t = semdownCollectText([kid]);
            if (t) inlineText.push(t);
          }
        }
        if (inlineText.length > 0) {
          const combined = inlineText.join(" ");
          if (itemLines.length > 0) {
            itemLines.push(lp + "  " + combined);
          } else {
            itemLines.push(lp + "- " + combined);
          }
        }
        if (itemLines.length === 0 && node.name) {
          itemLines.push(lp + "- " + node.name);
        }
        for (const l of itemLines) lines.push(l);
        for (const nested of nestedLists) semdownBlock(nested.children, lines, depth, listDepth + 1);
        break;
      }
      case "separator": {
        lines.push(pre + "---");
        break;
      }
      case "button": {
        const text = node.name || semdownCollectText(node.children);
        if (text && !SLIDE_BUTTON.test(text)) lines.push(pre + text);
        break;
      }
      case "link": {
        const text = node.name || semdownCollectText(node.children);
        if (text) lines.push(pre + text);
        break;
      }
      default: {
        if (node.children.length > 0) {
          semdownBlock(node.children, lines, depth, listDepth);
        } else if (node.name) {
          lines.push(pre + node.name);
        }
        break;
      }
    }
  }
}

function semdownCollectText(nodes: AriaNode[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (SEMDOWN_SKIP.has(node.role)) continue;
    if (node.children.length > 0) {
      const sub = semdownCollectText(node.children);
      if (sub) parts.push(sub);
    } else if (node.name) {
      parts.push(node.name);
    }
  }
  return parts.join(" ").replace(/\s{2,}/g, " ").trim();
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function extractMeta(page: Page): Promise<{ title: string; excerpt: string; meta?: ArticleMeta }> {
  return page.evaluate(() => {
    (globalThis as any).__name = (globalThis as any).__name || ((fn: any) => fn);
    const gm = (sel: string) => document.querySelector(sel)?.getAttribute("content") || "";
    const meta: Record<string, any> = {};
    const ogTitle = gm('meta[property="og:title"]');
    const ogDesc = gm('meta[property="og:description"]');
    const ogType = gm('meta[property="og:type"]');
    const author = gm('meta[name="author"]');
    if (ogTitle) meta.ogTitle = ogTitle;
    if (ogDesc) meta.ogDescription = ogDesc;
    if (ogType) meta.ogType = ogType;
    if (author) meta.author = author;

    const jsonLd: any[] = [];
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { jsonLd.push(JSON.parse(el.textContent || "")); } catch {}
    }
    if (jsonLd.length > 0) meta.jsonLd = jsonLd;

    return {
      title: document.title || "",
      excerpt: gm('meta[name="description"]') || "",
      meta: Object.keys(meta).length > 0 ? meta : undefined,
    };
  });
}

export async function scrollToBottom(page: Page): Promise<void> {
  const hasBody = await page.evaluate(() => !!document.body);
  if (!hasBody) return;

  for (let step = 0; step < 15; step++) {
    const prevHeight = await page.evaluate(() => document.body.scrollHeight);

    // Track network activity triggered by scroll
    let pending = 0;
    const onReq = () => { pending++; };
    const onRes = () => { pending--; };
    page.on("request", onReq);
    page.on("response", onRes);
    page.on("requestfailed", onRes);

    await page.evaluate(() => window.scrollBy(0, window.innerHeight));

    // Brief pause to let intersection observers and requests fire
    await new Promise((r) => setTimeout(r, 150));

    if (pending > 0) {
      // Network activity detected — wait for requests to settle (max 3s)
      const deadline = Date.now() + 3000;
      while (pending > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      // Extra pause for DOM rendering after responses arrive
      await new Promise((r) => setTimeout(r, 200));
    }

    page.off("request", onReq);
    page.off("response", onRes);
    page.off("requestfailed", onRes);

    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    const atBottom = await page.evaluate(
      () => window.scrollY + window.innerHeight >= document.body.scrollHeight - 10,
    );

    if (atBottom && newHeight === prevHeight) break;
  }
}

export async function extractSemdown(page: Page): Promise<Article | null> {
  const yaml = await page.locator("body").ariaSnapshot();
  if (!yaml) return null;

  const nodes = parseAriaYaml(yaml);
  const content = treeToSemdown(nodes);
  if (!content) return null;

  const { title, excerpt, meta } = await extractMeta(page);
  return { title, excerpt, content, method: "semdown", meta };
}

export async function extractLinks(
  page: Page,
  baseUrl: string,
): Promise<string[]> {
  return page.evaluate((base: string) => {
    const urls = new Set<string>();
    for (const a of document.querySelectorAll("a[href]")) {
      try { urls.add(new URL((a as HTMLAnchorElement).href, base).href); } catch {}
    }
    for (const link of document.querySelectorAll(
      'link[rel="next"][href], link[rel="prev"][href], link[rel="alternate"][href]',
    )) {
      try { urls.add(new URL((link as HTMLLinkElement).href, base).href); } catch {}
    }
    for (const area of document.querySelectorAll("area[href]")) {
      try { urls.add(new URL((area as HTMLAreaElement).href, base).href); } catch {}
    }
    return [...urls];
  }, baseUrl);
}

export function formatArticle(article: Article): string {
  let output = `# ${article.title}\n\n`;
  if (article.excerpt) {
    output += `> ${article.excerpt}\n\n`;
  }
  output += article.content + "\n";
  return output;
}

export async function navigate(
  page: Page,
  url: string,
): Promise<void> {
  await page.goto(url, { waitUntil: "commit", timeout: 2000 });
  await page
    .waitForLoadState("domcontentloaded", { timeout: 2000 })
    .catch(() => {});
  await page
    .waitForLoadState("networkidle", { timeout: 2000 })
    .catch(() => {});
}

export async function scrapePage(
  page: Page,
  url: string,
): Promise<Article | null> {
  await navigate(page, url);
  await dismissCookieBanner(page);
  await scrollToBottom(page);
  return extractSemdown(page);
}
