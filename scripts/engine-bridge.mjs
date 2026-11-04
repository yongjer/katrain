#!/usr/bin/env node
// Development helper: runs KataGo for the browser build of the UI (`npm run dev` + ?bridge=http://localhost:8765).
// The desktop app does not use this; there the Rust backend owns the process.
//
//   node scripts/engine-bridge.mjs [--port 8765]
//
// Env: KATRAIN_DATA_DIR (KataGo homeDataDir, default ~/.katrain), KATAGO_OVERRIDES (extra -override-config entries).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 8765;
const dataDir = process.env.KATRAIN_DATA_DIR || join(homedir(), ".katrain");

let proc = null;
let generation = 0;
const clients = new Set();

function resolvePath(p) {
  const n = p.replace(/\\/g, "/");
  if (n.startsWith("katrain/")) return join(repo, n);
  if (n.startsWith("~/")) return join(homedir(), n.slice(2));
  return p;
}

function findInPath(name) {
  for (const dir of [...(process.env.PATH || "").split(delimiter), "/opt/homebrew/bin", "/usr/local/bin"]) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function command(settings) {
  if (settings.altcommand?.trim()) return { cmd: settings.altcommand.trim(), args: [], shell: true };
  let exe = settings.katago?.trim();
  if (!exe) {
    exe = process.platform === "win32" ? "katrain/KataGo/katago.exe" : process.platform === "linux" ? "katrain/KataGo/katago" : findInPath("katago");
  }
  exe = resolvePath(exe);
  mkdirSync(dataDir, { recursive: true });
  const overrides = [`homeDataDir=${dataDir}`, process.env.KATAGO_OVERRIDES].filter(Boolean).join(",");
  const args = ["analysis", "-model", resolvePath(settings.model), "-config", resolvePath(settings.config), "-override-config", overrides];
  if (settings.humanlike_model?.trim()) args.splice(3, 0, "-human-model", resolvePath(settings.humanlike_model.trim()));
  return { cmd: exe, args, shell: false };
}

function broadcast(gen, event, data) {
  for (const c of clients) {
    if (c.generation !== gen) continue;
    for (const line of String(data).split("\n")) c.res.write(`event: ${event}\ndata: ${line}\n`);
    c.res.write("\n");
  }
}

function stop() {
  if (proc) {
    proc.kill();
    proc = null;
  }
}

function start(settings) {
  stop();
  const gen = ++generation;
  const { cmd, args, shell } = command(settings);
  const child = spawn(cmd, args, { shell, stdio: ["pipe", "pipe", "pipe"], cwd: shell ? dataDir : dirname(cmd) });
  proc = child;
  createInterface({ input: child.stdout }).on("line", (l) => broadcast(gen, "stdout", l));
  createInterface({ input: child.stderr }).on("line", (l) => broadcast(gen, "stderr", l));
  child.on("error", (e) => broadcast(gen, "stderr", `Starting KataGo failed: ${e.message}`));
  child.on("exit", (code) => {
    broadcast(gen, "exit", code ?? -1);
    if (proc === child) proc = null;
  });
  console.log(`[bridge] started generation ${gen}: ${cmd} ${args.join(" ")}`);
  return gen;
}

const body = (req) =>
  new Promise((ok) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => ok(data));
  });

createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.end();
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/start" && req.method === "POST") {
      const gen = start(JSON.parse(await body(req)));
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ generation: gen }));
    }
    if (url.pathname === "/send" && req.method === "POST") {
      const line = await body(req);
      if (!proc) {
        res.statusCode = 409;
        return res.end("KataGo is not running");
      }
      proc.stdin.write(line.trim() + "\n");
      return res.end("ok");
    }
    if (url.pathname === "/stop" && req.method === "POST") {
      stop();
      return res.end("ok");
    }
    if (url.pathname === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": connected\n\n");
      const client = { res, generation: Number(url.searchParams.get("generation") || generation) };
      clients.add(client);
      req.on("close", () => clients.delete(client));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
}).listen(port, () => console.log(`[bridge] KataGo bridge on http://localhost:${port}`));

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
