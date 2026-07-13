import { execSync } from "node:child_process";
import { withPage } from "../lib/browser.js";
import { decodePNG, downsample, toAnsi, toIterm2 } from "../lib/png-decode.js";
import { STATE_DIR } from "../lib/state.js";

function isIterm(): boolean {
  return process.env.TERM_PROGRAM === "iTerm.app"
    || process.env.LC_TERMINAL === "iTerm2";
}

function renderFrame(png: Buffer, width?: string): { output: string; lines: number } {
  if (isIterm()) {
    return { output: toIterm2(png), lines: 1 };
  }
  const img = decodePNG(png);
  const cols = width ? parseInt(width, 10) : (process.stdout.columns || 80);
  const small = downsample(img, cols);
  const ansi = toAnsi(small);
  const lines = ansi.split("\n").length;
  return { output: ansi, lines };
}

export async function view(opts: {
  fullPage?: boolean;
  width?: string;
}): Promise<void> {
  await withPage(async (page) => {
    const png = await page.screenshot({
      type: "png",
      fullPage: opts.fullPage ?? false,
    });
    const { output } = renderFrame(Buffer.from(png), opts.width);
    process.stdout.write(output + "\n");
  });
}

function captureDesktop(): Buffer {
  const png = `${STATE_DIR}/.web-tail.png`;
  return execSync(`DISPLAY=:99 scrot -o ${png} && cat ${png}`, {
    maxBuffer: 50 * 1024 * 1024,
  });
}

const CHANGE_OBSERVER = `
if (!window.__webTailInit) {
  window.__webTailInit = true;
  window.__webDirty = true;
  const mark = () => { window.__webDirty = true; };
  new MutationObserver(mark).observe(document, {
    subtree: true, childList: true, attributes: true, characterData: true,
  });
  addEventListener("scroll", mark, { passive: true, capture: true });
  addEventListener("resize", mark);
}
`;

export async function tail(opts: {
  fullPage?: boolean;
  desktop?: boolean;
  width?: string;
  interval?: string;
}): Promise<void> {
  const ms = opts.interval ? parseInt(opts.interval, 10) : 1000;

  // Clear screen, hide cursor
  process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");
  const cleanup = () => {
    process.stdout.write("\x1b[?25h");
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  if (opts.desktop) {
    let prevOutput = "";
    while (true) {
      try {
        const result = captureDesktop();
        const { output } = renderFrame(result, opts.width);
        if (output !== prevOutput) {
          process.stdout.write("\x1b[H" + output + "\n");
          prevOutput = output;
        }
      } catch {
        process.stderr.write("\x1b[H\x1b[2K[tail] reconnecting...\n");
      }
      await new Promise((r) => setTimeout(r, ms));
    }
  }

  while (true) {
    try {
      await withPage(async (page) => {
        let prevOutput = "";
        let lastUrl = "";

        while (true) {
          const url = page.url();
          if (url !== lastUrl) {
            lastUrl = url;
            await page.evaluate(CHANGE_OBSERVER).catch(() => {});
          }

          const dirty = await page.evaluate(() => {
            const d = (globalThis as any).__webDirty ?? true;
            (globalThis as any).__webDirty = false;
            return d;
          }).catch(() => true);

          if (dirty) {
            const png = await page.screenshot({
              type: "png",
              fullPage: opts.fullPage ?? false,
            });
            const { output } = renderFrame(Buffer.from(png), opts.width);
            if (output !== prevOutput) {
              process.stdout.write("\x1b[H" + output + "\n");
              prevOutput = output;
            }
          }

          await new Promise((r) => setTimeout(r, ms));
        }
      });
    } catch {
      // Connection lost — retry after a short delay
      process.stderr.write("\x1b[H\x1b[2K[tail] reconnecting...\n");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
