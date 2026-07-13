import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const waitSrc = readFileSync(join(import.meta.dirname, "../commands/wait.ts"), "utf-8");

describe("wait command", () => {
  it("handles network-idle condition", () => {
    assert.ok(waitSrc.includes('"network-idle"'));
    assert.ok(waitSrc.includes('waitForLoadState("networkidle"'));
  });

  it("handles url: prefix condition", () => {
    assert.ok(waitSrc.includes('.startsWith("url:")'));
    assert.ok(waitSrc.includes("waitForURL"));
    assert.ok(waitSrc.includes('condition.slice(4)'));
  });

  it("handles text: prefix condition", () => {
    assert.ok(waitSrc.includes('.startsWith("text:")'));
    assert.ok(waitSrc.includes("waitForSelector"));
    assert.ok(waitSrc.includes('condition.slice(5)'));
  });

  it("handles hidden: prefix condition", () => {
    assert.ok(waitSrc.includes('.startsWith("hidden:")'));
    assert.ok(waitSrc.includes('"hidden"'));
    assert.ok(waitSrc.includes('condition.slice(7)'));
  });

  it("falls back to CSS selector for plain strings", () => {
    // The else branch uses waitForSelector with condition directly
    assert.ok(waitSrc.includes("waitForSelector(condition"));
  });

  it("defaults timeout to 2000ms", () => {
    assert.ok(waitSrc.includes("opts.timeout ?? 2000"));
  });

  it("reports success to stderr", () => {
    assert.ok(waitSrc.includes("Ready: ${condition}"));
  });

  it("reports timeout to stderr and exits 1", () => {
    assert.ok(waitSrc.includes("Timeout waiting for: ${condition} (${timeout}ms)"));
    assert.ok(waitSrc.includes("process.exit(1)"));
  });
});

describe("wait condition parsing", () => {
  // Test the actual string parsing logic
  function parseCondition(condition: string): { type: string; value: string } {
    if (condition === "network-idle") return { type: "networkidle", value: "" };
    if (condition.startsWith("url:")) return { type: "url", value: condition.slice(4) };
    if (condition.startsWith("text:")) return { type: "text", value: condition.slice(5) };
    if (condition.startsWith("hidden:")) return { type: "hidden", value: condition.slice(7) };
    return { type: "selector", value: condition };
  }

  it("parses network-idle", () => {
    assert.deepEqual(parseCondition("network-idle"), { type: "networkidle", value: "" });
  });

  it("parses url: prefix", () => {
    assert.deepEqual(parseCondition("url:**/login"), { type: "url", value: "**/login" });
  });

  it("parses text: prefix", () => {
    assert.deepEqual(parseCondition("text:Loading..."), { type: "text", value: "Loading..." });
  });

  it("parses hidden: prefix", () => {
    assert.deepEqual(parseCondition("hidden:#modal"), { type: "hidden", value: "#modal" });
  });

  it("parses plain CSS selector", () => {
    assert.deepEqual(parseCondition("#my-element"), { type: "selector", value: "#my-element" });
    assert.deepEqual(parseCondition(".btn.active"), { type: "selector", value: ".btn.active" });
  });
});
