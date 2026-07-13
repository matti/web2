import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSource(relPath: string): string {
  return readFileSync(resolve(__dirname, relPath), "utf-8");
}

/**
 * Verify that every CDP session (newCDPSession → send → detach) is wrapped
 * in try/finally so detach() is always called even when send() throws.
 *
 * Pattern we require:
 *   newCDPSession(...)
 *   try { ... cdp.send(...) ... } finally { ... cdp.detach() ... }
 *
 * Pattern we reject:
 *   newCDPSession(...)
 *   cdp.send(...)
 *   cdp.detach()    ← not reachable if send() throws
 */
function assertCDPSessionsProtected(src: string, file: string): void {
  // Find all CDP session blocks: newCDPSession up to detach
  const cdpBlocks = src.split(/newCDPSession/).slice(1);

  for (const block of cdpBlocks) {
    // Each block should have a try before send, and detach in finally
    const sendIdx = block.indexOf("cdp.send(");
    const detachIdx = block.indexOf("cdp.detach(");
    const tryIdx = block.indexOf("try");
    const finallyIdx = block.indexOf("finally");

    assert.ok(sendIdx > 0, `${file}: CDP session has send() call`);
    assert.ok(detachIdx > 0, `${file}: CDP session has detach() call`);
    assert.ok(
      tryIdx > 0 && tryIdx < sendIdx,
      `${file}: CDP send() must be inside a try block`,
    );
    assert.ok(
      finallyIdx > 0 && finallyIdx < detachIdx,
      `${file}: CDP detach() must be inside a finally block`,
    );
  }
}

describe("CDP session safety", () => {
  it("cookies.ts wraps all CDP sessions in try/finally", () => {
    const src = readSource("../commands/cookies.ts");
    assertCDPSessionsProtected(src, "cookies.ts");
  });

  it("tab.ts wraps all CDP sessions in try/finally (reference pattern)", () => {
    const src = readSource("../commands/tab.ts");
    assertCDPSessionsProtected(src, "tab.ts");
  });

  it("browser.ts wraps all CDP sessions in try/finally", () => {
    const src = readSource("../lib/browser.ts");
    assertCDPSessionsProtected(src, "browser.ts");
  });
});
