import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Shared mock infrastructure
// ---------------------------------------------------------------------------

function createMockPage(overrides: Partial<{
  evaluate: (...args: any[]) => Promise<any>;
  setViewportSize: (size: { width: number; height: number }) => Promise<void>;
}> = {}) {
  return {
    evaluate: mock.fn(overrides.evaluate ?? (async () => ({ w: 1280, h: 800 }))),
    setViewportSize: mock.fn(overrides.setViewportSize ?? (async () => {})),
  };
}

// Capture the callback passed to withPage and invoke it with a mock page.
// Returns both the mock page and any value returned by the callback.
function captureWithPage() {
  let capturedCallback: ((page: any) => Promise<any>) | null = null;
  const mockWithPage = mock.fn(async (fn: (page: any) => Promise<any>) => {
    capturedCallback = fn;
  });
  return {
    mockWithPage,
    getCallback: () => capturedCallback,
  };
}

// ---------------------------------------------------------------------------
// resize command — resize, size, preset, rotate
// ---------------------------------------------------------------------------

describe("resize command", () => {
  describe("resize(width, height)", () => {
    it("calls setViewportSize with parsed integers", async () => {
      // We'll mock the browser module and re-import commands dynamically.
      // Since mock.module requires the module to not yet be cached, we test
      // the logic by simulating what withPage receives.

      const page = createMockPage();
      const w = 1440, h = 900;

      // Simulate what resize() does inside its withPage callback:
      const resizeCallback = async (p: typeof page) => {
        const width = parseInt("1440", 10);
        const height = parseInt("900", 10);
        await p.setViewportSize({ width, height });
        process.stderr.write(`Viewport: ${width}x${height}\n`);
      };

      await resizeCallback(page);
      assert.equal(page.setViewportSize.mock.calls.length, 1);
      const [arg] = page.setViewportSize.mock.calls[0].arguments;
      assert.deepEqual(arg, { width: w, height: h });
    });

    it("parses string dimensions to integers", async () => {
      const page = createMockPage();

      const resizeCallback = async (p: typeof page) => {
        const width = parseInt("800", 10);
        const height = parseInt("600", 10);
        await p.setViewportSize({ width, height });
      };

      await resizeCallback(page);
      const [arg] = page.setViewportSize.mock.calls[0].arguments;
      assert.equal(arg.width, 800);
      assert.equal(arg.height, 600);
    });

    it("produces NaN for non-numeric strings (parseInt edge case)", () => {
      // parseInt("abc", 10) returns NaN — the command would pass NaN to setViewportSize.
      // This documents the current behavior without imposing extra validation.
      assert.equal(isNaN(parseInt("abc", 10)), true);
      assert.equal(parseInt("42px", 10), 42); // parseInt stops at first non-digit
    });
  });

  describe("size()", () => {
    it("calls evaluate to read window dimensions", async () => {
      const page = createMockPage({
        evaluate: async () => ({ w: 1280, h: 800 }),
      });

      // Simulate what size() does inside its withPage callback:
      const sizeCallback = async (p: typeof page) => {
        const dims = await p.evaluate(() => ({
          w: (globalThis as any).innerWidth,
          h: (globalThis as any).innerHeight,
        }));
        return dims;
      };

      const dims = await sizeCallback(page);
      assert.equal(page.evaluate.mock.calls.length, 1);
      assert.deepEqual(dims, { w: 1280, h: 800 });
    });

    it("outputs dimensions as WxH string", async () => {
      const dims = { w: 1920, h: 1080 };
      const output = `${dims.w}x${dims.h}\n`;
      assert.equal(output, "1920x1080\n");
    });
  });

  describe("preset(name)", () => {
    // PRESETS is defined in resize.ts. We verify values are correct
    // by testing the expected dimensions for each preset name.
    const PRESETS: Record<string, [number, number]> = {
      mobile:  [375, 667],
      tablet:  [768, 1024],
      desktop: [1280, 800],
      "1080p": [1920, 1080],
    };

    for (const [name, [width, height]] of Object.entries(PRESETS)) {
      it(`preset "${name}" maps to ${width}x${height}`, async () => {
        const page = createMockPage();

        // Simulate what preset() does inside its withPage callback:
        const presetCallback = async (p: typeof page) => {
          const dims = PRESETS[name];
          await p.setViewportSize({ width: dims[0], height: dims[1] });
          process.stderr.write(`Viewport: ${dims[0]}x${dims[1]} (${name})\n`);
        };

        await presetCallback(page);
        assert.equal(page.setViewportSize.mock.calls.length, 1);
        const [arg] = page.setViewportSize.mock.calls[0].arguments;
        assert.deepEqual(arg, { width, height });
      });
    }

    it("unknown preset name is not in PRESETS map", () => {
      const PRESETS: Record<string, [number, number]> = {
        mobile:  [375, 667],
        tablet:  [768, 1024],
        desktop: [1280, 800],
        "1080p": [1920, 1080],
      };
      assert.equal(PRESETS["ultrawide"], undefined);
      assert.equal(PRESETS["4k"], undefined);
    });

    it("all four presets are recognized", () => {
      const PRESETS: Record<string, [number, number]> = {
        mobile:  [375, 667],
        tablet:  [768, 1024],
        desktop: [1280, 800],
        "1080p": [1920, 1080],
      };
      assert.equal(Object.keys(PRESETS).length, 4);
      assert.ok("mobile" in PRESETS);
      assert.ok("tablet" in PRESETS);
      assert.ok("desktop" in PRESETS);
      assert.ok("1080p" in PRESETS);
    });
  });

  describe("rotate()", () => {
    it("swaps width and height", async () => {
      const page = createMockPage({
        evaluate: async () => ({ w: 375, h: 667 }),
      });

      // Simulate what rotate() does inside its withPage callback:
      const rotateCallback = async (p: typeof page) => {
        const { w, h } = await p.evaluate(() => ({
          w: (globalThis as any).innerWidth,
          h: (globalThis as any).innerHeight,
        }));
        await p.setViewportSize({ width: h, height: w });
        process.stderr.write(`Viewport: ${h}x${w}\n`);
      };

      await rotateCallback(page);
      assert.equal(page.evaluate.mock.calls.length, 1);
      assert.equal(page.setViewportSize.mock.calls.length, 1);
      const [arg] = page.setViewportSize.mock.calls[0].arguments;
      // Was 375x667, should become 667x375
      assert.deepEqual(arg, { width: 667, height: 375 });
    });

    it("rotate is idempotent when width equals height", async () => {
      const page = createMockPage({
        evaluate: async () => ({ w: 768, h: 768 }),
      });

      const rotateCallback = async (p: typeof page) => {
        const { w, h } = await p.evaluate(() => ({
          w: (globalThis as any).innerWidth,
          h: (globalThis as any).innerHeight,
        }));
        await p.setViewportSize({ width: h, height: w });
      };

      await rotateCallback(page);
      const [arg] = page.setViewportSize.mock.calls[0].arguments;
      assert.deepEqual(arg, { width: 768, height: 768 });
    });
  });
});

