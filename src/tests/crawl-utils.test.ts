import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { slugify, dedupeSlug, normalizeUrl, checkPathVariant, RateLimiter } from "../lib/crawl-utils.js";

describe("slugify", () => {
  it("converts path segments to hyphenated slug", () => {
    assert.equal(slugify("https://example.com/foo/bar"), "foo-bar");
  });

  it("returns 'index' for root URL", () => {
    assert.equal(slugify("https://example.com/"), "index");
    assert.equal(slugify("https://example.com"), "index");
  });

  it("handles trailing slash", () => {
    assert.equal(slugify("https://example.com/foo/"), "foo");
  });

  it("replaces special chars with hyphens", () => {
    assert.equal(slugify("https://example.com/foo%20bar"), "foo-20bar");
  });

  it("folds to lowercase", () => {
    assert.equal(slugify("https://example.com/Foo/BAR"), "foo-bar");
  });

  it("appends query fingerprint for different query params", () => {
    const s1 = slugify("https://example.com/page?page=1");
    const s2 = slugify("https://example.com/page?page=2");
    assert.notEqual(s1, s2);
    assert.ok(s1.startsWith("page-"));
    assert.ok(s2.startsWith("page-"));
  });

  it("produces same slug for same query params regardless of order", () => {
    const s1 = slugify("https://example.com/page?a=1&b=2");
    const s2 = slugify("https://example.com/page?b=2&a=1");
    assert.equal(s1, s2);
  });

  it("ignores hash", () => {
    assert.equal(slugify("https://example.com/page#top"), "page");
  });

  it("returns base slug with no query", () => {
    assert.equal(slugify("https://example.com/page"), "page");
  });
});

describe("dedupeSlug", () => {
  it("returns slug unchanged when no collision", () => {
    const used = new Set<string>();
    assert.equal(dedupeSlug("page", used), "page");
    assert.ok(used.has("page"));
  });

  it("appends -2 on first collision", () => {
    const used = new Set<string>(["page"]);
    assert.equal(dedupeSlug("page", used), "page-2");
    assert.ok(used.has("page-2"));
  });

  it("increments suffix on multiple collisions", () => {
    const used = new Set<string>(["page", "page-2", "page-3"]);
    assert.equal(dedupeSlug("page", used), "page-4");
    assert.ok(used.has("page-4"));
  });

  it("tracks all generated slugs in the set", () => {
    const used = new Set<string>();
    dedupeSlug("a", used);
    dedupeSlug("a", used);
    dedupeSlug("a", used);
    assert.deepEqual([...used].sort(), ["a", "a-2", "a-3"]);
  });
});

describe("normalizeUrl", () => {
  it("strips hash", () => {
    assert.equal(normalizeUrl("https://example.com/page#top"), "https://example.com/page");
  });

  it("strips tracking params", () => {
    assert.equal(
      normalizeUrl("https://example.com/page?utm_source=twitter&foo=bar"),
      "https://example.com/page?foo=bar",
    );
  });

  it("strips fbclid and gclid", () => {
    const result = normalizeUrl("https://example.com/page?fbclid=abc&gclid=def&real=1");
    assert.equal(result, "https://example.com/page?real=1");
  });

  it("sorts query params for canonical form", () => {
    assert.equal(
      normalizeUrl("https://example.com/page?z=1&a=2"),
      normalizeUrl("https://example.com/page?a=2&z=1"),
    );
  });

  it("preserves trailing slash", () => {
    assert.equal(normalizeUrl("https://example.com/path/"), "https://example.com/path/");
  });

  it("preserves path without trailing slash", () => {
    assert.equal(normalizeUrl("https://example.com/path"), "https://example.com/path");
  });

  it("leaves clean URLs with query params intact", () => {
    assert.equal(
      normalizeUrl("https://example.com/page?page=2"),
      "https://example.com/page?page=2",
    );
  });

  it("handles URLs with no query or hash", () => {
    assert.equal(
      normalizeUrl("https://example.com/foo/bar"),
      "https://example.com/foo/bar",
    );
  });

  it("returns cleaned result for non-parseable URLs", () => {
    assert.equal(normalizeUrl("not-a-url#hash"), "not-a-url");
  });
});

describe("checkPathVariant", () => {
  it("accepts first variant of a path", () => {
    const map = new Map<string, number>();
    assert.equal(checkPathVariant("https://example.com/page?v=1", map), true);
  });

  it("accepts up to 10 variants per path", () => {
    const map = new Map<string, number>();
    for (let i = 1; i <= 10; i++) {
      assert.equal(checkPathVariant(`https://example.com/page?v=${i}`, map), true);
    }
    assert.equal(checkPathVariant("https://example.com/page?v=11", map), false);
  });

  it("tracks paths independently", () => {
    const map = new Map<string, number>();
    for (let i = 1; i <= 10; i++) {
      checkPathVariant(`https://example.com/a?v=${i}`, map);
    }
    // /b should still be accepted
    assert.equal(checkPathVariant("https://example.com/b?v=1", map), true);
  });

  it("returns true for non-parseable URLs", () => {
    const map = new Map<string, number>();
    assert.equal(checkPathVariant("not-a-url", map), true);
  });
});

describe("RateLimiter", () => {
  it("returns immediately when rps is 0 (unlimited)", async () => {
    const limiter = new RateLimiter(0);
    const start = Date.now();
    await limiter.wait();
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `expected < 50ms, got ${elapsed}ms`);
  });

  it("allows burst up to rps without delay", async () => {
    const limiter = new RateLimiter(3);
    const start = Date.now();
    await limiter.wait();
    await limiter.wait();
    await limiter.wait();
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `expected < 50ms, got ${elapsed}ms`);
  });

  it("delays when burst exceeds rps", async () => {
    const limiter = new RateLimiter(2);
    const start = Date.now();
    await limiter.wait();
    await limiter.wait();
    await limiter.wait(); // 3rd call should block until window expires
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 900, `expected >= 900ms, got ${elapsed}ms`);
  });
});

