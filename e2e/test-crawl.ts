import { describe, test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { cli, go, tmpDir } from "./helpers.ts";

function countPages(file: string): number {
  const content = readFileSync(file, "utf-8");
  return (content.match(/^## /gm) || []).length;
}

function crawlMerge(depth: number, limit: number, out: string): string {
  const r = cli("crawl", "--depth", `${depth}`, "--limit", `${limit}`, "--merge", "--output", out, "--rate", "0");
  return r.stderr;
}

describe("crawl", () => {
  test("depth=1 limits to direct children", () => {
    const out = join(tmpDir, "t1.md");
    go("/");
    crawlMerge(1, 20, out);
    const content = readFileSync(out, "utf-8");
    assert.match(content, /Home/);
    assert.match(content, /About/);
    assert.match(content, /Blog/);
    assert.match(content, /Products/);
    assert.doesNotMatch(content, /^## Post One/m);
  });

  test("--limit caps total pages", () => {
    const out = join(tmpDir, "t2.md");
    go("/");
    crawlMerge(3, 10, out);
    assert.ok(countPages(out) <= 11); // seed + 10
  });

  test("cycle detection", () => {
    const out = join(tmpDir, "t3.md");
    go("/cycle/a");
    crawlMerge(5, 20, out);
    const content = readFileSync(out, "utf-8");
    assert.match(content, /Cycle A/);
    assert.match(content, /Cycle B/);
    assert.match(content, /Cycle C/);
    assert.ok(countPages(out) <= 6);
  });

  test("infinite trap stopped by limit", () => {
    const out = join(tmpDir, "t4.md");
    go("/trap/1");
    crawlMerge(10, 5, out);
    assert.ok(countPages(out) >= 5 && countPages(out) <= 6); // seed + limit
  });

  test("sitemap discovery", () => {
    const out = join(tmpDir, "t5.md");
    go("/");
    crawlMerge(0, 10, out);
    const content = readFileSync(out, "utf-8");
    assert.match(content, /Sitemap Only 1/);
    assert.match(content, /Sitemap Only 2/);
  });

  test("resilience against errors", () => {
    const out = join(tmpDir, "t6.md");
    go("/");
    crawlMerge(2, 10, out);
    assert.match(readFileSync(out, "utf-8"), /Home/);
    assert.ok(countPages(out) >= 5);
  });

  test("directory output mode", () => {
    const out = join(tmpDir, "t7-dir");
    go("/");
    cli("crawl", "--depth", "1", "--limit", "10", "--output", out, "--rate", "0");
    const count = execSync(`find "${out}" -name '*.md' | wc -l`).toString().trim();
    assert.ok(parseInt(count) >= 2);
  });

  test("per-page timing in output", () => {
    const out = join(tmpDir, "t8.md");
    go("/");
    const stderr = crawlMerge(0, 5, out);
    assert.match(stderr, /\[1\] .+ OK [0-9]+\.[0-9]+s/);
  });

  test("limit reached completion reason", () => {
    const out = join(tmpDir, "t9a.md");
    go("/");
    const stderr = crawlMerge(2, 2, out);
    assert.match(stderr, /limit reached/);
  });

  test("crawl complete when queue exhausted", () => {
    const out = join(tmpDir, "t9b.md");
    go("/blog/post-3");
    const stderr = crawlMerge(0, 100, out);
    assert.match(stderr, /crawl complete/);
  });

  test("done line shows total elapsed time", () => {
    const out = join(tmpDir, "t10.md");
    go("/");
    const stderr = crawlMerge(2, 2, out);
    assert.match(stderr, /Done: [0-9]+ pages in [0-9]+\.[0-9]+s/);
  });

  test("follows redirects without duplicates", () => {
    const out = join(tmpDir, "t11.md");
    go("/");
    crawlMerge(1, 20, out);
    const aboutCount = (readFileSync(out, "utf-8").match(/^## About/gm) || []).length;
    assert.strictEqual(aboutCount, 1);
  });

  test("handles errors gracefully", () => {
    const out = join(tmpDir, "t12.md");
    go("/about");
    crawlMerge(1, 20, out);
    assert.match(readFileSync(out, "utf-8"), /About/);
    assert.ok(countPages(out) >= 1);
  });

  test("merge output structure", () => {
    const out = join(tmpDir, "t13.md");
    go("/");
    crawlMerge(1, 5, out);
    const content = readFileSync(out, "utf-8");
    assert.match(content, /^# Crawl:/);
    assert.ok((content.match(/^---$/gm) || []).length >= 1);
    assert.match(content, /^> http/m);
  });
});
