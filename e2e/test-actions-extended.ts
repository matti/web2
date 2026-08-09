import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cli, go, tmpDir } from "./helpers.ts";

// One navigation per describe: each test writes to a different element, so
// they do not need a fresh page - and a navigation costs a CLI round trip.
describe("click and fill options", () => {
  before(() => go("/form"));

  test("fill --clear empties an existing value", () => {
    assert.strictEqual(cli("do", "fill", "#name", "Ada Lovelace").status, 0);

    const cleared = cli("do", "fill", "#name", "--clear");
    assert.strictEqual(cleared.status, 0);
    assert.match(cleared.stderr, /Filled: #name/);
    assert.strictEqual(cli("exec", "document.querySelector('#name').value").stdout, '""');
  });

  test("double click dispatches a real dblclick event", () => {
    const clicked = cli("do", "click", "#double-btn", "--double");
    assert.strictEqual(clicked.status, 0);
    assert.match(clicked.stderr, /Clicked: #double-btn/);
    assert.strictEqual(cli("exec", "document.querySelector('#result').textContent").stdout, '"double-clicked"');
  });

  test("right click dispatches a contextmenu event", () => {
    const clicked = cli("do", "click", "#context-target", "--right");
    assert.strictEqual(clicked.status, 0);
    assert.match(clicked.stderr, /Clicked: #context-target/);
    assert.strictEqual(cli("exec", "document.querySelector('#result').textContent").stdout, '"right-clicked"');
  });
});

describe("file upload", () => {
  before(() => go("/upload"));

  test("uploads one file and exposes it to the page", () => {
    const file = join(tmpDir, "e2e-upload-one.txt");
    writeFileSync(file, "first upload\n");

    const uploaded = cli("do", "upload", "#single-file", file);
    assert.strictEqual(uploaded.status, 0);
    assert.match(uploaded.stderr, /Uploaded: #single-file/);
    assert.strictEqual(
      cli("exec", "document.querySelector('#single-result').textContent").stdout,
      '"e2e-upload-one.txt:13"',
    );
  });

  test("uploads multiple files in argument order", () => {
    const first = join(tmpDir, "e2e-upload-alpha.txt");
    const second = join(tmpDir, "e2e-upload-beta.txt");
    writeFileSync(first, "alpha");
    writeFileSync(second, "beta value");

    const uploaded = cli("do", "upload", "#multiple-files", first, second);
    assert.strictEqual(uploaded.status, 0);
    assert.match(uploaded.stderr, /e2e-upload-alpha\.txt/);
    assert.match(uploaded.stderr, /e2e-upload-beta\.txt/);
    assert.deepStrictEqual(
      JSON.parse(cli("exec", "Array.from(document.querySelector('#multiple-files').files, f => `${f.name}:${f.size}`)").stdout),
      ["e2e-upload-alpha.txt:5", "e2e-upload-beta.txt:10"],
    );
  });

  test("missing upload file fails without altering the current page", () => {
    const missing = join(tmpDir, "file-that-does-not-exist.txt");
    const uploaded = cli("do", "upload", "#single-file", missing);
    assert.strictEqual(uploaded.status, 1);
    assert.match(uploaded.stderr, /Error: file not found:/);
    assert.strictEqual(cli("exec", "document.title").stdout, '"Upload Page"');
  });
});
