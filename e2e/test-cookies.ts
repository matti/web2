import { describe, test, before } from "node:test";
import assert from "node:assert";
import { cli, go } from "./helpers.ts";

describe("cookies + dismiss", () => {
  before(() => go("/cookies-page"));

  test("cookies list shows table with cookies", () => {
    const { stdout } = cli("cookies", "list");
    assert.match(stdout, /NAME/);
    assert.match(stdout, /mockCookie/);
    assert.match(stdout, /testSession/);
  });

  test("cookies --json has name fields", () => {
    const { stdout } = cli("cookies", "list", "--json");
    assert.match(stdout, /"name"/);
    assert.match(stdout, /"mockCookie"/);
  });

  test("cookies clear empties cookie jar", () => {
    assert.match(cli("cookies", "clear").stderr, /cleared/);
    assert.match(cli("cookies", "list").stderr, /No cookies/);
  });

  test("do dismiss reports dismissed", () => {
    assert.match(cli("do", "dismiss").stderr, /dismissed/);
  });
});
