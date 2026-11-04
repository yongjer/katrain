import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GameNode, KataGoResponse } from "../src/core/gameNode";
import { gameReport, REPORT_FILTERS } from "../src/core/report";
import { parseSgf } from "../src/core/sgf";

interface Golden {
  file: string;
  current_index: number;
  thresholds: number[];
  analyses: { index: number; json: KataGoResponse; partial: boolean }[];
  reports: Record<string, { sum_stats: Record<string, Record<string, number>>; histogram: Record<string, number>[]; ptloss: Record<string, number[]> }>;
}

describe("performance report matches katrain/core/ai.py game_report", () => {
  const golden = JSON.parse(readFileSync(join(__dirname, "golden/report.json"), "utf-8")) as Golden;
  const root = parseSgf(readFileSync(join(__dirname, "data", golden.file), "utf-8"));
  const main: GameNode[] = [root];
  while (main.at(-1)!.children.length) main.push(main.at(-1)!.children[0]);
  for (const a of golden.analyses) main[a.index].setAnalysis(a.json, null, false, null, a.partial);
  const names: Record<string, string> = { all: "Entire Game", opening: "Opening", mid: "Midgame", end: "Endgame" };

  for (const [key, expected] of Object.entries(golden.reports)) {
    it(`${names[key]}`, () => {
      const r = gameReport(main[golden.current_index], golden.thresholds, REPORT_FILTERS[names[key]]);
      expect(r.histogram).toEqual(expected.histogram);
      for (const bw of ["B", "W"] as const) {
        expect(r.playerPtloss[bw].length).toBe(expected.ptloss[bw].length);
        r.playerPtloss[bw].forEach((v, i) => expect(v).toBeCloseTo(expected.ptloss[bw][i], 9));
        expect(Object.keys(r.sumStats[bw]).sort()).toEqual(Object.keys(expected.sum_stats[bw]).sort());
        for (const [k, v] of Object.entries(expected.sum_stats[bw])) {
          expect((r.sumStats[bw] as Record<string, number>)[k]).toBeCloseTo(v, 9);
        }
      }
    });
  }
});
