import stone1 from "../assets/sounds/stone1.wav";
import stone2 from "../assets/sounds/stone2.wav";
import stone3 from "../assets/sounds/stone3.wav";
import stone4 from "../assets/sounds/stone4.wav";
import stone5 from "../assets/sounds/stone5.wav";
import capturing from "../assets/sounds/capturing.wav";
import boing from "../assets/sounds/boing.wav";
import countdown from "../assets/sounds/countdownbeep.wav";

const STONES = [stone1, stone2, stone3, stone4, stone5];
const cache = new Map<string, HTMLAudioElement>();

function play(src: string, volume = 1) {
  try {
    let audio = cache.get(src);
    if (!audio) {
      audio = new Audio(src);
      cache.set(src, audio);
    }
    audio.volume = volume;
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
  minimalTimePassed: () => play(boing, 0.1),
  countdown: (volume: number) => play(countdown, volume),
  stopCountdown: () => {
    const a = cache.get(countdown);
    if (a) a.pause();
  },
};
