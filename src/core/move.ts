// Ported from pysgf.Move

import type { Player } from "./constants";

const GTP_COORD: string[] = [
  ..."ABCDEFGHJKLMNOPQRSTUVWXYZ",
  ...[..."ABCDEFGH"].flatMap((xa) => [..."ABCDEFGHJKLMNOPQRSTUVWXYZ"].map((c) => xa + c)),
];
const SGF_COORD: string[] = [..."abcdefghijklmnopqrstuvwxyz", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

export type Coords = [number, number];

export class Move {
  static readonly PLAYERS: Player[] = ["B", "W"];
  readonly player: Player;
  readonly coords: Coords | null;

  constructor(coords: Coords | null = null, player: Player = "B") {
    this.coords = coords;
    this.player = player;
  }

  static pass(player: Player = "B"): Move {
    return new Move(null, player);
  }

  static fromGtp(gtpCoords: string, player: Player = "B"): Move {
    if (gtpCoords.toLowerCase().includes("pass")) return new Move(null, player);
    const match = /^([A-Z]+)(\d+)/.exec(gtpCoords);
    if (!match) throw new Error(`Invalid GTP coordinates ${gtpCoords}`);
    const x = GTP_COORD.indexOf(match[1]);
    if (x < 0) throw new Error(`Invalid GTP coordinates ${gtpCoords}`);
    return new Move([x, parseInt(match[2], 10) - 1], player);
  }

  static fromSgf(sgfCoords: string, boardSize: [number, number], player: Player = "B"): Move {
    if (sgfCoords === "" || (sgfCoords === "tt" && boardSize[0] <= 19 && boardSize[1] <= 19)) {
      return new Move(null, player);
    }
    const x = SGF_COORD.indexOf(sgfCoords[0]);
    const yRaw = SGF_COORD.indexOf(sgfCoords[1]);
    if (x < 0 || yRaw < 0) throw new Error(`Invalid SGF coordinates '${sgfCoords}'`);
    return new Move([x, boardSize[1] - yRaw - 1], player);
  }

  get isPass(): boolean {
    return this.coords === null;
  }

  gtp(): string {
    if (this.coords === null) return "pass";
    return GTP_COORD[this.coords[0]] + String(this.coords[1] + 1);
  }

  sgf(boardSize: [number, number]): string {
    if (this.coords === null) return "";
    return SGF_COORD[this.coords[0]] + SGF_COORD[boardSize[1] - this.coords[1] - 1];
  }

  static opponentPlayer(player: Player): Player {
    return player === "B" ? "W" : "B";
  }

  get opponent(): Player {
    return Move.opponentPlayer(this.player);
  }

  sameCoords(other: Move): boolean {
    if (this.coords === null || other.coords === null) return this.coords === other.coords;
    return this.coords[0] === other.coords[0] && this.coords[1] === other.coords[1];
  }

  equals(other: Move | null | undefined): boolean {
    return !!other && this.player === other.player && this.sameCoords(other);
  }

  /** Stable key for maps/sets, includes the player. */
  get key(): string {
    return `${this.player}${this.gtp()}`;
  }

  toString(): string {
    return `Move(${this.player}${this.gtp()})`;
  }
}

export function coordsKey(c: Coords): string {
  return `${c[0]},${c[1]}`;
}
