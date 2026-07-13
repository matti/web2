import { describe, test } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cli, go, serverUrl, tmpDir } from "./helpers.ts";

describe("interactions", () => {
  test("click by selector", () => {
    go("/form");
    assert.match(cli("do", "click", "#click-btn").stderr, /Clicked: #click-btn/);
    assert.match(cli("exec", "document.getElementById('result').textContent").stdout, /clicked/);
  });

  test("click by text", () => {
    go("/form");
    assert.match(cli("do", "click", "_", "--text", "Click Me").stderr, /Clicked: Click Me/);
    assert.match(cli("exec", "document.getElementById('result').textContent").stdout, /clicked/);
  });

  test("fill input", () => {
    go("/form");
    assert.match(cli("do", "fill", "#name", "John Doe").stderr, /Filled: #name/);
    assert.match(cli("exec", "document.getElementById('name').value").stdout, /John Doe/);
  });

  test("fill textarea", () => {
    assert.match(cli("do", "fill", "#message", "Hello world").stderr, /Filled: #message/);
    assert.match(cli("exec", "document.getElementById('message').value").stdout, /Hello world/);
  });

  test("type text", () => {
    go("/form");
    cli("do", "click", "#name");
    assert.match(cli("do", "type", "test input").stderr, /Typed: 10 characters/);
  });

  test("type --selector", () => {
    go("/form");
    assert.match(cli("do", "type", "typed text", "--selector", "#email").stderr, /Typed: 10 characters/);
    assert.match(cli("exec", "document.getElementById('email').value").stdout, /typed text/);
  });

  test("press key", () => {
    assert.match(cli("do", "press", "Tab").stderr, /Pressed: Tab/);
  });

  test("select dropdown", () => {
    go("/form");
    assert.match(cli("do", "select", "#color", "green").stderr, /Selected: green/);
    assert.match(cli("exec", "document.getElementById('color').value").stdout, /green/);
  });

  test("hover shows tooltip", () => {
    go("/hover");
    assert.match(cli("do", "hover", "#hover-target").stderr, /Hovered: #hover-target/);
    assert.match(cli("exec", "document.getElementById('tooltip').style.display").stdout, /block/);
  });
});

describe("wait", () => {
  test("wait for selector", () => {
    go("/delayed");
    assert.match(cli("wait", "#delayed-content", "--timeout", "3000").stderr, /Ready: #delayed-content/);
  });

  test("wait for text", () => {
    go("/delayed");
    assert.match(
      cli("wait", "text:Delayed content appeared", "--timeout", "3000").stderr,
      /Ready: text:Delayed content appeared/,
    );
  });

  test("wait timeout exits 1", () => {
    go("/form");
    const r = cli("wait", "#nonexistent", "--timeout", "500");
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /Timeout/);
  });

  test("wait network-idle", () => {
    go("/");
    assert.match(cli("wait", "network-idle", "--timeout", "3000").stderr, /Ready: network-idle/);
  });
});

describe("extract on interaction pages", () => {
  test("text output has tagged elements", () => {
    go("/form");
    const { stdout } = cli("extract", "text");
    assert.match(stdout, /url:/);
    assert.match(stdout, /button:/);
    assert.match(stdout, /label:/);
  });

  test("extract h1", () => {
    go("/");
    assert.match(cli("extract", "selector", "h1").stdout, /Home/);
  });

  test("extract --all returns multiple lines", () => {
    const { stdout } = cli("extract", "selector", "a", "--all");
    assert.ok(stdout.split("\n").length >= 3);
  });

  test("extract --attr href", () => {
    assert.match(cli("extract", "selector", "a", "--attr", "href").stdout, /\/about/);
  });

  test("extract --json", () => {
    assert.match(cli("extract", "selector", "h1", "--json").stdout, /"text"/);
  });

  test("extract nonexistent reports no elements", () => {
    const r = cli("extract", "selector", "#nonexistent");
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /No elements/);
  });
});

describe("table with selector", () => {
  test("table #products", () => {
    go("/table-page");
    const { stdout } = cli("extract", "table", "#products");
    assert.match(stdout, /Name/);
    assert.match(stdout, /Widget/);
    assert.match(stdout, /---/);
  });

  test("table #products --json", () => {
    const { stdout } = cli("extract", "table", "#products", "--json");
    assert.match(stdout, /"Name"/);
    assert.match(stdout, /Gadget/);
  });

  test("table #products --csv", () => {
    const { stdout } = cli("extract", "table", "#products", "--csv");
    assert.match(stdout, /Name,Price,Stock/);
    assert.match(stdout, /Doohickey/);
  });

  test("table nonexistent exits 1", () => {
    go("/");
    assert.strictEqual(cli("extract", "table", "#nonexistent").status, 1);
  });
});

describe("pdf", () => {
  test("pdf creates file", () => {
    go("/printable");
    const out = join(tmpDir, "test-output.pdf");
    const r = cli("pdf", "--output", out);
    assert.ok(existsSync(out));
    assert.ok(statSync(out).size > 100);
    assert.match(r.stderr, /PDF saved/);
  });
});

describe("viewport", () => {
  test("resize", () => {
    assert.match(cli("viewport", "resize", "800", "600").stderr, /Viewport: 800x600/);
    assert.match(cli("exec", "window.innerWidth").stdout, /800/);
  });

  test("size", () => {
    assert.match(cli("viewport", "size").stdout, /800x600/);
  });

  test("preset mobile", () => {
    assert.match(cli("viewport", "preset", "mobile").stderr, /Viewport: 375x667/);
    assert.match(cli("viewport", "size").stdout, /375x667/);
  });

  test("rotate", () => {
    assert.match(cli("viewport", "rotate").stderr, /Viewport: 667x375/);
    assert.match(cli("viewport", "size").stdout, /667x375/);
  });
});
