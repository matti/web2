import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import {
  extractSemdown,
  scrollToBottom,
  extractLinks,
  formatArticle,
  dismissCookieBanner,
  navigate as navPage,
} from "../lib/extract.js";
import { screenshotPage } from "../lib/screenshot.js";
import {
  slugify,
  dedupeSlug,
  normalizeUrl,
  checkPathVariant,
  RateLimiter,
  type CrawlResult,
} from "../lib/crawl-utils.js";
import { withPage, withBrowser } from "../lib/browser.js";
import { blockNonEssentialResources } from "../lib/extract.js";

interface CrawlOpts {
  depth?: number;
  limit?: number;
  merge?: boolean;
  output?: string;
  rate?: number;
  retry?: number;
  screenshots?: boolean;
  screenshotFullPage?: boolean;
  scroll?: string;
  saveDom?: boolean;
  fast?: boolean;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

async function discoverSitemapUrls(origin: string): Promise<string[]> {
  const urls: string[] = [];
  const sitemapUrls: string[] = [];

  try {
    const resp = await globalThis.fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) {
      const text = await resp.text();
      for (const line of text.split("\n")) {
        const match = line.match(/^\s*Sitemap:\s*(.+)/i);
        if (match) sitemapUrls.push(match[1].trim());
      }
    }
  } catch {}

  if (!sitemapUrls.some((u) => u.endsWith("/sitemap.xml"))) {
    sitemapUrls.push(`${origin}/sitemap.xml`);
  }

  const fetched = new Set<string>();
  const pending = [...sitemapUrls];

  while (pending.length > 0) {
    const sitemapUrl = pending.pop()!;
    if (fetched.has(sitemapUrl)) continue;
    fetched.add(sitemapUrl);

    try {
      const resp = await globalThis.fetch(sitemapUrl, {
        signal: AbortSignal.timeout(2000),
      });
      if (!resp.ok) continue;
      const text = await resp.text();

      for (const m of text.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/gi)) {
        pending.push(m[1].trim());
      }
      for (const m of text.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/gi)) {
        urls.push(m[1].trim());
        if (urls.length >= 10000) break;
      }
    } catch { /* network/parse errors are non-fatal for sitemap discovery */ }
    if (urls.length >= 10000) break;
  }

  return urls;
}

async function resolveOrigin(seedUrl: string): Promise<string> {
  try {
    const resp = await globalThis.fetch(seedUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(2000),
    });
    return new URL(resp.url).origin;
  } catch {
    return new URL(seedUrl).origin;
  }
}

function loadExistingPages(resumeDir: string): { results: CrawlResult[]; visitedUrls: Set<string> } {
  const pagesDir = resumeDir;
  const results: CrawlResult[] = [];
  const visitedUrls = new Set<string>();

  if (!existsSync(pagesDir)) return { results, visitedUrls };

  let files: string[];
  try {
    files = readdirSync(pagesDir).filter((f) => f.endsWith(".json"));
  } catch {
    return { results, visitedUrls };
  }

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(pagesDir, file), "utf-8"));
      if (data.url && data.article) {
        visitedUrls.add(data.url);
        results.push({ url: data.url, slug: data.slug, article: data.article });
      }
    } catch {}
  }

  return { results, visitedUrls };
}

function writePageJson(resumeDir: string, result: CrawlResult, usedSlugs: Set<string>): void {
  const pagesDir = resumeDir;
  mkdirSync(pagesDir, { recursive: true });
  const slug = dedupeSlug(result.slug, usedSlugs);
  const data = {
    url: result.url,
    slug,
    article: result.article,
    scrapedAt: new Date().toISOString(),
  };
  writeFileSync(join(pagesDir, `${slug}.json`), JSON.stringify(data, null, 2));
}

function getOutputDir(merge: boolean, output: string): string {
  if (merge) return output.replace(/\.md$/, "");
  return output;
}

function writeResults(
  results: CrawlResult[],
  startUrl: string,
  merge: boolean,
  output: string,
  screenshots: boolean,
): void {
  const origin = new URL(startUrl).hostname;

  if (merge) {
    const outPath = output.endsWith(".md") ? output : `${output}.md`;

    let content = `# Crawl: ${origin}\n> ${results.length} pages scraped\n\n`;
    for (const r of results) {
      content += `---\n\n## ${r.article.title}\n> ${r.url}\n\n`;
      content += r.article.content + "\n\n";
    }

    writeFileSync(outPath, content);
    process.stderr.write(`\nMerged output: ${outPath}\n`);
    if (screenshots) {
      const ssDir = output.replace(/\.md$/, "") + "-screenshots";
      process.stderr.write(`Screenshots: ${ssDir}/\n`);
    }
  } else {
    mkdirSync(output, { recursive: true });
    const usedSlugs = new Set<string>();

    let index = `# Crawl: ${origin}\n> ${results.length} pages scraped\n\n`;
    for (const r of results) {
      const slug = dedupeSlug(r.slug, usedSlugs);
      const filename = `${slug}.md`;
      writeFileSync(join(output, filename), formatArticle(r.article));
      index += `- [${r.article.title}](${filename}) — ${r.url}\n`;
    }

    writeFileSync(join(output, "_index.md"), index);
    process.stderr.write(`\nOutput directory: ${output}/\n`);
  }
}

