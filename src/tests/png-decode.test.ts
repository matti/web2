import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { decodePNG, downsample, toAnsi, toIterm2 } from "../lib/png-decode.js";

/** Create a minimal valid PNG from raw RGBA pixels. */
function makePNG(w: number, h: number, rgba: number[][]): Buffer {
  const chunks: Buffer[] = [];
  // Signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  function chunk(type: string, data: Buffer) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4); // CRC unchecked by our decoder
    chunks.push(head, data, crc);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  chunk("IHDR", ihdr);

  // IDAT — filter 0 (none) for each row
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const p = rgba[y * w + x];
      const off = y * (1 + w * 4) + 1 + x * 4;
      raw[off] = p[0]; raw[off + 1] = p[1];
      raw[off + 2] = p[2]; raw[off + 3] = p[3];
    }
  }
  chunk("IDAT", deflateSync(raw));
  chunk("IEND", Buffer.alloc(0));

  return Buffer.concat(chunks);
}

describe("decodePNG", () => {
  it("decodes a 2x2 RGBA image", () => {
    const pixels = [
      [255, 0, 0, 255],   // red
      [0, 255, 0, 255],   // green
      [0, 0, 255, 255],   // blue
      [255, 255, 0, 255], // yellow
    ];
    const png = makePNG(2, 2, pixels);
    const img = decodePNG(png);

    assert.equal(img.width, 2);
    assert.equal(img.height, 2);
    assert.deepEqual(Array.from(img.data.slice(0, 4)), [255, 0, 0, 255]);
    assert.deepEqual(Array.from(img.data.slice(4, 8)), [0, 255, 0, 255]);
    assert.deepEqual(Array.from(img.data.slice(8, 12)), [0, 0, 255, 255]);
    assert.deepEqual(Array.from(img.data.slice(12, 16)), [255, 255, 0, 255]);
  });
});

describe("downsample", () => {
  it("averages a 4x4 image down to 2x2", () => {
    const data = new Uint8Array(4 * 4 * 4);
    // Fill top-left 2x2 block with red
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        const o = (y * 4 + x) * 4;
        data[o] = 200; data[o + 3] = 255;
      }
    // Fill bottom-right 2x2 block with blue
    for (let y = 2; y < 4; y++)
      for (let x = 2; x < 4; x++) {
        const o = (y * 4 + x) * 4;
        data[o + 2] = 200; data[o + 3] = 255;
      }

    const out = downsample({ width: 4, height: 4, data }, 2);
    assert.equal(out.width, 2);
    assert.equal(out.height, 2);
    // Top-left pixel should be reddish
    assert.ok(out.data[0] > 100, "red channel present");
    // Bottom-right pixel should be bluish
    const br = (1 * 2 + 1) * 4;
    assert.ok(out.data[br + 2] > 100, "blue channel present");
  });
});

describe("toAnsi", () => {
  it("produces half-block output with ANSI color codes", () => {
    const img = {
      width: 2,
      height: 2,
      data: new Uint8Array([
        255, 0, 0, 255,  0, 255, 0, 255,   // row 0: red, green
        0, 0, 255, 255,  255, 255, 0, 255,  // row 1: blue, yellow
      ]),
    };
    const out = toAnsi(img);
    assert.ok(out.includes("▀"), "contains half-block chars");
    assert.ok(out.includes("38;2;255;0;0"), "contains red foreground");
    assert.ok(out.includes("48;2;0;0;255"), "contains blue background");
    assert.ok(out.includes("\x1b[0m"), "resets at end of line");
    assert.equal(out.split("\n").length, 1, "2 rows = 1 line of half-blocks");
  });

  it("handles odd height", () => {
    const img = {
      width: 1,
      height: 3,
      data: new Uint8Array([
        255, 0, 0, 255,
        0, 255, 0, 255,
        0, 0, 255, 255,
      ]),
    };
    const out = toAnsi(img);
    assert.equal(out.split("\n").length, 2, "3 rows = 2 lines");
  });
});

describe("toIterm2", () => {
  it("wraps PNG in iTerm2 escape sequence", () => {
    const png = Buffer.from("fakepng");
    const out = toIterm2(png);
    assert.ok(out.startsWith("\x1b]1337;File="), "starts with OSC 1337");
    assert.ok(out.includes("inline=1"), "has inline=1");
    assert.ok(out.includes(`size=${png.length}`), "has size");
    assert.ok(out.includes(png.toString("base64")), "has base64 data");
    assert.ok(out.endsWith("\x07"), "ends with BEL");
  });
});
