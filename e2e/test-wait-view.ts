import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cli, cliWithEnv, go } from "./helpers.ts";

// Split out of test-actions-extended so it gets its own Chromium and runs in
// parallel: the two wait conditions are timer-bound and dominated the group.
describe("wait conditions", () => {
  // The page records its starting state (see /wait-states in mock-server), so
  // these assert on a real transition without a pre-wait CLI round trip that
  // would consume the timer window and make the test load-sensitive.
  test("wait hidden: observes an element disappearing", () => {
    assert.match(go("/wait-states").stdout, /^200 /);

    const waited = cli("wait", "hidden:#spinner", "--timeout", "3000");
    assert.strictEqual(waited.status, 0);
    assert.match(waited.stderr, /Ready: hidden:#spinner/);
    assert.strictEqual(
      cli("exec", "window.__spinnerExisted && document.querySelector('#spinner') === null").stdout,
      "true",
    );
  });

  test("wait url: observes a client-side URL transition", () => {
    assert.match(go("/wait-states").stdout, /^200 /);

    const waited = cli("wait", "url:**/wait-complete", "--timeout", "3000");
    assert.strictEqual(waited.status, 0);
    assert.match(waited.stderr, /Ready: url:\*\*\/wait-complete/);
    assert.strictEqual(cli("exec", "window.__initialPath").stdout, '"/wait-states"');
    assert.match(cli("status", "--json").stdout, /\/wait-complete/);
  });
});

describe("terminal view", () => {
  test("page view renders the live page as ANSI art", () => {
    go("/");
    // Blank the terminal hints so view falls back to ANSI instead of an
    // iTerm2 inline image, which is not assertable.
    const viewed = cliWithEnv(
      { TERM_PROGRAM: "", LC_TERMINAL: "" },
      "page",
      "view",
      "--width",
      "20",
    );
    assert.strictEqual(viewed.status, 0);
    assert.match(viewed.stdout, /\x1b\[38;2;\d+;\d+;\d+m/);
    assert.match(viewed.stdout, /\x1b\[0m/);
  });
});
