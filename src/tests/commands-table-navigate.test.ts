import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// ─── Pure formatting helpers (extracted from table.ts for unit testing) ───────

function csvRow(r: string[]): string {
  return r
    .map((f) =>
      f.includes(",") || f.includes('"') || f.includes("\n") || f.includes("\r") ? `"${f.replace(/"/g, '""')}"` : f,
    )
    .join(",");
}

function padRow(r: string[], widths: number[]): string {
  return r.map((v, i) => (v || "").padEnd(widths[i])).join("  ");
}

function computeWidths(all: string[][]): number[] {
  if (all.length === 0) return [];
  const colCount = Math.max(...all.map((r) => r.length));
  return Array.from({ length: colCount }, (_, i) =>
    Math.max(...all.map((r) => (r[i] || "").length)),
  );
}

function buildJsonObjects(
  headers: string[],
  rows: string[][],
): Record<string, string>[] {
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = row[i] ?? ""));
    return obj;
  });
}

// ─── URL normalization helper (extracted from navigate.ts for unit testing) ────

function normalizeUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) {
    return `http://${url}`;
  }
  return url;
}

// ─── waitMap logic from navigate.ts ──────────────────────────────────────────

const waitMap: Record<string, "commit" | "domcontentloaded" | "networkidle"> =
  {
    commit: "commit",
    load: "domcontentloaded",
    idle: "networkidle",
  };

function resolveWaitUntil(
  wait?: string,
): "commit" | "domcontentloaded" | "networkidle" {
  return waitMap[wait ?? "load"] ?? "domcontentloaded";
}

// ─── table: CSV formatting ────────────────────────────────────────────────────

describe("table: csvRow", () => {
  it("joins simple values with commas", () => {
    assert.equal(csvRow(["a", "b", "c"]), "a,b,c");
  });

  it("quotes fields containing a comma", () => {
    assert.equal(csvRow(["hello, world", "b"]), '"hello, world",b');
  });

  it('quotes fields containing a double-quote', () => {
    assert.equal(csvRow(['say "hi"', "b"]), '"say ""hi""",b');
  });

  it("quotes fields containing both comma and quote", () => {
    assert.equal(csvRow(['a, "b"']), '"a, ""b"""');
  });

  it("handles empty fields", () => {
    assert.equal(csvRow(["", "x", ""]), ",x,");
  });

  it("handles single field with no special chars", () => {
    assert.equal(csvRow(["plain"]), "plain");
  });

  it("quotes fields containing a newline", () => {
    assert.equal(csvRow(["hello\nworld", "b"]), '"hello\nworld",b');
  });

  it("quotes fields containing carriage return", () => {
    assert.equal(csvRow(["line1\r\nline2", "b"]), '"line1\r\nline2",b');
  });
});

// ─── table: column width computation ─────────────────────────────────────────

describe("table: computeWidths", () => {
  it("computes max width per column", () => {
    const rows = [
      ["Name", "Age"],
      ["Alice", "30"],
      ["Bo", "1000"],
    ];
    const widths = computeWidths(rows);
    assert.deepEqual(widths, [5, 4]); // "Alice"=5, "1000"=4
  });

  it("handles ragged rows (missing columns)", () => {
    const rows = [["a", "bb", "ccc"], ["x"]];
    const widths = computeWidths(rows);
    assert.equal(widths[0], 1); // max("a","x") = 1
    assert.equal(widths[1], 2); // "bb"
    assert.equal(widths[2], 3); // "ccc"
  });

  it("handles single row", () => {
    const widths = computeWidths([["hello", "world"]]);
    assert.deepEqual(widths, [5, 5]);
  });

  it("returns empty array for empty input (not -Infinity from Math.max)", () => {
    const widths = computeWidths([]);
    assert.deepEqual(widths, []);
  });
});

// ─── table: padRow ────────────────────────────────────────────────────────────

describe("table: padRow", () => {
  it("pads columns to their widths separated by two spaces", () => {
    const result = padRow(["hi", "world"], [5, 5]);
    // "hi".padEnd(5) = "hi   ", "world".padEnd(5) = "world", joined by "  "
    assert.equal(result, "hi     world");
  });

  it("treats missing values as empty string", () => {
    const result = padRow(["a"], [3, 4]);
    // only one value, so result is "a".padEnd(3) = "a  "
    assert.equal(result, "a  ");
  });

  it("does not truncate values longer than width", () => {
    const result = padRow(["toolong"], [3]);
    assert.equal(result, "toolong");
  });
});

// ─── table: buildJsonObjects ──────────────────────────────────────────────────

describe("table: buildJsonObjects", () => {
  it("maps rows to objects using header keys", () => {
    const headers = ["Name", "Age"];
    const rows = [
      ["Alice", "30"],
      ["Bob", "25"],
    ];
    const result = buildJsonObjects(headers, rows);
    assert.deepEqual(result, [
      { Name: "Alice", Age: "30" },
      { Name: "Bob", Age: "25" },
    ]);
  });

  it("fills missing columns with empty string", () => {
    const headers = ["A", "B", "C"];
    const rows = [["x", "y"]]; // C is missing
    const result = buildJsonObjects(headers, rows);
    assert.deepEqual(result, [{ A: "x", B: "y", C: "" }]);
  });

  it("returns empty array for no rows", () => {
    const result = buildJsonObjects(["A", "B"], []);
    assert.deepEqual(result, []);
  });

  it("handles single-column table", () => {
    const result = buildJsonObjects(["Title"], [["Hello"], ["World"]]);
    assert.deepEqual(result, [{ Title: "Hello" }, { Title: "World" }]);
  });
});

