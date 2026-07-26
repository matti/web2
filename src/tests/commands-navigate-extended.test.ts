import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeNavigationUrl } from "../lib/url.js";

const navSrc = readFileSync(join(import.meta.dirname, "../commands/navigate.ts"), "utf-8");

// This block used to re-declare the normalization inline, so it mirrored
// whatever the implementation did and could never fail. It imports the real
// function now.
describe("navigate URL normalization", () => {
  it("prepends http:// for bare domains", () => {
    assert.equal(normalizeNavigationUrl("example.com"), "http://example.com");
    assert.equal(normalizeNavigationUrl("example.com/path"), "http://example.com/path");
  });

  it("preserves http:// URLs", () => {
    assert.equal(normalizeNavigationUrl("http://example.com"), "http://example.com");
  });

  it("preserves https:// URLs", () => {
    assert.equal(normalizeNavigationUrl("https://example.com"), "https://example.com");
  });

  it("is case-insensitive for protocol", () => {
    assert.equal(normalizeNavigationUrl("HTTP://example.com"), "HTTP://example.com");
    assert.equal(normalizeNavigationUrl("HTTPS://example.com"), "HTTPS://example.com");
  });

  it("handles localhost", () => {
    assert.equal(normalizeNavigationUrl("localhost:3000"), "http://localhost:3000");
  });

  it("handles IP addresses", () => {
    assert.equal(normalizeNavigationUrl("192.168.1.1:8080"), "http://192.168.1.1:8080");
  });

  // Regression: the check only recognized http/https, so every other scheme
  // got an http:// prefix glued on. `file:///tmp/x.html` became
  // `http://file///tmp/x.html` and died with ERR_NAME_NOT_RESOLVED.
  it("preserves file:// URLs", () => {
    assert.equal(
      normalizeNavigationUrl("file:///Users/x/page.html"),
      "file:///Users/x/page.html",
    );
  });

  it("preserves schemes that carry no authority", () => {
    assert.equal(normalizeNavigationUrl("about:blank"), "about:blank");
    assert.equal(normalizeNavigationUrl("data:text/html,<h1>hi</h1>"), "data:text/html,<h1>hi</h1>");
  });

  it("preserves other explicit schemes", () => {
    assert.equal(normalizeNavigationUrl("ws://localhost:9222"), "ws://localhost:9222");
    assert.equal(normalizeNavigationUrl("FILE:///tmp/x"), "FILE:///tmp/x");
  });

  // A host:port pair looks like a scheme to a naive regex; it must not.
  it("still prefixes host:port that resembles a scheme", () => {
    assert.equal(normalizeNavigationUrl("myhost:8080/path"), "http://myhost:8080/path");
  });
});

describe("navigate wait strategy mapping", () => {
  const waitMap: Record<string, "commit" | "domcontentloaded" | "networkidle"> = {
    commit: "commit",
    load: "domcontentloaded",
    idle: "networkidle",
  };

  function resolveWait(wait?: string): string {
    return waitMap[wait ?? "load"] ?? "domcontentloaded";
  }

  it("defaults to domcontentloaded when no --wait", () => {
    assert.equal(resolveWait(), "domcontentloaded");
  });

  it("maps 'commit' to commit", () => {
    assert.equal(resolveWait("commit"), "commit");
  });

  it("maps 'load' to domcontentloaded", () => {
    assert.equal(resolveWait("load"), "domcontentloaded");
  });

  it("maps 'idle' to networkidle", () => {
    assert.equal(resolveWait("idle"), "networkidle");
  });

  it("falls back to domcontentloaded for unknown", () => {
    assert.equal(resolveWait("unknown"), "domcontentloaded");
    assert.equal(resolveWait("fast"), "domcontentloaded");
  });
});

describe("navigate redirect tracking", () => {
  function isRedirect(status: number): boolean {
    return status >= 300 && status < 400;
  }

  it("detects 3xx as redirect", () => {
    assert.ok(isRedirect(301));
    assert.ok(isRedirect(302));
    assert.ok(isRedirect(307));
    assert.ok(isRedirect(308));
  });

  it("does not flag 2xx as redirect", () => {
    assert.ok(!isRedirect(200));
    assert.ok(!isRedirect(204));
  });

  it("does not flag 4xx/5xx as redirect", () => {
    assert.ok(!isRedirect(404));
    assert.ok(!isRedirect(500));
  });
});

describe("navigate network log", () => {
  it("writes to web-network.json under STATE_DIR", () => {
    assert.ok(navSrc.includes("web-network.json"));
    assert.ok(navSrc.includes("STATE_DIR"));
  });

  it("captures URL, method, status, type, size per entry", () => {
    assert.ok(navSrc.includes("url: request.url()"));
    assert.ok(navSrc.includes("method: request.method()"));
    assert.ok(navSrc.includes("status,"));
    assert.ok(navSrc.includes("type: request.resourceType()"));
    assert.ok(navSrc.includes("content-length"));
  });

  it("swallows network capture errors", () => {
    // The response handler has try/catch with empty catch
    assert.ok(navSrc.includes("} catch {"));
  });

  it("swallows waitForLoadState timeouts", () => {
    assert.ok(navSrc.includes(".catch(() => {})"));
  });

  it("shows ??? for missing status", () => {
    assert.ok(navSrc.includes('"???"'));
  });

  it("uses 15s timeout for goto", () => {
    assert.ok(navSrc.includes("timeout: 15000"));
  });
});

describe("navigate output format", () => {
  function formatOutput(status: number | string, url: string, ms: number): string {
    return `${status} ${url} (${ms}ms)`;
  }

  function formatRedirect(status: number, from: string, to: string, ms: number): string {
    return `${status} ${from} -> ${to} (${ms}ms)`;
  }

  it("formats final status line", () => {
    assert.equal(formatOutput(200, "https://example.com", 150), "200 https://example.com (150ms)");
  });

  it("formats redirect line", () => {
    assert.equal(
      formatRedirect(302, "https://a.com", "https://b.com", 50),
      "302 https://a.com -> https://b.com (50ms)",
    );
  });

  it("shows ??? when status is 0", () => {
    assert.equal(formatOutput("???", "https://example.com", 100), "??? https://example.com (100ms)");
  });
});
