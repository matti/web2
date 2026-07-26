import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatCliError } from "../lib/errors.js";

const cliSrc = readFileSync(join(import.meta.dirname, "../cli.ts"), "utf-8");

// A failed navigation used to reach the caller as a raw Node crash dump:
//
//   node:internal/process/promises:394
//       triggerUncaughtException(err, true /* fromPromise */);
//   page.goto: net::ERR_BLOCKED_BY_CLIENT at http://google.com/
//   Call log: ... at wrap (/app/src/lib/browser.ts:116:18) ...
//
// Twenty lines of container-internal paths for one fact the agent needed.
describe("formatCliError", () => {
  it("reduces a navigation failure to one line naming code and URL", () => {
    const err = new Error(
      'page.goto: net::ERR_BLOCKED_BY_CLIENT at http://google.com/\nCall log:\n  - navigating to "http://google.com/", waiting until "commit"',
    );
    assert.equal(
      formatCliError(err),
      "error: navigation failed: ERR_BLOCKED_BY_CLIENT (http://google.com/)",
    );
  });

  it("handles other net:: codes the same way", () => {
    const err = new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://nope.invalid/x");
    assert.equal(
      formatCliError(err),
      "error: navigation failed: ERR_NAME_NOT_RESOLVED (https://nope.invalid/x)",
    );
  });

  it("reports timeouts as a timeout, not as a wall of call log", () => {
    const err = new Error(
      "page.goto: Timeout 15000ms exceeded.\nCall log:\n  - navigating to \"https://slow.example\"",
    );
    assert.equal(formatCliError(err), "error: timeout after 15000ms");
  });

  it("falls back to the first line for unrecognized errors", () => {
    const err = new Error("something broke\n    at foo (/app/src/x.ts:1:1)\n    at bar");
    assert.equal(formatCliError(err), "error: something broke");
  });

  it("survives non-Error throws", () => {
    assert.equal(formatCliError("plain string"), "error: plain string");
    assert.equal(formatCliError(undefined), "error: unknown error");
    assert.equal(formatCliError({ code: 7 }), "error: [object Object]");
  });

  it("never emits a multi-line message or an internal path", () => {
    const samples: unknown[] = [
      new Error("page.goto: net::ERR_ABORTED at http://x/\nCall log:\n  - x"),
      new Error("boom\n    at wrap (/app/src/lib/browser.ts:116:18)"),
      new Error("Timeout 2000ms exceeded.\nCall log:"),
      "raw",
      null,
    ];
    for (const s of samples) {
      const line = formatCliError(s);
      assert.ok(!line.includes("\n"), `multi-line output for ${String(s)}: ${line}`);
      assert.ok(!line.includes("/app/"), `leaks a container path: ${line}`);
      assert.ok(line.startsWith("error: "), `missing error prefix: ${line}`);
    }
  });
});

// The formatter is worthless unless the CLI actually routes failures through
// it. Commander's async actions reject into an unhandled rejection, which is
// what produced the crash dump in the first place.
describe("cli error wiring", () => {
  it("installs a handler for rejected async actions", () => {
    assert.ok(
      /unhandledRejection|uncaughtException|\.catch\(/.test(cliSrc),
      "cli.ts does not intercept failures from async command actions",
    );
  });

  it("routes intercepted failures through formatCliError", () => {
    assert.ok(cliSrc.includes("formatCliError"), "cli.ts never calls formatCliError");
  });

  it("exits with the command-failed code, not a crash", () => {
    assert.ok(/process\.exit\(1\)/.test(cliSrc), "cli.ts does not exit(1) on a failed command");
  });
});
