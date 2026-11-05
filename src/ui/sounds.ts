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

// On Linux, WebKitGTK's <audio> fails with a format error on the app's own URLs. Web Audio can play them.
let mediaElementsFail = false;
const buffers = new Map<string, Promise<AudioBuffer>>();
const playing = new Map<string, AudioContext>();

function stopWebAudio(src: string) {
  const ctx = playing.get(src);
  if (ctx) {
    playing.delete(src);
    void ctx.close();
  }
}

// Each sound gets its own context. A context that stays open is not reliable in WebKitGTK: through PulseAudio to a
// Bluetooth device only its first sound is heard, and suspending it between sounds in the AppImage's older WebKitGTK
// makes them come later and later.
async function playWebAudio(src: string, volume: number) {
  const ctx = new AudioContext();
  try {
    let buffer = buffers.get(src);
    if (!buffer) {
      buffer = fetch(src)
        .then((response) => response.arrayBuffer())
        .then((bytes) => ctx.decodeAudioData(bytes));
      buffers.set(src, buffer);
    }
    const decoded = await buffer;
    await ctx.resume();
    stopWebAudio(src);
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = decoded;
    source.connect(gain);
    source.onended = () => {
      if (playing.get(src) === ctx) stopWebAudio(src);
    };
    playing.set(src, ctx);
    source.start();
  } catch (e) {
    void ctx.close();
    throw e;
  }
}

function play(src: string, volume = 1) {
  if (mediaElementsFail) {
    playWebAudio(src, volume).catch(() => {});
    return;
  }
  try {
    let audio = cache.get(src);
    if (!audio) {
      audio = new Audio(src);
      cache.set(src, audio);
    }
    audio.volume = volume;
    audio.currentTime = 0;
    void audio.play().catch((e: unknown) => {
      if (e instanceof DOMException && e.name === "NotSupportedError") {
        mediaElementsFail = true;
        playWebAudio(src, volume).catch(() => {});
      }
    });
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
    stopWebAudio(countdown);
  },
};
