import { describe, test, before } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cli, go, serverUrl, tmpDir } from "./helpers.ts";

describe("home page", () => {
  before(() => go("/"));

  test("source contains DOCTYPE and title", () => {
    const { stdout } = cli("extract", "source");
    assert.match(stdout, /<!DOCTYPE html>/);
    assert.match(stdout, /<title>Home<\/title>/);
  });

  test("snapshot contains heading and content", () => {
    const { stdout } = cli("extract", "accessibility");
    assert.match(stdout, /home/i);
    assert.match(stdout, /welcome/i);
  });

  test("snapshot --format aria contains heading role", () => {
    const { stdout } = cli("extract", "accessibility", "--format", "aria");
    assert.match(stdout, /heading/);
  });

  test("exec evaluates JavaScript", () => {
    assert.match(cli("exec", "document.title").stdout, /Home/);
    assert.match(cli("exec", "1 + 2").stdout, /3/);
    assert.match(cli("exec", "undefined").stdout, /undefined/);
  });

  test("screenshot creates file", () => {
    const out = join(tmpDir, "test-screenshot.png");
    cli("page", "screenshot", "--output", out);
    assert.ok(existsSync(out));
    assert.ok(statSync(out).size > 100);
  });

  test("screenshot --selector is smaller than full page", () => {
    const full = join(tmpDir, "ss-full.png");
    const sel = join(tmpDir, "ss-sel.png");
    cli("page", "screenshot", "--output", full);
    cli("page", "screenshot", "--output", sel, "--selector", "h1");
    assert.ok(statSync(sel).size < statSync(full).size);
  });

  test("network shows requests", () => {
    go("/");
    const { stdout } = cli("network");
    assert.match(stdout, /requests captured/);
    assert.match(stdout, /STATUS/);
  });

  test("network --json returns array", () => {
    const { stdout } = cli("network", "--json");
    assert.match(stdout, /^\[/);
  });

  test("reader extracts markdown", () => {
    const out = join(tmpDir, "md-cmd-test.md");
    cli("extract", "reader", `${serverUrl}/`, "--output", out);
    const content = readFileSync(out, "utf-8");
    assert.match(content, /^# /);
    assert.match(content, /Home/);
  });
});
