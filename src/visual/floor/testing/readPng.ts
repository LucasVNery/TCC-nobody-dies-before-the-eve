// Test-only PNG decoder: 8-bit RGBA, non-interlaced, filters 0-4. Imported only by tests.
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function readPngRgba(path: string): { width: number; height: number; data: Uint8Array } {
  if (!existsSync(path)) throw new Error(`readPngRgba: file not found: ${path}`);
  const buf = readFileSync(path);
  if (buf.length < 8 || SIGNATURE.some((v, i) => buf[i] !== v)) {
    throw new Error(`readPngRgba: not a PNG file: ${path}`);
  }
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  let o = 8;
  while (o + 8 <= buf.length) {
    const len = u32(buf, o);
    const type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
    const body = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = u32(body, 0);
      height = u32(body, 4);
      const [depth, colorType, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(
          `readPngRgba: unsupported PNG format in ${path} (bit depth ${depth}, color type ${colorType}, interlace ${interlace}); 8-bit RGBA non-interlaced required`,
        );
      }
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    o += 12 + len;
  }
  if (width === 0 || height === 0 || idat.length === 0) throw new Error(`readPngRgba: missing IHDR or IDAT in ${path}`);

  let total = 0;
  for (const c of idat) total += c.length;
  const compressed = new Uint8Array(total);
  let p = 0;
  for (const c of idat) {
    compressed.set(c, p);
    p += c.length;
  }
  const raw = inflateSync(compressed);
  const bpp = 4;
  const stride = width * bpp;
  if (raw.length !== height * (stride + 1)) throw new Error(`readPngRgba: unexpected image data size in ${path}`);

  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? data[dst + x - bpp] : 0;
      const b = y > 0 ? data[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? data[dst - stride + x - bpp] : 0;
      const v = raw[src + x];
      let out: number;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: out = v + paeth(a, b, c); break;
        default: throw new Error(`readPngRgba: invalid filter type ${filter} on row ${y} in ${path}`);
      }
      data[dst + x] = out & 0xff;
    }
  }
  return { width, height, data };
}
