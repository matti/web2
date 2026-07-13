import { withPage } from "../lib/browser.js";

export async function resize(width: string, height: string): Promise<void> {
  await withPage(async (page) => {
    const w = parseInt(width, 10);
    const h = parseInt(height, 10);
    await page.setViewportSize({ width: w, height: h });
    process.stderr.write(`Viewport: ${w}x${h}\n`);
  });
}

export async function size(): Promise<void> {
  await withPage(async (page) => {
    const dims = await page.evaluate(() => ({
      w: window.innerWidth,
      h: window.innerHeight,
    }));
    process.stdout.write(`${dims.w}x${dims.h}\n`);
  });
}

const PRESETS: Record<string, [number, number]> = {
  mobile:  [375, 667],
  tablet:  [768, 1024],
  desktop: [1280, 800],
  "1080p": [1920, 1080],
};

export async function preset(name: string): Promise<void> {
  const dims = PRESETS[name];
  if (!dims) {
    const names = Object.keys(PRESETS).join(", ");
    process.stderr.write(`Unknown preset: ${name}. Available: ${names}\n`);
    process.exit(1);
  }
  await withPage(async (page) => {
    await page.setViewportSize({ width: dims[0], height: dims[1] });
    process.stderr.write(`Viewport: ${dims[0]}x${dims[1]} (${name})\n`);
  });
}

export async function rotate(): Promise<void> {
  await withPage(async (page) => {
    const { w, h } = await page.evaluate(() => ({
      w: window.innerWidth,
      h: window.innerHeight,
    }));
    await page.setViewportSize({ width: h, height: w });
    process.stderr.write(`Viewport: ${h}x${w}\n`);
  });
}
