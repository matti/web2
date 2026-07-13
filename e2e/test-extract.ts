import { describe, test, before } from "node:test";
import assert from "node:assert";
import { cli, go, serverUrl } from "./helpers.ts";

describe("extract and table commands", () => {
  before(() => go("/table-page"));

  test("extract heading", () => {
    assert.match(cli("extract", "selector", "h1").stdout, /Products/);
  });

  test("extract --all --attr href", () => {
    const { stdout } = cli("extract", "selector", "a[href]", "--all", "--attr", "href");
    assert.match(stdout, /\/about/);
    assert.ok(stdout.split("\n").length >= 1);
  });

  test("extract all td cells", () => {
    const { stdout } = cli("extract", "selector", "td", "--all");
    assert.match(stdout, /Widget/);
    assert.match(stdout, /Gadget/);
    assert.match(stdout, /9\.99/);
  });

  test("extract nonexistent selector exits 1", () => {
    assert.strictEqual(cli("extract", "selector", ".nonexistent").status, 1);
  });

  test("extract --json returns JSON with text", () => {
    const { stdout } = cli("extract", "selector", "h1", "--json");
    assert.match(stdout, /"text"/);
    assert.match(stdout, /Products/);
  });

  test("table shows aligned columns", () => {
    const { stdout } = cli("extract", "table");
    assert.match(stdout, /Name/);
    assert.match(stdout, /Price/);
    assert.match(stdout, /Widget/);
    assert.match(stdout, /---/);
  });

  test("table --json returns array of objects", () => {
    const { stdout } = cli("extract", "table", "--json");
    assert.match(stdout, /^\[/);
    assert.match(stdout, /"Name"/);
    assert.match(stdout, /"Price"/);
    assert.match(stdout, /"Stock"/);
  });

  test("table --csv outputs comma-separated values", () => {
    const { stdout } = cli("extract", "table", "--csv");
    assert.match(stdout, /Name,Price,Stock/);
    assert.match(stdout, /Widget/);
    assert.ok(stdout.split("\n").length >= 4);
  });

  test("extract links", () => {
    go("/");
    const { stdout } = cli("extract", "links");
    assert.match(stdout, /\/about/);
    assert.match(stdout, /\/blog/);
    assert.ok(stdout.split("\n").length >= 2);
  });
});