// ---------------------------------------------------------------------------
// Sequential BFS crawler using withPage (no newContext)
// ---------------------------------------------------------------------------

interface QueueItem {
  url: string;
  depth: number;
}

async function doScroll(page: import("playwright").Page, mode: string): Promise<void> {
  if (mode === "no") return;
  if (mode === "random") {
    const height = await page.evaluate(() => document.body.scrollHeight);
    const target = Math.floor(Math.random() * height);
    await page.evaluate((y) => window.scrollTo(0, y), target);
    await new Promise((r) => setTimeout(r, 200));
    return;
  }
  await scrollToBottom(page);
}

async function scrapeSinglePage(
  page: import("playwright").Page,
  url: string,
  retry: number,
  scrollMode: string,
  captureDom: boolean,
  fastNav: boolean,
): Promise<{ article: import("../lib/extract.js").Article | null; links: string[]; finalUrl: string; dom?: string }> {
  let retriesLeft = retry;
  while (true) {
    try {
      if (fastNav) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 3000 });
      } else {
        await navPage(page, url);
      }
      await dismissCookieBanner(page);
      await doScroll(page, scrollMode);
      const article = await extractSemdown(page);
      const finalUrl = page.url();
      const links = await extractLinks(page, finalUrl);
      const dom = captureDom ? await page.content() : undefined;
      return { article, links, finalUrl, dom };
    } catch (e: any) {
      if (retriesLeft > 0) {
        retriesLeft--;
        continue;
      }
      throw e;
    }
  }
}

