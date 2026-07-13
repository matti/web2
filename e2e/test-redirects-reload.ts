import { describe, test } from "node:test";
import assert from "node:assert";
import { cli, go, serverUrl } from "./helpers.ts";

describe("navigate output and redirects", () => {
  test("navigate shows status and timing", () => {
    const { stdout } = cli("go", `${serverUrl}/about`);
    assert.match(stdout, /^200 .+\/about.+[0-9]+ms/);
  });

  test("temporary redirect shows 302 then 200", () => {
    const { stdout } = cli("go", `${serverUrl}/redirect/temp`);
    assert.match(stdout, /^302 /m);
    assert.match(stdout, /^200 /m);
  });

  test("chained redirects show multiple 301s", () => {
    const { stdout } = cli("go", `${serverUrl}/redirect/chain`);
    const redirectCount = (stdout.match(/^301 /gm) || []).length;
    assert.ok(redirectCount >= 2);
  });
});

describe("reload", () => {
  test("reload clears page state", () => {
    go("/");
    cli("exec", "window.__testReload = 42");
    assert.match(cli("exec", "window.__testReload").stdout, /42/);

    const { stdout } = cli("reload");
    assert.match(stdout, /\/.*[0-9]+ms/);

    assert.doesNotMatch(cli("exec", "window.__testReload").stdout, /42/);
  });
});
