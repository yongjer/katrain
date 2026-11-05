import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYER_AI, PLAYER_HUMAN } from "../src/core/constants";

const saved = vi.hoisted(() => [] as string[]);
vi.mock("../src/state/platform", () => ({
  platform: {
    saveConfig: async (contents: string) => {
      saved.push(contents);
    },
  },
}));

import { analyzeExtra, loadGameFromString, newGame, setPlayer, setStatus, updateConfig, useStore } from "../src/state/store";

const players = () => useStore.getState().config.ui.players;
const savedPlayers = () => JSON.parse(saved.at(-1)!).ui.players;
const load = () => loadGameFromString("(;GM[1]SZ[9];B[ee])", "game.sgf", null);

describe("player types around a loaded game", () => {
  beforeEach(() => {
    newGame();
    updateConfig((c) => {
      c.ui.players.B.type = PLAYER_HUMAN;
      c.ui.players.W.type = PLAYER_AI;
    });
  });

  it("reviews with two humans without saving that to the config", () => {
    load();
    expect(players().W.type).toBe(PLAYER_HUMAN);
    expect(savedPlayers().W.type).toBe(PLAYER_AI);
  });

  it("returns to the earlier types with the next new game", () => {
    load();
    newGame();
    expect(players().W.type).toBe(PLAYER_AI);
    expect(savedPlayers().W.type).toBe(PLAYER_AI);
  });

  it("remembers the types from before the first of several loaded games", () => {
    load();
    load();
    newGame();
    expect(players().W.type).toBe(PLAYER_AI);
  });

  it("keeps a player type chosen during the review", () => {
    load();
    setPlayer("B", { type: PLAYER_AI });
    expect(savedPlayers().B.type).toBe(PLAYER_AI);
    newGame();
    expect(players().B.type).toBe(PLAYER_AI);
    expect(players().W.type).toBe(PLAYER_AI);
  });
});

describe("the status of stopped analysis", () => {
  const engine = { stopPondering: () => {}, terminateQueries: () => {} };

  beforeEach(() => {
    newGame();
    useStore.getState().game!.engine = engine as never;
  });

  it("clears a message about running analysis", () => {
    setStatus("Reanalyzing the game", "analysis");
    analyzeExtra("stop");
    expect(useStore.getState().status).toBeNull();
  });

  it("keeps other messages", () => {
    setStatus("game.sgf", "info");
    analyzeExtra("stop");
    expect(useStore.getState().status?.message).toBe("game.sgf");
  });
});
