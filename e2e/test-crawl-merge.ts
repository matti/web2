import { describe, test } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cli, go, tmpDir } from "./helpers.ts";

describe("crawl --merge", () => {
  test("produces merged output file", () => {
    const out = join(tmpDir, "crawl-merged.md");
    go("/");
    cli("crawl", "--depth", "0", "--limit", "1", "--merge", "--output", out, "--rate", "0");
    assert.ok(existsSync(out));
    const content = readFileSync(out, "utf-8");
    assert.match(content, /^# Crawl:/);
    assert.ok(statSync(out).size >= 50);
  });
});
