#!/usr/bin/env node
// UI smoke test in headless Chrome over the DevTools protocol (no extra dependencies).
//   node scripts/ui-smoke.mjs <url> <out-dir> [steps.json]
// Steps: [{"click":[x,y]}, {"key":"ArrowLeft"}, {"wait":ms}, {"shot":"name"}, {"eval":"js"}]

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [url, outDir, stepsFile] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const steps = stepsFile ? JSON.parse(readFileSync(stepsFile, "utf-8")) : [{ wait: 3000 }, { shot: "page" }];

const chrome = spawn(process.env.CHROME || "google-chrome", [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--hide-scrollbars",
  "--remote-debugging-port=9333",
  "--window-size=1400,900",
  "about:blank",
]);
chrome.stderr.on("data", () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find((t) => t.type === "page");
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.consoleAPICalled") {
    logs.push(`[console.${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  } else if (msg.method === "Runtime.exceptionThrown") {
    logs.push(`[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });

const results = {};
for (const step of steps) {
  if (step.wait) await sleep(step.wait);
  if (step.click) {
    const [x, y] = step.click;
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await sleep(150);
  }
  if (step.move) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: step.move[0], y: step.move[1] });
    await sleep(150);
  }
  if (step.key) {
    const keyCodes = { ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, Enter: 13, Escape: 27, " ": 32, Tab: 9, Home: 36, End: 35 };
    const code = keyCodes[step.key] ?? step.key.toUpperCase().charCodeAt(0);
    const text = step.key.length === 1 ? step.key : undefined;
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: step.key, windowsVirtualKeyCode: code, text, modifiers: step.modifiers ?? 0 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: step.key, windowsVirtualKeyCode: code, modifiers: step.modifiers ?? 0 });
    await sleep(150);
  }
  if (step.eval) {
    const r = await send("Runtime.evaluate", { expression: step.eval, returnByValue: true, awaitPromise: true });
    results[step.name ?? step.eval] = r.result?.result?.value ?? r.result;
  }
  if (step.shot) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, `${step.shot}.png`), Buffer.from(r.result.data, "base64"));
  }
}
writeFileSync(join(outDir, "results.json"), JSON.stringify({ results, logs }, null, 2));
console.log(JSON.stringify({ results, logs: logs.slice(-30) }, null, 2));
ws.close();
chrome.kill();
process.exit(0);
