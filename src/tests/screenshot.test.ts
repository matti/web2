import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("screenshot desktop mode", () => {
  it("uses execFileSync instead of execSync for shell safety", () => {
    // Read the source file and verify it does NOT use execSync with string interpolation
    const src = readFileSync(
      resolve(__dirname, "../commands/screenshot.ts"),
      "utf-8",
    );

    // Should NOT have execSync with template literal or string concat containing outputPath
    const hasUnsafeExecSync = /execSync\s*\(/.test(src);
    assert.ok(
      !hasUnsafeExecSync,
      "screenshot.ts should not use execSync (shell injection risk) — use execFileSync instead",
    );

    // Should use execFileSync
    const hasExecFileSync = /execFileSync\s*\(/.test(src);
    assert.ok(
      hasExecFileSync,
      "screenshot.ts should use execFileSync for safe argument passing",
    );
  });
});
