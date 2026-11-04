import stone1 from "../../katrain/sounds/stone1.wav";
import stone2 from "../../katrain/sounds/stone2.wav";
import stone3 from "../../katrain/sounds/stone3.wav";
import stone4 from "../../katrain/sounds/stone4.wav";
import stone5 from "../../katrain/sounds/stone5.wav";
import capturing from "../../katrain/sounds/capturing.wav";
import boing from "../../katrain/sounds/boing.wav";

const STONES = [stone1, stone2, stone3, stone4, stone5];
const cache = new Map<string, HTMLAudioElement>();

function play(src: string) {
  try {
    let audio = cache.get(src);
    if (!audio) {
      audio = new Audio(src);
      cache.set(src, audio);
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {
    /* audio unavailable */
  }
}

export const sounds = {
  stone: () => play(STONES[Math.floor(Math.random() * STONES.length)]),
  capture: () => play(capturing),
  mistake: () => play(boing),
};
