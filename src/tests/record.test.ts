import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const src = readFileSync(
  resolve(__dirname, "../commands/record.ts"),
  "utf-8",
);

describe("record command injection safety", () => {
  it("uses execFileSync instead of execSync for dashcam concat", () => {
    // execSync with string interpolation is a shell injection vector
    const hasUnsafeExecSync = /execSync\s*\(/.test(src);
    assert.ok(
      !hasUnsafeExecSync,
      "record.ts should not use execSync (shell injection risk) — use execFileSync instead",
    );
  });
});

describe("record proc.pid guard", () => {
  it("checks proc.pid before writing PID file in recordStart", () => {
    // Find recordStart function and extract until next export function
    const startIdx = src.indexOf("function recordStart");
    const nextExport = src.indexOf("\nexport ", startIdx + 1);
    const startBody = src.substring(startIdx, nextExport > 0 ? nextExport : undefined);

    assert.ok(startBody.length > 0, "recordStart function should exist");

    const hasPidGuard = /if\s*\(\s*!proc\.pid\s*\)/.test(startBody);
    assert.ok(
      hasPidGuard,
      "recordStart should guard against undefined proc.pid before writing PID file",
    );
  });

  it("checks proc.pid before writing PID file in recordDashcam", () => {
    // Find recordDashcam function and extract to end of file
    const dashcamIdx = src.indexOf("function recordDashcam");
    const dashcamBody = src.substring(dashcamIdx);

    assert.ok(dashcamBody.length > 0, "recordDashcam function should exist");

    const hasPidGuard = /if\s*\(\s*!proc\.pid\s*\)/.test(dashcamBody);
    assert.ok(
      hasPidGuard,
      "recordDashcam should guard against undefined proc.pid before writing PID file",
    );
  });
});

describe("record config corruption handling", () => {
  it("wraps CONFIG_FILE JSON.parse in try/catch in recordStop", () => {
    const stopIdx = src.indexOf("function recordStop");
    const nextExport = src.indexOf("\nexport ", stopIdx + 1);
    const stopBody = src.substring(stopIdx, nextExport > 0 ? nextExport : undefined);

    // JSON.parse of config file must be inside a try block
    const jsonParseIdx = stopBody.indexOf("JSON.parse");
    assert.ok(jsonParseIdx > 0, "recordStop should have JSON.parse");

    // Check that there's a try before the JSON.parse (after function start)
    const beforeParse = stopBody.substring(0, jsonParseIdx);
    const lastTry = beforeParse.lastIndexOf("try");
    assert.ok(lastTry > 0, "JSON.parse in recordStop must be wrapped in try/catch for corrupt config handling");
  });
});

describe("record poll sleep", () => {
  it("does not spawn external process for sleeping in recordStop", () => {
    const stopIdx = src.indexOf("function recordStop");
    const nextExport = src.indexOf("\nexport ", stopIdx + 1);
    const stopBody = src.substring(stopIdx, nextExport > 0 ? nextExport : undefined);

    const hasExecSleep = /execFileSync\s*\(\s*["']sleep["']/.test(stopBody);
    assert.ok(
      !hasExecSleep,
      "recordStop should not spawn external process for sleeping — use Atomics.wait instead",
    );
  });
});

describe("record save function", () => {
  it("recordSave exists and concatenates segments without stopping ffmpeg", () => {
    const hasSave = /export\s+function\s+recordSave/.test(src);
    assert.ok(hasSave, "recordSave function should be exported");
  });

  it("recordSave does not kill ffmpeg", () => {
    const saveIdx = src.indexOf("function recordSave");
    assert.ok(saveIdx > 0, "recordSave function should exist");
    const nextExport = src.indexOf("\nexport ", saveIdx + 1);
    const saveBody = src.substring(saveIdx, nextExport > 0 ? nextExport : undefined);

    const killsProcess = /process\.kill\s*\(/.test(saveBody);
    assert.ok(
      !killsProcess,
      "recordSave should not kill ffmpeg — it saves without stopping the recording",
    );
  });

  it("recordSave requires active recording", () => {
    const saveIdx = src.indexOf("function recordSave");
    const nextExport = src.indexOf("\nexport ", saveIdx + 1);
    const saveBody = src.substring(saveIdx, nextExport > 0 ? nextExport : undefined);

    const checksMode = /dashcam/.test(saveBody);
    assert.ok(
      checksMode,
      "recordSave should check that recording mode is dashcam",
    );
  });
});

describe("record HLS segment sort order", () => {
  it("sorts segments numerically, not lexicographically", () => {
    // Extract the .sort() call on segments in recordStop's dashcam branch
    const segmentSortMatch = src.match(
      /\.filter\(.*?\.endsWith\(.*?\.ts.*?\)\)\s*\.sort\(([^;]*)\)/,
    );
    assert.ok(segmentSortMatch, "should find .filter().sort() on HLS segments");

    const sortArg = segmentSortMatch[1].trim();
    assert.ok(
      sortArg.length > 0,
      "segment .sort() must use a comparator for numeric ordering — bare .sort() breaks with 10+ segments",
    );
  });
});

// `web2 record dashcam --seconds N` is documented as "Restart dashcam with
// custom buffer size", and the dashcam is always running by design. Bailing
// out when a recording exists therefore made the command impossible to run:
// every invocation hit "Error: recording already in progress". Restarting is
// the whole point, so it must replace the running recorder instead.
describe("record dashcam restarts instead of refusing", () => {
  function dashcamBody(): string {
    const startIdx = src.indexOf("function recordDashcam");
    assert.ok(startIdx >= 0, "recordDashcam not found in record.ts");
    const nextExport = src.indexOf("\nexport ", startIdx + 1);
    return src.substring(startIdx, nextExport > 0 ? nextExport : undefined);
  }

  it("does not abort when a recording is already running", () => {
    assert.ok(
      !/already in progress/.test(dashcamBody()),
      "recordDashcam refuses while a recording runs, but the dashcam always runs",
    );
  });

  it("terminates the running recorder before starting the new one", () => {
    const body = dashcamBody();
    assert.ok(
      /PID_FILE/.test(body),
      "recordDashcam must notice an existing recorder via the pid file",
    );
    assert.ok(
      /kill|recordStop|stopRecording/.test(body),
      "recordDashcam must stop the running recorder before replacing it",
    );
  });
});