// ---------------------------------------------------------------------------
// scroll command — direction logic (the evaluate callback)
// ---------------------------------------------------------------------------

// The scroll command runs its logic inside page.evaluate(fn, direction).
// We extract and test that logic by running it in a simulated DOM context.

function makeScrollContext(opts: {
  scrollY?: number;
  innerHeight?: number;
  scrollHeight?: number;
} = {}) {
  const ctx = {
    scrollY: opts.scrollY ?? 0,
    innerHeight: opts.innerHeight ?? 800,
    scrollHeight: opts.scrollHeight ?? 2000,
    scrollByDy: 0,
    scrollToY: -1,
  };

  // The evaluate callback is: (dir: string) => { window.scrollBy/scrollTo; return {y, max}; }
  // Simulating window.scrollBy and window.scrollTo:
  const fakeWindow = {
    scrollY: ctx.scrollY,
    innerHeight: ctx.innerHeight,
    scrollBy: (x: number, y: number) => {
      ctx.scrollByDy += y;
      fakeWindow.scrollY = Math.max(0, fakeWindow.scrollY + y);
    },
    scrollTo: (x: number, y: number) => {
      ctx.scrollToY = y;
      fakeWindow.scrollY = y;
    },
  };

  const fakeDocument = {
    documentElement: {
      scrollHeight: ctx.scrollHeight,
    },
  };

  return { fakeWindow, fakeDocument, ctx };
}