export async function crawl(opts: CrawlOpts): Promise<void> {
  const depth = opts.depth != null && Number.isFinite(opts.depth) ? opts.depth : Infinity;
  const limit = opts.limit != null && Number.isFinite(opts.limit) ? opts.limit : Infinity;
  const merge = opts.merge ?? false;
  const output = opts.output ?? null; // resolved after we know the seed URL
  const fast = opts.fast ?? false;
  const rate = opts.rate ?? (fast ? 0 : 1);
  const retry = opts.retry ?? 0;
  const screenshots = opts.screenshots ?? false;
  const screenshotFullPage = opts.screenshotFullPage ?? false;
  const scrollMode = opts.scroll ?? (fast ? "no" : "bottom");
  const saveDom = opts.saveDom ?? false;

  await withPage(async (page) => {
    if (fast) {
      await blockNonEssentialResources(page.context(), { keepImages: true });
    }
    const seedUrl = page.url();
    if (!seedUrl || seedUrl === "about:blank") {
      process.stderr.write("Error: no page loaded. Run 'navigate <url>' first.\n");
      process.exit(1);
    }

    const resolvedOutput = output ?? new URL(seedUrl).hostname;

    process.stderr.write(
      `Crawling ${seedUrl} (depth=${depth}, limit=${limit}, rate=${rate}/s)\n\n`,
    );

    const t0 = performance.now();
    const results: CrawlResult[] = [];
    const pathVariants = new Map<string, number>();
    const usedSlugs = new Set<string>();
    let total = 0;
    const outputDir = getOutputDir(merge, resolvedOutput);
    const hostname = new URL(seedUrl).hostname;
    const resumeDir = join("/tmp", `.web-crawl-${hostname}`);

    // Resume support
    const existing = loadExistingPages(resumeDir);
    const visited = new Set<string>();
    if (existing.results.length > 0) {
      for (const u of existing.visitedUrls) visited.add(u);
      results.push(...existing.results);
      total = existing.results.length;
      try {
        for (const f of readdirSync(resumeDir)) {
          if (f.endsWith(".json")) usedSlugs.add(f.replace(/\.json$/, ""));
        }
      } catch {}
      process.stderr.write(`[resume] Loaded ${existing.results.length} already-scraped pages\n`);
    }

    // Screenshot dir
    let screenshotDir: string | undefined;
    if (screenshots) {
      screenshotDir = merge ? resolvedOutput.replace(/\.md$/, "") + "-screenshots" : resolvedOutput;
      mkdirSync(screenshotDir, { recursive: true });
    }

    const resolvedOrigin = await resolveOrigin(seedUrl);
    const rateLimiter = new RateLimiter(rate);
    const queue: QueueItem[] = [];
    const normalizedSeed = normalizeUrl(seedUrl);

    function enqueueLinks(links: string[], parentDepth: number): void {
      // Shuffle links to avoid hammering similar page patterns
      const shuffled = [...links];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      for (const link of shuffled) {
        const normalized = normalizeUrl(link);
        try {
          if (new URL(normalized).origin !== resolvedOrigin) continue;
        } catch {
          continue;
        }
        if (visited.has(normalized)) continue;
        if (!checkPathVariant(normalized, pathVariants)) continue;
        queue.push({ url: normalized, depth: parentDepth + 1 });
      }
    }

    // Extract current page as seed (depth 0)
    if (!visited.has(normalizedSeed)) {
      visited.add(normalizedSeed);
      const pageT0 = performance.now();
      await dismissCookieBanner(page);
      await doScroll(page, scrollMode);

      const article = await extractSemdown(page);
      const links = await extractLinks(page, page.url());
      const seedDom = saveDom ? await page.content() : undefined;
      const n = ++total;
      const pageSec = ((performance.now() - pageT0) / 1000).toFixed(1);
      enqueueLinks(links, 0);

      if (article) {
        const itemSlug = slugify(normalizedSeed);
        if (screenshotDir) {
          await screenshotPage(page, join(screenshotDir, `${itemSlug}.png`), {
            fullPage: screenshotFullPage,
          });
        }
        if (seedDom) {
          const domDir = join(outputDir, "dom");
          mkdirSync(domDir, { recursive: true });
          const meta = `<!-- web-url: ${normalizedSeed} -->\n`;
          writeFileSync(join(domDir, `${itemSlug}.html`), meta + seedDom);
        }
        process.stderr.write(`[${n}] ${normalizedSeed} OK ${pageSec}s\n`);
        const result: CrawlResult = { url: normalizedSeed, slug: itemSlug, article };
        results.push(result);
        writePageJson(resumeDir, result, usedSlugs);
      } else {
        process.stderr.write(`[${n}] ${normalizedSeed} SKIP ${pageSec}s\n`);
      }
    }

    // Sitemap discovery
    const sitemapUrls = await discoverSitemapUrls(resolvedOrigin);
    let sitemapCount = 0;
    for (const u of sitemapUrls) {
      const clean = normalizeUrl(u);
      try {
        if (new URL(clean).origin !== resolvedOrigin) continue;
      } catch {
        continue;
      }
      if (visited.has(clean)) continue;
      if (!checkPathVariant(clean, pathVariants)) continue;
      queue.push({ url: clean, depth: 0 });
      sitemapCount++;
    }
    if (sitemapCount > 0) {
      process.stderr.write(`[sitemap] Found ${sitemapCount} URLs from sitemap\n`);
    }

    // Shuffle queue to spread across different page types
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }

    // BFS with shuffled queue
    let queueIdx = 0;
    while (queueIdx < queue.length && results.length < limit) {
      const item = queue[queueIdx++];
      if (visited.has(item.url)) continue;
      if (item.depth > depth) continue;

      visited.add(item.url);
      await rateLimiter.wait();

      const pageT0 = performance.now();
      try {
        const { article, links, finalUrl, dom } = await scrapeSinglePage(page, item.url, retry, scrollMode, saveDom, fast);
        const n = ++total;
        const pageSec = ((performance.now() - pageT0) / 1000).toFixed(1);

        // Redirect dedup: if the page redirected to an already-visited URL, skip it
        const normalizedFinal = normalizeUrl(finalUrl);
        if (normalizedFinal !== item.url && visited.has(normalizedFinal)) {
          process.stderr.write(`[${n}] ${item.url} SKIP ${pageSec}s (redirect)\n`);
          continue;
        }
        visited.add(normalizedFinal);

        if (item.depth < depth) {
          enqueueLinks(links, item.depth);
        }

        if (article && results.length < limit) {
          const itemSlug = slugify(item.url);
          if (screenshotDir) {
            await screenshotPage(page, join(screenshotDir, `${itemSlug}.png`), {
              fullPage: screenshotFullPage,
            });
          }
          if (dom) {
            const domDir = join(outputDir, "dom");
            mkdirSync(domDir, { recursive: true });
            const meta = `<!-- web-url: ${item.url} -->\n`;
            writeFileSync(join(domDir, `${itemSlug}.html`), meta + dom);
          }
          process.stderr.write(`[${n}] ${item.url} OK ${pageSec}s\n`);
          const result: CrawlResult = { url: item.url, slug: itemSlug, article };
          results.push(result);
          writePageJson(resumeDir, result, usedSlugs);
        } else {
          process.stderr.write(`[${n}] ${item.url} SKIP ${pageSec}s\n`);
        }
      } catch (e: any) {
        const n = ++total;
        const pageSec = ((performance.now() - pageT0) / 1000).toFixed(1);
        process.stderr.write(`[${n}] ${item.url} FAIL ${pageSec}s: ${e.message}\n`);
      }
    }

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    const reason = results.length >= limit ? "limit reached" : "crawl complete";

    if (results.length === 0) {
      process.stderr.write(`\nNo pages could be scraped (${elapsed}s).\n`);
      process.exit(1);
    }

    writeResults(results, seedUrl, merge, resolvedOutput, screenshots);

    // Clean up resume cache
    try {
      for (const f of readdirSync(resumeDir)) unlinkSync(join(resumeDir, f));
      rmdirSync(resumeDir);
    } catch {}

    process.stderr.write(`Done: ${results.length} pages in ${elapsed}s (${reason}).\n`);
  });
}
