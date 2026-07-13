import { describe, test } from "node:test";
import assert from "node:assert";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cli, go, serverUrl, tmpDir } from "./helpers.ts";

describe("reader", () => {
  test("extracts markdown from URL", () => {
    const out = join(tmpDir, "reader-direct.md");
    cli("extract", "reader", `${serverUrl}/`, "--output", out);
    const content = readFileSync(out, "utf-8");
    assert.match(content, /^# /);
    assert.ok(statSync(out).size >= 30);
    assert.match(content, /Home/);
  });

  test("reader works on current page without URL", () => {
    go("/about");
    const out = join(tmpDir, "reader-current.md");
    cli("extract", "reader", "--output", out);
    assert.match(readFileSync(out, "utf-8"), /About/);
  });

  test("reader preserves nested div content", () => {
    const out = join(tmpDir, "reader-nested.md");
    cli("extract", "reader", `${serverUrl}/article`, "--output", out);
    const content = readFileSync(out, "utf-8");
    assert.match(content, /Section One/);
    assert.match(content, /Section Two/);
    assert.match(content, /nested divs that must not be lost/);
    assert.match(content, /Final paragraph/);
    assert.match(content, /Item alpha/);
  });
});