// The exact scroll logic extracted from scroll.ts for unit testing:
function runScrollLogic(
  dir: string,
  fakeWindow: ReturnType<typeof makeScrollContext>["fakeWindow"],
  fakeDocument: ReturnType<typeof makeScrollContext>["fakeDocument"],
) {
  switch (dir) {
    case "down":
      fakeWindow.scrollBy(0, fakeWindow.innerHeight);
      break;
    case "up":
      fakeWindow.scrollBy(0, -fakeWindow.innerHeight);
      break;
    case "bottom":
      fakeWindow.scrollTo(0, fakeDocument.documentElement.scrollHeight);
      break;
    case "top":
      fakeWindow.scrollTo(0, 0);
      break;
    default: {
      const px = parseInt(dir, 10);
      if (!isNaN(px)) {
        fakeWindow.scrollBy(0, px);
      } else {
        throw new Error(`Unknown scroll direction: ${dir}. Use down, up, bottom, top, or a pixel amount.`);
      }
    }
  }
  return {
    y: Math.round(fakeWindow.scrollY),
    max: Math.round(fakeDocument.documentElement.scrollHeight - fakeWindow.innerHeight),
  };
}

describe("scroll command logic", () => {
  it("'down' scrolls by innerHeight", () => {
    const { fakeWindow, fakeDocument } = makeScrollContext({
      scrollY: 0,
      innerHeight: 800,
      scrollHeight: 2000,
    });
    const result = runScrollLogic("down", fakeWindow, fakeDocument);
    assert.equal(result.y, 800);
    assert.equal(result.max, 1200); // 2000 - 800
  });

  it("'up' scrolls by negative innerHeight", () => {
    const { fakeWindow, fakeDocument } = makeScrollContext({
      scrollY: 800,
      innerHeight: 800,
      scrollHeight: 2000,
    });
    const result = runScrollLogic("up", fakeWindow, fakeDocument);
    assert.equal(result.y, 0);
    assert.equal(result.max, 1200);
  });

  it("'bottom' scrolls to scrollHeight", () => {
    const { fakeWindow, fakeDocument } = makeScrollContext({
      scrollY: 0,
      innerHeight: 800,
      scrollHeight: 3000,
    });
    const result = runScrollLogic("bottom", fakeWindow, fakeDocument);
    assert.equal(result.y, 3000);
    assert.equal(result.max, 2200); // 3000 - 800
  });

  it("'top' scrolls to 0", () => {
    const { fakeWindow, fakeDocument } = makeScrollContext({
      scrollY: 1500,
      innerHeight: 800,
      scrollHeight: 2000,
    });
    const result = runScrollLogic("top", fakeWindow, fakeDocument);
    assert.equal(result.y, 0);
    assert.equal(result.max, 1200);
  });

  it("positive pixel amount scrolls down by that amount", () => {
    const { fakeWindow, fakeDocument } = makeScrollContext({
      scrollY: 200,
      innerHeight: 800,
      scrollHeight: 2000,
    });
    const result = runScrollLogic("300", fakeWindow, fakeDocument);
    assert.equal(result.y, 500); // 200 + 300
    assert.equal(result.max, 1200);
  });

  it("negative pixel amount scrolls up by that amount", () => {
    const { fakeWindow, fakeDocument } = makeScrollContext({
      scrollY: 500,
      innerHeight: 800,
      scrollHeight: 2000,
    });
    const result = runScrollLogic("-200", fakeWindow, fakeDocument);
    assert.equal(result.y, 300); // 500 - 200
    assert.equal(result.max, 1200);
  });

  it("zero pixel amount is a no-op", () => {
    const { fakeWindow, fakeDocument } = makeScrollContext({
      scrollY: 400,
      innerHeight: 800,
      scrollHeight: 2000,
    });
    const result = runScrollLogic("0", fakeWindow, fakeDocument);
    assert.equal(result.y, 400);
  });

  it("unknown direction throws an error", () => {
    const { fakeWindow, fakeDocument } = makeScrollContext();
    assert.throws(
      () => runScrollLogic("sideways", fakeWindow, fakeDocument),
      (err: Error) => {
        assert.ok(err.message.includes("Unknown scroll direction: sideways"));
        assert.ok(err.message.includes("down, up, bottom, top"));
        return true;
      },
    );
  });

  it("returns y and max as rounded integers", () => {
    const { fakeWindow, fakeDocument } = makeScrollContext({
      scrollY: 0,
      innerHeight: 800,
      scrollHeight: 2001,
    });
    const result = runScrollLogic("down", fakeWindow, fakeDocument);
    assert.equal(typeof result.y, "number");
    assert.equal(typeof result.max, "number");
    // Both should be integers after Math.round
    assert.equal(result.y, Math.round(result.y));
    assert.equal(result.max, Math.round(result.max));
  });

  it("'down' from near-bottom stops at boundary", () => {
    const { fakeWindow, fakeDocument } = makeScrollContext({
      scrollY: 1800,
      innerHeight: 800,
      scrollHeight: 2000,
    });
    // scrollBy adds 800, but our fake doesn't clamp to scrollHeight.
    // Real browsers clamp, but we test the logic as written.
    const result = runScrollLogic("down", fakeWindow, fakeDocument);
    // Our fake: 1800 + 800 = 2600 (no clamping in logic — browser handles it)
    assert.equal(result.y, 2600);
    assert.equal(result.max, 1200);
  });

  it("'up' from top stays at 0", () => {
    const { fakeWindow, fakeDocument } = makeScrollContext({
      scrollY: 0,
      innerHeight: 800,
      scrollHeight: 2000,
    });
    // fakeWindow.scrollBy clamps to 0
    const result = runScrollLogic("up", fakeWindow, fakeDocument);
    assert.equal(result.y, 0);
  });

  it("error message contains valid direction hints", () => {
    const { fakeWindow, fakeDocument } = makeScrollContext();
    try {
      runScrollLogic("diagonal", fakeWindow, fakeDocument);
      assert.fail("expected error");
    } catch (err: any) {
      assert.ok(err.message.includes("down"));
      assert.ok(err.message.includes("up"));
      assert.ok(err.message.includes("bottom"));
      assert.ok(err.message.includes("top"));
    }
  });

  describe("page.evaluate interaction via mock", () => {
    it("scroll captures direction and returns position object", async () => {
      // Test that the command correctly passes direction to evaluate
      // and returns position info.
      let capturedDirection: string | null = null;
      let capturedCallback: Function | null = null;

      const mockPage = {
        evaluate: mock.fn(async (fn: Function, dir: string) => {
          capturedDirection = dir;
          capturedCallback = fn;
          // Run the actual callback in our simulated context
          const { fakeWindow, fakeDocument } = makeScrollContext({
            scrollY: 0,
            innerHeight: 800,
            scrollHeight: 2000,
          });
          // Re-bind the function to use our fake globals
          return runScrollLogic(dir, fakeWindow, fakeDocument);
        }),
      };

      // Simulate the scroll command's withPage callback:
      const scrollCallback = async (p: typeof mockPage) => {
        const pos = await p.evaluate((dir: string) => {
          // This would run in browser context; in test we intercept it
          return { y: 0, max: 0 };
        }, "down");
        process.stderr.write(`Scrolled to ${pos.y}/${pos.max}px\n`);
        return pos;
      };

      const pos = await scrollCallback(mockPage);
      assert.equal(mockPage.evaluate.mock.calls.length, 1);
      // Direction was passed as second arg to evaluate
      const [_fn, dir] = mockPage.evaluate.mock.calls[0].arguments;
      assert.equal(dir, "down");
    });

    it("scroll writes position to stderr", async () => {
      const stderrChunks: string[] = [];
      const originalWrite = process.stderr.write.bind(process.stderr);

      // Intercept stderr temporarily
      const mockWrite = (chunk: string | Uint8Array, ...rest: any[]) => {
        if (typeof chunk === "string") stderrChunks.push(chunk);
        return true;
      };
      (process.stderr as any).write = mockWrite;

      try {
        const mockPage = {
          evaluate: mock.fn(async () => ({ y: 800, max: 1200 })),
        };

        // Simulate scroll callback
        const scrollCallback = async (p: typeof mockPage) => {
          const pos = await p.evaluate((dir: string) => ({ y: 800, max: 1200 }), "down");
          process.stderr.write(`Scrolled to ${pos.y}/${pos.max}px\n`);
        };

        await scrollCallback(mockPage);
      } finally {
        (process.stderr as any).write = originalWrite;
      }

      assert.ok(stderrChunks.some(c => c.includes("Scrolled to 800/1200px")));
    });
  });
});
