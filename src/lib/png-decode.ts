import { inflateSync } from "node:zlib";

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8Array; // RGBA interleaved
}

/**
 * Minimal PNG decoder — handles 8-bit RGB and RGBA color types.
 * No dependencies beyond Node's built-in zlib.
 */
export function decodePNG(buf: Buffer): RGBAImage {
  let off = 8; // skip signature
  let width = 0, height = 0, bpp = 4;
  const idats: Buffer[] = [];

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const chunk = buf.subarray(off + 8, off + 8 + len);

    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bpp = chunk[9] === 6 ? 4 : 3; // RGBA or RGB
    } else if (type === "IDAT") {
      idats.push(chunk as Buffer);
    } else if (type === "IEND") break;

    off += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(idats));
  const stride = width * bpp + 1; // +1 filter byte per row
  const pixels = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    const row = y * stride + 1;
    const prev = y > 0 ? (y - 1) * stride + 1 : -1;

    // Defilter in-place
    for (let i = 0; i < width * bpp; i++) {
      const a = i >= bpp ? raw[row + i - bpp] : 0;
      const b = prev >= 0 ? raw[prev + i] : 0;
      const c = i >= bpp && prev >= 0 ? raw[prev + i - bpp] : 0;
      let v = raw[row + i];

      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;

      raw[row + i] = v;
    }

    // Copy to RGBA output
    for (let x = 0; x < width; x++) {
      const s = row + x * bpp;
      const d = (y * width + x) * 4;
      pixels[d] = raw[s];
      pixels[d + 1] = raw[s + 1];
      pixels[d + 2] = raw[s + 2];
      pixels[d + 3] = bpp === 4 ? raw[s + 3] : 255;
    }
  }

  return { width, height, data: pixels };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Area-average downsample to target width, preserving aspect ratio. */
export function downsample(img: RGBAImage, tw: number): RGBAImage {
  const scale = img.width / tw;
  const th = Math.round(img.height / scale);
  const out = new Uint8Array(tw * th * 4);

  for (let y = 0; y < th; y++) {
    const sy0 = Math.floor(y * scale);
    const sy1 = Math.min(Math.ceil((y + 1) * scale), img.height);
    for (let x = 0; x < tw; x++) {
      const sx0 = Math.floor(x * scale);
      const sx1 = Math.min(Math.ceil((x + 1) * scale), img.width);
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (sy * img.width + sx) * 4;
          r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2];
          n++;
        }
      }
      const d = (y * tw + x) * 4;
      out[d] = Math.round(r / n);
      out[d + 1] = Math.round(g / n);
      out[d + 2] = Math.round(b / n);
      out[d + 3] = 255;
    }
  }
  return { width: tw, height: th, data: out };
}

/** Render RGBA image as ANSI half-block art. Each char = 2 vertical pixels. */
export function toAnsi(img: RGBAImage): string {
  const lines: string[] = [];
  for (let y = 0; y < img.height - 1; y += 2) {
    let line = "";
    for (let x = 0; x < img.width; x++) {
      const t = (y * img.width + x) * 4;
      const b = ((y + 1) * img.width + x) * 4;
      line += `\x1b[38;2;${img.data[t]};${img.data[t + 1]};${img.data[t + 2]}m`
            + `\x1b[48;2;${img.data[b]};${img.data[b + 1]};${img.data[b + 2]}m▀`;
    }
    lines.push(line + "\x1b[0m");
  }
  if (img.height % 2 === 1) {
    let line = "";
    const y = img.height - 1;
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      line += `\x1b[38;2;${img.data[o]};${img.data[o + 1]};${img.data[o + 2]}m▀`;
    }
    lines.push(line + "\x1b[0m");
  }
  return lines.join("\n");
}

/** Wrap PNG buffer in iTerm2 inline image escape sequence. */
export function toIterm2(png: Buffer): string {
  return `\x1b]1337;File=inline=1;size=${png.length}:${png.toString("base64")}\x07`;
}
