import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const tmpDir = "/tmp/.web-test-normalize";

function setup(pages: Record<string, string>) {
  rmSync(tmpDir, { recursive: true, force: true });
  const domDir = join(tmpDir, "dom");
  mkdirSync(domDir, { recursive: true });
  for (const [name, html] of Object.entries(pages)) {
    writeFileSync(join(domDir, name), html);
  }
  return domDir;
}

function cleanup() {
  rmSync(tmpDir, { recursive: true, force: true });
}

function parseTsv(content: string): string[][] {
  return content.split("\n").filter(l => l && !l.startsWith("#")).map(l => l.split("\t"));
}

describe("normalize", () => {
  it("outputs TSV with text, context, pages, url, href columns", async () => {
    const domDir = setup({
      "p1.html": `<!-- web-url: https://example.com/p1 --><html><body><h1>Hello</h1><p>World</p><a href="/about">About</a></body></html>`,
    });

    const outFile = join(tmpDir, "out.tsv");
    const { normalize } = await import("../commands/normalize.js");
    await normalize(domDir, { output: outFile });

    const result = readFileSync(outFile, "utf-8");
    const rows = parseTsv(result);

    // Should have rows for "Hello", "World", "About"
    const texts = rows.map(r => r[0]);
    assert.ok(texts.includes("About"), "link text present");
    assert.ok(texts.includes("Hello"), "heading text present");
    assert.ok(texts.includes("World"), "paragraph text present");

    // Each row has 5 columns: text, context, pages, url, href
    for (const row of rows) {
      assert.equal(row.length, 5, `row should have 5 columns: ${row[0]}`);
    }

    // "About" row should have href
    const aboutRow = rows.find(r => r[0] === "About");
    assert.ok(aboutRow);
    assert.equal(aboutRow[1], "link");
    assert.equal(aboutRow[4], "/about");

    cleanup();
  });

  it("sorts lexicographically so typos group together", async () => {
    const domDir = setup({
      "p1.html": `<!-- web-url: https://example.com/p1 --><html><body><p>Banana</p><p>Apple</p><p>Cherry</p></body></html>`,
    });

    const outFile = join(tmpDir, "out.tsv");
    const { normalize } = await import("../commands/normalize.js");
    await normalize(domDir, { output: outFile });

    const result = readFileSync(outFile, "utf-8");
    const rows = parseTsv(result);
    const texts = rows.map(r => r[0]);

    // Should be sorted
    const sorted = [...texts].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(texts, sorted, "rows should be sorted lexicographically");

    cleanup();
  });

  it("deduplicates identical strings across pages with count", async () => {
    const domDir = setup({
      "p1.html": `<!-- web-url: https://example.com/p1 --><html><body><p>Same text</p></body></html>`,
      "p2.html": `<!-- web-url: https://example.com/p2 --><html><body><p>Same text</p></body></html>`,
      "p3.html": `<!-- web-url: https://example.com/p3 --><html><body><p>Same text</p></body></html>`,
    });

    const outFile = join(tmpDir, "out.tsv");
    const { normalize } = await import("../commands/normalize.js");
    await normalize(domDir, { output: outFile });

    const result = readFileSync(outFile, "utf-8");
    const rows = parseTsv(result);

    // "Same text" should appear once with count 3
    const sameRows = rows.filter(r => r[0] === "Same text");
    assert.equal(sameRows.length, 1, "should be deduped to one row");
    assert.equal(sameRows[0][2], "3", "should show count of 3 pages");

    cleanup();
  });

  it("uses web-url comment for page URL", async () => {
    const domDir = setup({
      "slug.html": `<!-- web-url: https://example.com/real/path --><html><body><p>Content</p></body></html>`,
    });

    const outFile = join(tmpDir, "out.tsv");
    const { normalize } = await import("../commands/normalize.js");
    await normalize(domDir, { output: outFile });

    const result = readFileSync(outFile, "utf-8");
    assert.ok(result.includes("https://example.com/real/path"), "should use web-url");

    cleanup();
  });

  it("extracts img alt text with context", async () => {
    const domDir = setup({
      "p1.html": `<html><body><img alt="A cute cat" src="/cat.jpg"><p>Text</p></body></html>`,
    });

    const outFile = join(tmpDir, "out.tsv");
    const { normalize } = await import("../commands/normalize.js");
    await normalize(domDir, { output: outFile });

    const result = readFileSync(outFile, "utf-8");
    const rows = parseTsv(result);
    const imgRow = rows.find(r => r[0] === "A cute cat");
    assert.ok(imgRow, "img alt should be extracted");
    assert.equal(imgRow[1], "img-alt");

    cleanup();
  });

  it("falls back to canonical URL when web-url comment absent", async () => {
    const domDir = setup({
      "p1.html": `<html><head><link rel="canonical" href="https://example.com/canonical"></head><body><p>Content</p></body></html>`,
    });

    const outFile = join(tmpDir, "out.tsv");
    const { normalize } = await import("../commands/normalize.js");
    await normalize(domDir, { output: outFile });

    const result = readFileSync(outFile, "utf-8");
    assert.ok(result.includes("https://example.com/canonical"), "should use canonical URL");

    cleanup();
  });

  it("falls back to og:url when no web-url or canonical", async () => {
    const domDir = setup({
      "p1.html": `<html><head><meta property="og:url" content="https://example.com/og"></head><body><p>Content</p></body></html>`,
    });

    const outFile = join(tmpDir, "out.tsv");
    const { normalize } = await import("../commands/normalize.js");
    await normalize(domDir, { output: outFile });

    const result = readFileSync(outFile, "utf-8");
    assert.ok(result.includes("https://example.com/og"), "should use og:url");

    cleanup();
  });

  it("extracts leaf node text with context", async () => {
    const domDir = setup({
      "p1.html": `<!-- web-url: https://example.com --><html><body><div><span>Leaf text</span></div></body></html>`,
    });

    const outFile = join(tmpDir, "out.tsv");
    const { normalize } = await import("../commands/normalize.js");
    await normalize(domDir, { output: outFile });

    const result = readFileSync(outFile, "utf-8");
    assert.ok(result.includes("Leaf text"), "should extract leaf node text");

    cleanup();
  });

  it("extracts table rows as joined cells", async () => {
    const domDir = setup({
      "p1.html": `<!-- web-url: https://example.com --><html><body><table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr></table></body></html>`,
    });

    const outFile = join(tmpDir, "out.tsv");
    const { normalize } = await import("../commands/normalize.js");
    await normalize(domDir, { output: outFile });

    const result = readFileSync(outFile, "utf-8");
    assert.ok(result.includes("Name | Age"), "should join header cells");
    assert.ok(result.includes("Alice | 30"), "should join data cells");

    cleanup();
  });

  it("strips script and style content", async () => {
    const domDir = setup({
      "p1.html": `<html><body><p>Hello <style>.foo{color:red}</style>world</p><script>var x=1;</script></body></html>`,
    });

    const outFile = join(tmpDir, "out.tsv");
    const { normalize } = await import("../commands/normalize.js");
    await normalize(domDir, { output: outFile });

    const result = readFileSync(outFile, "utf-8");
    assert.ok(!result.includes(".foo"), "CSS should not appear");
    assert.ok(!result.includes("var x"), "JS should not appear");

    cleanup();
  });
});
