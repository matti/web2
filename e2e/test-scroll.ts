import { describe, test, before } from "node:test";
import assert from "node:assert";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { cli, go, tmpDir } from "./helpers.ts";

describe("scroll + full-page screenshot", () => {
  before(() => go("/scroll-page"));

  test("scroll down reports position", () => {
    assert.match(cli("do", "scroll", "down").stderr, /Scrolled to/);
  });

  test("scroll top reports 0", () => {
    assert.match(cli("do", "scroll", "top").stderr, /Scrolled to 0\//);
  });

  test("scroll bottom reports position", () => {
    assert.match(cli("do", "scroll", "bottom").stderr, /Scrolled to/);
  });

  test("scroll by pixels reports position", () => {
    cli("do", "scroll", "top");
    assert.match(cli("do", "scroll", "200").stderr, /Scrolled to/);
  });

  test("scroll up reports position", () => {
    assert.match(cli("do", "scroll", "up").stderr, /Scrolled to/);
  });

  test("full-page screenshot is larger than viewport", () => {
    const full = join(tmpDir, "ss-full.png");
    const view = join(tmpDir, "ss-view.png");
    cli("page", "screenshot", "--output", full, "--full-page");
    cli("page", "screenshot", "--output", view);
    assert.ok(existsSync(full));
    assert.ok(statSync(full).size > statSync(view).size);
  });
});
