import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("tab navigation safety", () => {
  const src = readFileSync(
    resolve(__dirname, "../commands/tab.ts"),
    "utf-8",
  );

  it("tabNext guards against empty pages before modulo", () => {
    // Extract tabNext function body
    const match = src.match(/export async function tabNext\b[\s\S]*?^}/m);
    assert.ok(match, "tabNext function not found");
    const body = match[0];
    const hasGuard = /pages\.length\s*===\s*0/.test(body);
    assert.ok(hasGuard, "tabNext must guard against pages.length === 0");
  });

  it("tabPrevious guards against empty pages before modulo", () => {
    const match = src.match(/export async function tabPrevious\b[\s\S]*?^}/m);
    assert.ok(match, "tabPrevious function not found");
    const body = match[0];
    const hasGuard = /pages\.length\s*===\s*0/.test(body);
    assert.ok(hasGuard, "tabPrevious must guard against pages.length === 0");
  });

  it("tabClose calls bringToFront on new active tab after closing", () => {
    const match = src.match(/export async function tabClose\b[\s\S]*?^}/m);
    assert.ok(match, "tabClose function not found");
    const body = match[0];
    const hasBringToFront = /bringToFront\s*\(/.test(body);
    assert.ok(hasBringToFront, "tabClose must call bringToFront() on new active tab after closing (matching tabSelect/tabNext/tabPrevious pattern)");
  });
});
