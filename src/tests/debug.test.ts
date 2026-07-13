import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const debugSrc = readFileSync(join(import.meta.dirname, "../lib/debug.ts"), "utf-8");

describe("debug module", () => {
  it("checks WEB_DEBUG env var", () => {
    assert.ok(debugSrc.includes('process.env.WEB_DEBUG === "1"'));
  });

  it("returns early when disabled", () => {
    assert.ok(debugSrc.includes("if (!enabled) return"));
  });

  it("formats timestamp with milliseconds", () => {
    assert.ok(debugSrc.includes("toTimeString"));
    assert.ok(debugSrc.includes("getMilliseconds"));
    assert.ok(debugSrc.includes("padStart(3"));
  });

  it("writes to stderr", () => {
    assert.ok(debugSrc.includes("process.stderr.write"));
  });
});
