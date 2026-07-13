import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("table selector", () => {
  it("does not append trailing space to CSS selector in $eval", () => {
    const src = readFileSync(
      resolve(__dirname, "../commands/table.ts"),
      "utf-8",
    );
    // Match $eval(sel + " " which is the buggy pattern
    const hasBug = /\$eval\(sel \+ " "/.test(src);
    assert.ok(
      !hasBug,
      'table.ts should not append trailing space to selector in $eval (sel + " ")',
    );
  });
});
