// Ported from katrain/core/utils.py

/** Convert ownership/policy to grid format such that grid[y][x] is for the move with coords x,y. */
export function varToGrid<T>(arrayVar: ArrayLike<T>, size: [number, number]): T[][] {
  const [sx, sy] = size;
  const grid: T[][] = new Array(sy);
  let ix = 0;
  for (let y = sy - 1; y >= 0; y--) {
    grid[y] = Array.prototype.slice.call(arrayVar, ix, ix + sx) as T[];
    ix += sx;
  }
  return grid;
}

export function evaluationClass(pointsLost: number, evalThresholds: number[]): number {
  let i = 0;
  while (i < evalThresholds.length - 1 && pointsLost < evalThresholds[i]) i++;
  return i;
}

export function formatVisits(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e5) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1e6) return `${(n / 1000).toFixed(0)}k`;
  return `${(n / 1e6).toFixed(0)}M`;
}

export type Rng = () => number;
let rng: Rng = Math.random;
/** Override the random source (tests use this for determinism). */
export function setRng(r: Rng) {
  rng = r;
}
export function random(): number {
  return rng();
}

/**
 * For a list of items with weights, returns random items with those weights, without replacement,
 * in descending order of their sampled key (same "magic" as the Python version).
 */
export function weightedSelectionWithoutReplacement<T>(items: T[], weight: (item: T) => number, pickN: number): T[] {
  const keyed = items.map((item) => ({ key: Math.log(rng()) / (weight(item) + 1e-18), item }));
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, Math.max(0, pickN)).map((k) => k.item);
}

/** n largest items according to key, in descending order. */
export function nLargest<T>(n: number, items: T[], key: (item: T) => number): T[] {
  return [...items].sort((a, b) => key(b) - key(a)).slice(0, n);
}

function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** IEEE 754 binary16 encoding with round-half-to-even, matching Python's struct 'e' format. */
export function float64ToHalfBits(v: number): number {
  if (Number.isNaN(v)) return 0x7e00;
  const sign = v < 0 || Object.is(v, -0) ? 0x8000 : 0;
  const a = Math.abs(v);
  if (a === Infinity) return sign | 0x7c00;
  if (a === 0) return sign;
  let e = Math.floor(Math.log2(a));
  if (2 ** e > a) e--;
  else if (2 ** (e + 1) <= a) e++;
  if (e < -14) {
    // subnormal (or rounds up to the smallest normal, which encodes identically)
    return sign | roundHalfEven(a / 2 ** -24);
  }
  let m = roundHalfEven((a / 2 ** e - 1) * 1024);
  if (m === 1024) {
    m = 0;
    e++;
  }
  if (e > 15) return sign | 0x7c00;
  return sign | ((e + 15) << 10) | m;
}

export function halfBitsToFloat64(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return sign * m * 2 ** -24;
  if (e === 31) return m ? NaN : sign * Infinity;
  return sign * (1 + m / 1024) * 2 ** (e - 15);
}

/** Little-endian float16 packing, as Python's struct.pack(f"{n}e") on x86/ARM. */
export function packFloats(values: ArrayLike<number> | null | undefined): Uint8Array {
  if (!values) return new Uint8Array(0);
  const out = new Uint8Array(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    const h = float64ToHalfBits(values[i]);
    out[2 * i] = h & 0xff;
    out[2 * i + 1] = h >> 8;
  }
  return out;
}

export function unpackFloats(data: Uint8Array, num: number): number[] | null {
  if (!data || data.length === 0) return null;
  if (data.length < num * 2) throw new Error(`Expected ${num} floats but got ${data.length} bytes`);
  const out = new Array<number>(num);
  for (let i = 0; i < num; i++) out[i] = halfBitsToFloat64(data[2 * i] | (data[2 * i + 1] << 8));
  return out;
}

export function base64Encode(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

export function base64Decode(str: string): Uint8Array {
  const bin = atob(str.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Python-style "%.1f" formatting of a signed number with explicit sign. */
export function signed(x: number, digits = 1): string {
  const s = x.toFixed(digits);
  return x >= 0 && !s.startsWith("-") ? `+${s}` : s;
}

export function pct(x: number, digits = 1): string {
  return `${(100 * x).toFixed(digits)}%`;
}
