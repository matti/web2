import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groundingLine } from "../lib/grounding.js";

// The grounding line is a documented output contract (CLAUDE.md: "Page-
// mutating commands end with a grounding line on stderr"). Agents parse it,
// so the separator is not cosmetic - it drifted to an em-dash once and only
// an e2e regex noticed.
describe("grounding line", () => {
  it("matches the documented format", () => {
    assert.strictEqual(
      groundingLine("https://example.com/login", "Sign in"),
      '→ https://example.com/login - "Sign in"\n',
    );
  });

  it("uses a plain hyphen, never an em-dash or en-dash", () => {
    const line = groundingLine("https://example.com", "Title");
    assert.ok(
      !/[\u2013\u2014]/.test(line),
      `grounding line contains an en/em-dash: ${JSON.stringify(line)}`,
    );
  });

  it("still renders when the page has no title", () => {
    assert.strictEqual(groundingLine("https://example.com", ""), '→ https://example.com - ""\n');
  });
});
