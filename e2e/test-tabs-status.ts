import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { cli, go, serverUrl } from "./helpers.ts";

describe("status and tab lifecycle", () => {
  before(() => go("/"));

  test("status reports the active page in text and JSON formats", () => {
    const text = cli("status");
    assert.strictEqual(text.status, 0);
    assert.match(text.stdout, new RegExp(`url:\\s+${serverUrl}/`));
    assert.match(text.stdout, /title:\s+Home/);
    assert.match(text.stdout, /viewport:\s+(?:\d+x\d+|unknown)/);
    assert.match(text.stdout, /tabs:\s+1/);

    const jsonResult = cli("status", "--json");
    assert.strictEqual(jsonResult.status, 0);
    const status = JSON.parse(jsonResult.stdout);
    assert.deepStrictEqual(
      {
        ok: status.ok,
        url: status.url,
        title: status.title,
        tabs: status.tabs,
      },
      {
        ok: true,
        url: `${serverUrl}/`,
        title: "Home",
        tabs: 1,
      },
    );
    assert.ok(Object.hasOwn(status, "viewport"));
  });

  test("creates a background tab and lists both tabs in stable order", () => {
    const created = cli("tab", "create", `${serverUrl}/about`);
    assert.strictEqual(created.status, 0);
    assert.match(created.stdout, /^[0-9a-f]+$/i);
    assert.match(created.stderr, /Created tab \[1\]/);

    const listed = cli("tab", "list");
    assert.strictEqual(listed.status, 0);
    assert.match(listed.stdout, new RegExp(`^\\* \\[0\\] Home - ${serverUrl}/$`, "m"));
    assert.match(listed.stdout, new RegExp(`^  \\[1\\] About - ${serverUrl}/about$`, "m"));
    assert.strictEqual((listed.stdout.match(/^\*/gm) || []).length, 1);
  });

  test("select, previous, and next change the active page", () => {
    const selected = cli("tab", "select", "1");
    assert.strictEqual(selected.status, 0);
    assert.match(selected.stderr, /Switched to tab \[1\] About/);
    assert.match(selected.stderr, new RegExp(`→ ${serverUrl}/about - "About"`));
    assert.strictEqual(JSON.parse(cli("status", "--json").stdout).title, "About");

    // The grounding line is read off the live page, so it proves the active
    // tab actually changed - a separate status call would only cost a round
    // trip to learn the same thing.
    const back = cli("tab", "previous");
    assert.match(back.stderr, /Switched to tab \[0\] Home/);
    assert.match(back.stderr, new RegExp(`→ ${serverUrl}/ - "Home"`));

    const forward = cli("tab", "next");
    assert.match(forward.stderr, /Switched to tab \[1\] About/);
    assert.match(forward.stderr, new RegExp(`→ ${serverUrl}/about - "About"`));
  });

  test("rejects an invalid tab index without changing the active tab", () => {
    const invalid = cli("tab", "select", "99");
    assert.strictEqual(invalid.status, 1);
    assert.match(invalid.stderr, /Tab 99 does not exist \(2 tabs open\)/);
    assert.strictEqual(JSON.parse(cli("status", "--json").stdout).title, "About");
  });

  test("closes a tab and refuses to close the last remaining tab", () => {
    const closed = cli("tab", "close", "0");
    assert.strictEqual(closed.status, 0);
    assert.match(closed.stderr, /Closed tab \[0\]/);

    const status = JSON.parse(cli("status", "--json").stdout);
    assert.strictEqual(status.tabs, 1);
    assert.strictEqual(status.title, "About");

    const last = cli("tab", "close");
    assert.strictEqual(last.status, 1);
    assert.match(last.stderr, /Cannot close the last tab/);
    assert.strictEqual(JSON.parse(cli("status", "--json").stdout).tabs, 1);
  });
});
