import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("crawl limit boundary", () => {
  it("uses strict less-than for limit check, not less-than-or-equal", () => {
    const src = readFileSync(
      resolve(__dirname, "../commands/crawl.ts"),
      "utf-8",
    );

    // The BFS loop condition should use `< limit`, not `<= limit`
    const hasOffByOne = /results\.length\s*<=\s*limit/.test(src);
    assert.ok(
      !hasOffByOne,
      "crawl.ts should use 'results.length < limit' not '<= limit' (off-by-one bug)",
    );
  });
});

describe("crawl sitemap URL limit", () => {
  it("breaks outer while loop when sitemap URL limit reached, not just inner for", () => {
    const src = readFileSync(
      resolve(__dirname, "../commands/crawl.ts"),
      "utf-8",
    );

    // Find the discoverSitemapUrls function
    const fnStart = src.indexOf("async function discoverSitemapUrls");
    const fnEnd = src.indexOf("\nasync function", fnStart + 1);
    const fn = src.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);

    // The 10000 limit check must appear OUTSIDE the inner for loop
    // (i.e., after the for loop closes, still inside the while loop)
    // to properly break the outer while loop
    const innerForBlock = fn.match(/for \(const m of text\.matchAll.*?<url>[\s\S]*?\}/);
    assert.ok(innerForBlock, "should have inner for loop for <url> matching");

    // After the inner for loop, there should be a limit check that breaks the while
    const afterInnerFor = fn.slice(fn.indexOf(innerForBlock![0]) + innerForBlock![0].length);
    const hasOuterBreak = /if\s*\(urls\.length\s*>=\s*10000\)\s*break/.test(afterInnerFor);
    assert.ok(
      hasOuterBreak,
      "discoverSitemapUrls must check url limit AFTER inner for loop to break outer while loop",
    );
  });
});
