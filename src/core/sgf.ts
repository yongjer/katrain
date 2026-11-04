// Ported from pysgf.BaseGoGame: SGF / NGF / GIB parsing and SGF writing.

import { GameNode, type SgfSaveOptions } from "./gameNode";
import { Move } from "./move";

export class ParseError extends Error {}

const PROP_PAT = /\s*(?:\(|\)|;|(\w+)((?:\s*\[(?:[^\]\\]|\\.)*\])+))/ys;
const VALUE_PAT = /\[((?:[^\]\\]|\\.)*)\]/gs;
const SGF_PAT = /\(;.*\)/s;

export function escapeValue(value: string): string {
  return value.replace(/([\]\\])/g, "\\$1");
}

export function unescapeValue(value: string): string {
  return value.replace(/\\([\]\\])/g, "$1");
}

/** Parse SGF text into a tree of GameNodes, returning the root. */
export function parseSgf(input: string): GameNode {
  const match = SGF_PAT.exec(input);
  const contents = match ? match[0] : input;
  const start = contents.indexOf("(");
  if (start < 0) throw new ParseError(`Parse error: Expected '(' at start, found ${contents.slice(0, 50)}`);

  let lastNonWs = contents.length - 1;
  while (lastNonWs >= 0 && /\s/.test(contents[lastNonWs])) lastNonWs--;

  const root = new GameNode();
  const branchStack: GameNode[] = [];
  let current = root;
  let ix = start + 1;
  let closed = false;

  while (ix < contents.length) {
    PROP_PAT.lastIndex = ix;
    const m = PROP_PAT.exec(contents);
    if (!m || m[0].length === 0) break;
    ix += m[0].length;
    const item = m[0].trim();
    if (item === ")") {
      if (!branchStack.length) {
        closed = true;
        break;
      }
      current = branchStack.pop()!;
    } else if (item === "(") {
      branchStack.push(current);
      current = new GameNode(current);
    } else if (item === ";") {
      // a ';' directly before the final ')' would only create an empty node
      let j = ix;
      while (j < contents.length && /\s/.test(contents[j])) j++;
      const useless = j === lastNonWs && contents[j] === ")";
      if (!(current.empty || useless)) current = new GameNode(current);
    } else {
      const values: string[] = [];
      VALUE_PAT.lastIndex = 0;
      for (const vm of m[2].matchAll(VALUE_PAT)) values.push(unescapeValue(vm[1]));
      current.addListProperty(m[1], values);
    }
  }
  if (!closed) {
    if (ix < contents.length) {
      throw new ParseError(`Parse Error: unexpected character at ${contents.slice(ix, ix + 25)}`);
    }
    throw new ParseError("Parse Error: expected ')' at end of input.");
  }

  if ((root.getListProperty("AP") ?? []).includes("foxwq")) {
    let corrected: number;
    if (parseInt(root.getProperty("HA", "0"), 10) >= 1) corrected = 0.5;
    else if (["chinese", "cn"].includes(root.getProperty("RU", "japanese").toLowerCase())) corrected = 7.5;
    else corrected = 6.5;
    root.setProperty("KM", corrected);
  }
  return root;
}

/** Parse NGF (WBaduk / Tygem export) text. */
export function parseNgf(ngfInput: string): GameNode {
  const ngf = ngfInput.trim();
  const lines = ngf.split("\n");
  let boardsize = 19;
  let handicap = 0;
  let pw = "";
  let pb = "";
  let rawdate = "";
  let komi = 0;
  try {
    boardsize = mustInt(lines[1]);
    handicap = mustInt(lines[5]);
    pw = lines[2].trim().split(/\s+/)[0];
    pb = lines[3].trim().split(/\s+/)[0];
    rawdate = lines[8].slice(0, 8);
    komi = mustFloat(lines[7]);
    if (handicap === 0 && Number.isInteger(komi)) komi += 0.5;
  } catch {
    boardsize = 19;
    handicap = 0;
    pw = pb = rawdate = "";
    komi = 0;
  }
  let result = "";
  if (lines.length > 10) {
    if (lines[10].includes("hite win")) result = "W+";
    else if (lines[10].includes("lack win")) result = "B+";
  }
  if (handicap < 0 || handicap > 9) throw new ParseError(`Handicap ${handicap} out of range`);

  const root = new GameNode();
  let node = root;
  root.setProperty("SZ", boardsize);
  if (handicap >= 2) {
    root.setProperty("HA", handicap);
    root.placeHandicapStones(handicap, true);
  }
  if (komi) root.setProperty("KM", pyFloatStr(komi));
  if (/^\d{8}$/.test(rawdate)) {
    root.setProperty("DT", `${rawdate.slice(0, 4)}-${rawdate.slice(4, 6)}-${rawdate.slice(6, 8)}`);
  }
  if (pw) root.setProperty("PW", pw);
  if (pb) root.setProperty("PB", pb);
  if (result) root.setProperty("RE", result);

  for (const rawLine of lines) {
    const line = rawLine.trim().toUpperCase();
    if (line.length >= 7 && line.slice(0, 2) === "PM" && (line[4] === "B" || line[4] === "W")) {
      const key = line[4];
      const rawMove = line.slice(5, 7).toLowerCase();
      const value =
        rawMove === "aa"
          ? ""
          : String.fromCharCode(rawMove.charCodeAt(0) - 1) + String.fromCharCode(rawMove.charCodeAt(1) - 1);
      node = new GameNode(node);
      node.setProperty(key, value);
    }
  }
  if (root.children.length === 0) throw new ParseError("Found no moves");
  return root;
}

