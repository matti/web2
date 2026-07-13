import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Verify that the desktop tail loop has error handling (try/catch) around captureDesktop()
// This is a structural test — the desktop tail path must catch errors like the browser tail path does.

describe("view: desktop tail error handling", () => {
  const src = readFileSync(new URL("../commands/view.ts", import.meta.url), "utf-8");

  it("desktop tail loop wraps captureDesktop in try/catch", () => {
    // Find the desktop tail block (opts.desktop branch)
    const desktopBlock = src.slice(src.indexOf("if (opts.desktop)"));
    // The block should contain a try/catch wrapping the captureDesktop call
    const hasTryCatch = /try\s*\{[\s\S]*?captureDesktop[\s\S]*?\}\s*catch/.test(desktopBlock);
    assert.ok(hasTryCatch, "desktop tail loop must wrap captureDesktop() in try/catch for error recovery");
  });

  it("desktop tail loop has reconnect message on error", () => {
    // Extract only the desktop block (between "if (opts.desktop)" and the closing brace before the browser tail)
    const start = src.indexOf("if (opts.desktop)");
    const browserTailStart = src.indexOf("while (true) {", start + 50);
    const desktopOnly = src.slice(start, browserTailStart);
    const hasReconnectMsg = desktopOnly.includes("reconnecting");
    assert.ok(hasReconnectMsg, "desktop tail block must show reconnect message on error (matching browser tail pattern)");
  });
});
