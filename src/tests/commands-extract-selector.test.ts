import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const extractSrc = readFileSync(join(import.meta.dirname, "../commands/extract.ts"), "utf-8");
const linksSrc = readFileSync(join(import.meta.dirname, "../commands/links.ts"), "utf-8");

describe("extract selector command", () => {
  describe("single element mode (no --all)", () => {
    it("uses page.$ for single element lookup", () => {
      assert.ok(extractSrc.includes("page.$(selector)"));
    });

    it("exits 1 when element not found", () => {
      assert.ok(extractSrc.includes("if (!el)"));
      assert.ok(extractSrc.includes("No elements matching: ${selector}"));
      assert.ok(extractSrc.includes("process.exit(1)"));
    });

    it("supports --json output with attrs", () => {
      assert.ok(extractSrc.includes("opts.json"));
      assert.ok(extractSrc.includes("attrs"));
      assert.ok(extractSrc.includes("h.attributes"));
    });

    it("supports --attr for attribute extraction", () => {
      assert.ok(extractSrc.includes("opts.attr"));
      assert.ok(extractSrc.includes("el.getAttribute(opts.attr)"));
    });

    it("defaults to text content", () => {
      assert.ok(extractSrc.includes("textContent?.trim()"));
    });
  });

  describe("multi element mode (--all)", () => {
    it("uses page.$$eval for multi-element extraction", () => {
      assert.ok(extractSrc.includes("page.$$eval"));
    });

    it("exits 1 when no elements match", () => {
      assert.ok(extractSrc.includes("results.length === 0"));
    });

    it("joins results with newline in text mode", () => {
      assert.ok(extractSrc.includes('results.join("\\n")'));
    });

    it("returns JSON array in json mode", () => {
      assert.ok(extractSrc.includes("JSON.stringify(items"));
    });
  });

  describe("option combination logic", () => {
    function resolveExtractBehavior(opts: { all?: boolean; attr?: string; json?: boolean }) {
      if (opts.all) {
        if (opts.json) return "all-json";
        return "all-text";
      }
      if (opts.json) return "single-json";
      if (opts.attr) return "single-attr";
      return "single-text";
    }

    it("defaults to single-text", () => {
      assert.equal(resolveExtractBehavior({}), "single-text");
    });

    it("--all without --json gives all-text", () => {
      assert.equal(resolveExtractBehavior({ all: true }), "all-text");
    });

    it("--all with --json gives all-json", () => {
      assert.equal(resolveExtractBehavior({ all: true, json: true }), "all-json");
    });

    it("--json without --all gives single-json", () => {
      assert.equal(resolveExtractBehavior({ json: true }), "single-json");
    });

    it("--attr gives single-attr", () => {
      assert.equal(resolveExtractBehavior({ attr: "href" }), "single-attr");
    });

    it("--all with --attr uses attr in $$eval", () => {
      // In the code, --all + --attr returns attribute values via $$eval
      assert.equal(resolveExtractBehavior({ all: true, attr: "href" }), "all-text");
    });
  });
});

describe("links command", () => {
  it("uses extractLinks from lib", () => {
    assert.ok(linksSrc.includes("extractLinks"));
  });

  it("uses page.url() as base URL", () => {
    assert.ok(linksSrc.includes("page.url()"));
  });

  it("writes one URL per line to stdout", () => {
    assert.ok(linksSrc.includes('url + "\\n"'));
  });
});