/** Parse GIB (Tygem) text. */
export function parseGib(gib: string): GameNode {
  const parsePlayerName = (raw: string): [string, string] => {
    const parts = raw.split("(");
    if (parts.length === 2 && parts[1].endsWith(")")) return [parts[0].trim(), parts[1].slice(0, -1)];
    return [raw, ""];
  };
  const makeResult = (grlt: number, zipsu: number): string => {
    const easy: Record<number, string> = { 3: "B+R", 4: "W+R", 7: "B+T", 8: "W+T" };
    if (grlt in easy) return easy[grlt];
    if (grlt === 0 || grlt === 1) return `${grlt === 0 ? "B" : "W"}+${pyFloatStr(zipsu / 10)}`;
    return "";
  };
  const getResult = (line: string, grltRe: RegExp, zipsuRe: RegExp): string => {
    const g = grltRe.exec(line);
    const z = zipsuRe.exec(line);
    if (!g || !z) return "";
    return makeResult(parseInt(g[1], 10), parseInt(z[1], 10));
  };

  const root = new GameNode();
  let node = root;
  for (const rawLine of gib.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("\\[GAMEBLACKNAME=") && line.endsWith("\\]")) {
      const [name, rank] = parsePlayerName(line.slice(16, -2));
      if (name) root.setProperty("PB", name);
      if (rank) root.setProperty("BR", rank);
    }
    if (line.startsWith("\\[GAMEWHITENAME=") && line.endsWith("\\]")) {
      const [name, rank] = parsePlayerName(line.slice(16, -2));
      if (name) root.setProperty("PW", name);
      if (rank) root.setProperty("WR", rank);
    }
    if (line.startsWith("\\[GAMEINFOMAIN=")) {
      const result = getResult(line, /GRLT:(\d+),/, /ZIPSU:(\d+),/);
      if (result) {
        root.setProperty("RE", result);
        const g = /GONGJE:(\d+),/.exec(line);
        if (g) {
          const komi = parseInt(g[1], 10) / 10;
          if (komi) root.setProperty("KM", pyFloatStr(komi));
        }
      }
    }
    if (line.startsWith("\\[GAMETAG=")) {
      if (!root.hasProperty("DT")) {
        const m = /C(\d\d\d\d):(\d\d):(\d\d)/.exec(line);
        if (m) root.setProperty("DT", `${m[1]}-${m[2]}-${m[3]}`);
      }
      if (!root.hasProperty("RE")) {
        const result = getResult(line, /,W(\d+),/, /,Z(\d+),/);
        if (result) root.setProperty("RE", result);
      }
      if (!root.hasProperty("KM")) {
        const g = /,G(\d+),/.exec(line);
        if (g) {
          const komi = parseInt(g[1], 10) / 10;
          if (komi) root.setProperty("KM", pyFloatStr(komi));
        }
      }
    }
    if (line.slice(0, 3) === "INI") {
      if (node !== root) throw new ParseError("Node is not root");
      const setup = line.split(/\s+/);
      const handicap = parseInt(setup[3], 10);
      if (Number.isNaN(handicap)) continue; // truncated or malformed INI line
      if (handicap < 0 || handicap > 9) throw new ParseError(`Handicap ${handicap} out of range`);
      if (handicap >= 2) {
        root.setProperty("HA", handicap);
        root.placeHandicapStones(handicap, true);
      }
    }
    if (line.slice(0, 3) === "STO") {
      const move = line.split(/\s+/);
      const key = move[3] === "1" ? "B" : "W";
      const x = parseInt(move[4], 10);
      const y = 18 - parseInt(move[5], 10);
      if (move.length < 6 || Number.isNaN(x) || Number.isNaN(y)) throw new ParseError(`Malformed STO line: ${line}`);
      if (!(x >= 0 && x < 19 && y >= 0 && y < 19)) {
        throw new ParseError(`Coordinates for move (${x},${y}) out of range on line ${line}`);
      }
      node = new GameNode(node);
      node.setProperty(key, new Move([x, y]).sgf([19, 19]));
    }
  }
  if (root.children.length === 0) throw new ParseError("No valid nodes found");
  return root;
}

/** Parse a game file's decoded contents, dispatching on the file extension. */
export function parseGameFile(contents: string, filename: string): GameNode {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".ngf")) return parseNgf(contents);
  if (lower.endsWith(".gib")) return parseGib(contents);
  return parseSgf(contents);
}

/** Serialize a (sub)tree to SGF. */
export function writeSgf(root: GameNode, opts: SgfSaveOptions = {}): string {
  const nodeStr = (node: GameNode) => {
    let s = ";";
    for (const [prop, values] of node.sgfProperties(opts)) {
      if (!values.length) continue;
      s += prop + values.map((v) => `[${escapeValue(v)}]`).join("");
    }
    return s;
  };
  const stack: (string | GameNode)[] = [")", root, "("];
  const out: string[] = [];
  while (stack.length) {
    const item = stack.pop()!;
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    out.push(nodeStr(item));
    if (item.children.length === 1) {
      stack.push(item.children[0]);
    } else if (item.children.length) {
      for (const child of [...item.orderedChildren].reverse()) stack.push(")", child, "(");
    }
  }
  return out.join("");
}

function mustInt(s: string | undefined): number {
  if (s === undefined || !/^\s*[+-]?\d+\s*$/.test(s)) throw new Error("not an int");
  return parseInt(s, 10);
}

function mustFloat(s: string | undefined): number {
  const v = s === undefined ? NaN : Number(s.trim());
  if (s === undefined || s.trim() === "" || Number.isNaN(v)) throw new Error("not a float");
  return v;
}

/** Python str(float): always has a decimal point. */
function pyFloatStr(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}
