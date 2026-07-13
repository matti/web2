import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const snapshotSrc = readFileSync(join(import.meta.dirname, "../commands/snapshot.ts"), "utf-8");
const pdfSrc = readFileSync(join(import.meta.dirname, "../commands/pdf.ts"), "utf-8");
const execSrc = readFileSync(join(import.meta.dirname, "../commands/exec.ts"), "utf-8");
const sourceSrc = readFileSync(join(import.meta.dirname, "../commands/source.ts"), "utf-8");
const reloadSrc = readFileSync(join(import.meta.dirname, "../commands/reload.ts"), "utf-8");

describe("snapshot command", () => {
  it("defaults to semdown format", () => {
    assert.ok(snapshotSrc.includes('opts.format ?? "semdown"'));
  });

  it("handles semdown and markdown as same case", () => {
    assert.ok(snapshotSrc.includes('case "semdown"'));
    assert.ok(snapshotSrc.includes('case "markdown"'));
  });

  it("handles aria format via ariaSnapshot", () => {
    assert.ok(snapshotSrc.includes('case "aria"'));
    assert.ok(snapshotSrc.includes("ariaSnapshot()"));
  });

  it("reports error for unknown format", () => {
    assert.ok(snapshotSrc.includes("Unknown format: ${fmt}"));
    assert.ok(snapshotSrc.includes("process.exit(1)"));
  });

  it("reports error when no content extracted", () => {
    assert.ok(snapshotSrc.includes("No content extracted"));
  });

  it("uses extractSemdown and formatArticle", () => {
    assert.ok(snapshotSrc.includes("extractSemdown(page)"));
    assert.ok(snapshotSrc.includes("formatArticle(article)"));
  });
});

describe("snapshot format logic", () => {
  function resolveFormat(fmt?: string): "semdown" | "aria" | "error" {
    const f = fmt ?? "semdown";
    switch (f) {
      case "semdown":
      case "markdown": return "semdown";
      case "aria": return "aria";
      default: return "error";
    }
  }

  it("defaults to semdown", () => {
    assert.equal(resolveFormat(), "semdown");
    assert.equal(resolveFormat("semdown"), "semdown");
  });

  it("treats markdown same as semdown", () => {
    assert.equal(resolveFormat("markdown"), "semdown");
  });

  it("recognizes aria", () => {
    assert.equal(resolveFormat("aria"), "aria");
  });

  it("rejects unknown formats", () => {
    assert.equal(resolveFormat("json"), "error");
    assert.equal(resolveFormat("html"), "error");
  });
});

describe("pdf command", () => {
  it("defaults output to page.pdf", () => {
    assert.ok(pdfSrc.includes('opts.output ?? "page.pdf"'));
  });

  it("defaults format to A4", () => {
    assert.ok(pdfSrc.includes('opts.format ?? "A4"'));
  });

  it("defaults landscape to false", () => {
    assert.ok(pdfSrc.includes("opts.landscape ?? false"));
  });

  it("defaults scale to 1", () => {
    assert.ok(pdfSrc.includes("opts.scale ?? 1"));
  });

  it("reports success to stderr", () => {
    assert.ok(pdfSrc.includes("PDF saved to ${path}"));
  });

  it("catches errors and reports headless requirement", () => {
    assert.ok(pdfSrc.includes("catch (err"));
    assert.ok(pdfSrc.includes("PDF only works in headless Chromium"));
    assert.ok(pdfSrc.includes("process.exit(1)"));
  });
});

describe("exec command", () => {
  it("handles undefined result", () => {
    assert.ok(execSrc.includes('result === undefined ? "undefined"'));
  });

  it("JSON stringifies non-undefined results", () => {
    assert.ok(execSrc.includes("JSON.stringify(result, null, 2)"));
  });

  it("outputs to stdout via console.log", () => {
    assert.ok(execSrc.includes("console.log("));
  });
});

describe("exec undefined handling", () => {
  function formatExecResult(result: unknown): string {
    return result === undefined ? "undefined" : JSON.stringify(result, null, 2);
  }

  it("returns 'undefined' for undefined", () => {
    assert.equal(formatExecResult(undefined), "undefined");
  });

  it("stringifies null", () => {
    assert.equal(formatExecResult(null), "null");
  });

  it("stringifies numbers", () => {
    assert.equal(formatExecResult(42), "42");
  });

  it("stringifies strings with quotes", () => {
    assert.equal(formatExecResult("hello"), '"hello"');
  });

  it("stringifies objects with indentation", () => {
    assert.equal(formatExecResult({ a: 1 }), '{\n  "a": 1\n}');
  });

  it("stringifies arrays", () => {
    assert.equal(formatExecResult([1, 2]), '[\n  1,\n  2\n]');
  });

  it("stringifies booleans", () => {
    assert.equal(formatExecResult(true), "true");
    assert.equal(formatExecResult(false), "false");
  });
});

describe("source command", () => {
  it("uses page.content()", () => {
    assert.ok(sourceSrc.includes("page.content()"));
  });

  it("writes to stdout", () => {
    assert.ok(sourceSrc.includes("process.stdout.write(html)"));
  });
});

describe("reload command", () => {
  it("has same waitMap as navigate", () => {
    assert.ok(reloadSrc.includes('commit: "commit"'));
    assert.ok(reloadSrc.includes('load: "domcontentloaded"'));
    assert.ok(reloadSrc.includes('idle: "networkidle"'));
  });

  it("defaults wait to load", () => {
    assert.ok(reloadSrc.includes('opts.wait ?? "load"'));
  });

  it("uses 2000ms timeout for reload", () => {
    assert.ok(reloadSrc.includes("timeout: 2000"));
  });

  it("reports URL and timing to stdout", () => {
    assert.ok(reloadSrc.includes("page.url()"));
    assert.ok(reloadSrc.includes("elapsed}ms"));
  });

  it("swallows waitForLoadState timeouts", () => {
    assert.ok(reloadSrc.includes(".catch(() => {})"));
  });
});

describe("reload waitMap logic", () => {
  const waitMap: Record<string, string> = {
    commit: "commit",
    load: "domcontentloaded",
    idle: "networkidle",
  };

  function resolveWait(wait?: string): string {
    return waitMap[wait ?? "load"] ?? "domcontentloaded";
  }

  it("defaults to domcontentloaded", () => {
    assert.equal(resolveWait(), "domcontentloaded");
    assert.equal(resolveWait("load"), "domcontentloaded");
  });

  it("resolves commit", () => {
    assert.equal(resolveWait("commit"), "commit");
  });

  it("resolves idle to networkidle", () => {
    assert.equal(resolveWait("idle"), "networkidle");
  });

  it("falls back to domcontentloaded for unknown values", () => {
    assert.equal(resolveWait("unknown"), "domcontentloaded");
  });
});