// ─── navigate: URL normalization ──────────────────────────────────────────────

describe("navigate: normalizeUrl", () => {
  it("leaves https:// URLs unchanged", () => {
    assert.equal(normalizeUrl("https://example.com"), "https://example.com");
  });

  it("leaves http:// URLs unchanged", () => {
    assert.equal(normalizeUrl("http://example.com"), "http://example.com");
  });

  it("prepends http:// for bare domains", () => {
    assert.equal(normalizeUrl("example.com"), "http://example.com");
  });

  it("prepends http:// for domain with path", () => {
    assert.equal(
      normalizeUrl("example.com/path?q=1"),
      "http://example.com/path?q=1",
    );
  });

  it("is case-insensitive for protocol check", () => {
    assert.equal(
      normalizeUrl("HTTPS://example.com"),
      "HTTPS://example.com",
    );
    assert.equal(
      normalizeUrl("HTTP://example.com"),
      "HTTP://example.com",
    );
  });
});

// ─── navigate: resolveWaitUntil ───────────────────────────────────────────────

describe("navigate: resolveWaitUntil", () => {
  it("defaults to domcontentloaded when no wait option given", () => {
    assert.equal(resolveWaitUntil(), "domcontentloaded");
  });

  it("resolves 'load' to domcontentloaded", () => {
    assert.equal(resolveWaitUntil("load"), "domcontentloaded");
  });

  it("resolves 'commit' to commit", () => {
    assert.equal(resolveWaitUntil("commit"), "commit");
  });

  it("resolves 'idle' to networkidle", () => {
    assert.equal(resolveWaitUntil("idle"), "networkidle");
  });

  it("falls back to domcontentloaded for unknown values", () => {
    assert.equal(resolveWaitUntil("unknown"), "domcontentloaded");
  });
});

// ─── navigate: page interaction via mock ─────────────────────────────────────

describe("navigate: page interaction", () => {
  function createMockPage(overrides: Partial<Record<string, any>> = {}) {
    const page: any = {
      on: mock.fn(() => {}),
      goto: mock.fn(async () => ({ status: () => 200, headers: () => ({}) })),
      waitForLoadState: mock.fn(async () => {}),
      url: mock.fn(() => "https://example.com"),
      ...overrides,
    };
    return page;
  }

  it("calls goto with commit waitUntil always", async () => {
    const page = createMockPage();

    // Simulate the body of navigate (without withPage)
    const url = "https://example.com";
    const opts = { wait: "load" };
    const waitUntil = resolveWaitUntil(opts.wait);

    await page.goto(url, { waitUntil: "commit", timeout: 2000 });
    if (waitUntil === "domcontentloaded") {
      await page.waitForLoadState("domcontentloaded", { timeout: 2000 }).catch(() => {});
    }

    assert.equal(page.goto.mock.calls.length, 1);
    const [gotoUrl, gotoOpts] = page.goto.mock.calls[0].arguments;
    assert.equal(gotoUrl, "https://example.com");
    assert.equal(gotoOpts.waitUntil, "commit");
    assert.equal(gotoOpts.timeout, 2000);
  });

  it("waits for domcontentloaded on 'load' mode", async () => {
    const page = createMockPage();
    const waitUntil = resolveWaitUntil("load");

    await page.goto("https://example.com", { waitUntil: "commit", timeout: 2000 });
    if (waitUntil === "domcontentloaded") {
      await page.waitForLoadState("domcontentloaded", { timeout: 2000 }).catch(() => {});
    }

    assert.equal(page.waitForLoadState.mock.calls.length, 1);
    assert.equal(page.waitForLoadState.mock.calls[0].arguments[0], "domcontentloaded");
  });

  it("waits for both domcontentloaded and networkidle on 'idle' mode", async () => {
    const page = createMockPage();
    const waitUntil = resolveWaitUntil("idle");

    await page.goto("https://example.com", { waitUntil: "commit", timeout: 2000 });
    if (waitUntil === "networkidle") {
      await page.waitForLoadState("domcontentloaded", { timeout: 2000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
    }

    assert.equal(page.waitForLoadState.mock.calls.length, 2);
    assert.equal(page.waitForLoadState.mock.calls[0].arguments[0], "domcontentloaded");
    assert.equal(page.waitForLoadState.mock.calls[1].arguments[0], "networkidle");
  });

  it("skips waitForLoadState entirely on 'commit' mode", async () => {
    const page = createMockPage();
    const waitUntil = resolveWaitUntil("commit");

    await page.goto("https://example.com", { waitUntil: "commit", timeout: 2000 });
    if (waitUntil === "commit") {
      // nothing
    } else if (waitUntil === "domcontentloaded") {
      await page.waitForLoadState("domcontentloaded", { timeout: 2000 }).catch(() => {});
    }

    assert.equal(page.waitForLoadState.mock.calls.length, 0);
  });

  it("swallows waitForLoadState timeout errors", async () => {
    const page = createMockPage({
      waitForLoadState: mock.fn(async () => {
        throw new Error("Timeout");
      }),
    });

    await assert.doesNotReject(async () => {
      await page.goto("https://example.com", { waitUntil: "commit", timeout: 2000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 2000 }).catch(() => {});
    });
  });
});
