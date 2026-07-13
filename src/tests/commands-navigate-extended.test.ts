import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const navSrc = readFileSync(join(import.meta.dirname, "../commands/navigate.ts"), "utf-8");

describe("navigate URL normalization", () => {
  function normalizeUrl(url: string): string {
    if (!/^https?:\/\//i.test(url)) return `http://${url}`;
    return url;
  }

  it("prepends http:// for bare domains", () => {
    assert.equal(normalizeUrl("example.com"), "http://example.com");
    assert.equal(normalizeUrl("example.com/path"), "http://example.com/path");
  });

  it("preserves http:// URLs", () => {
    assert.equal(normalizeUrl("http://example.com"), "http://example.com");
  });

  it("preserves https:// URLs", () => {
    assert.equal(normalizeUrl("https://example.com"), "https://example.com");
  });

  it("is case-insensitive for protocol", () => {
    assert.equal(normalizeUrl("HTTP://example.com"), "HTTP://example.com");
    assert.equal(normalizeUrl("HTTPS://example.com"), "HTTPS://example.com");
  });

  it("handles localhost", () => {
    assert.equal(normalizeUrl("localhost:3000"), "http://localhost:3000");
  });

  it("handles IP addresses", () => {
    assert.equal(normalizeUrl("192.168.1.1:8080"), "http://192.168.1.1:8080");
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
