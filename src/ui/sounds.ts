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
let context: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();
const playing = new Map<string, AudioBufferSourceNode>();

function stopWebAudio(src: string) {
  const source = playing.get(src);
  if (source) {
    source.onended = null;
    source.stop();
    playing.delete(src);
  }
}

async function playWebAudio(src: string, volume: number) {
  const ctx = (context ??= new AudioContext());
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
  // The context is never suspended between sounds: in the older WebKitGTK inside the AppImage, sounds then come later
  // and later, until they seem to have stopped.
  source.onended = () => playing.delete(src);
  playing.set(src, source);
  source.start();
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
