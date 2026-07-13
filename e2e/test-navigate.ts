import { describe, test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cli, go, serverUrl, tmpDir } from "./helpers.ts";

describe("dialog, reader, and navigate --wait", () => {
  test("dialog content appears in snapshot", () => {
    go("/dialog-page");
    const { stdout } = cli("extract", "accessibility");
    assert.match(stdout, /cookies/i);
    assert.match(stdout, /Dialog Page/i);
    assert.match(stdout, /Main content/i);
  });

  test("reader works on current page without URL", () => {
    go("/about");
    const out = join(tmpDir, "md-current.md");
    cli("extract", "reader", "--output", out);
    assert.match(readFileSync(out, "utf-8"), /About/);
  });

  test("navigate --wait load", () => {
    cli("go", `${serverUrl}/about`, "--wait", "load");
    assert.match(cli("extract", "accessibility").stdout, /about/i);
  });

  test("navigate --wait commit", () => {
    cli("go", `${serverUrl}/blog`, "--wait", "commit");
    assert.match(cli("extract", "accessibility").stdout, /blog/i);
  });
});
