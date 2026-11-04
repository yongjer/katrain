// Remote engine behaviour, after tests/test_remote_engine.py: reconnecting resumes outstanding queries,
// giving up reports the engine as dead, a new game clears the resend backlog, and URLs are validated.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parsePo, setCatalogs } from "../src/core/i18n";
import { KataGoEngine, resolveEngineBackend, type EngineSettings, type EngineTransport } from "../src/core/engine";
import { GameNode } from "../src/core/gameNode";

type Handlers = Parameters<EngineTransport["setHandlers"]>[0];

/** A transport whose connection can be dropped and whose reconnects can be made to fail. */
class FakeRemote implements EngineTransport {
  handlers!: Handlers;
  sent: string[] = [];
  starts = 0;
  connected = false;
  failNext = 0;
  setHandlers(h: Handlers) {
    this.handlers = h;
  }
  async start() {
    this.starts++;
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("connection refused");
    }
    this.connected = true;
    return { ready: true };
  }
  async send(line: string) {
    if (!this.connected) throw new Error("disconnected");
    this.sent.push(line);
  }
  async stop() {
    this.connected = false;
  }
  drop(reason = "connection lost") {
    this.connected = false;
    this.handlers.onStderr(`Remote KataGo disconnected: ${reason}`);
    this.handlers.onExit(null);
  }
  answer(id: string) {
    this.handlers.onStdout(JSON.stringify({ id, moveInfos: [], rootInfo: { visits: 1, winrate: 0.5, scoreLead: 0 } }));
  }
}

const settings = (over: Partial<EngineSettings> = {}): EngineSettings => ({
  backend: "remote",
  remote_url: "wss://example.test/katago",
  katago: "",
  altcommand: "",
  model: "",
  humanlike_model: "",
  config: "",
  max_visits: 10,
  fast_visits: 5,
  max_time: 1,
  wide_root_noise: 0,
  _enable_ownership: false,
  ...over,
});

const until = async (cond: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

const ids = (sent: string[]) => sent.map((l) => JSON.parse(l)).filter((q) => q.action !== "terminate").map((q) => q.id as string);

describe("remote engine", () => {
  beforeAll(() => {
    const en = parsePo(readFileSync(join(__dirname, "../src/i18n/en.po"), "utf-8"));
    setCatalogs(en, en);
  });
  const saved = [KataGoEngine.RECONNECT_BACKOFF_MS, KataGoEngine.RECONNECT_MAX_BACKOFF_MS];
  beforeEach(() => {
    KataGoEngine.RECONNECT_BACKOFF_MS = 5;
    KataGoEngine.RECONNECT_MAX_BACKOFF_MS = 20;
  });
  afterEach(() => {
    [KataGoEngine.RECONNECT_BACKOFF_MS, KataGoEngine.RECONNECT_MAX_BACKOFF_MS] = saved;
  });

  it("resolves the backend like resolve_engine_backend", () => {
    expect(resolveEngineBackend({ backend: "", remote_url: "", altcommand: "" })).toBe("local");
    expect(resolveEngineBackend({ remote_url: "ws://x", altcommand: "" })).toBe("remote");
    expect(resolveEngineBackend({ remote_url: "", altcommand: "katago" })).toBe("custom");
    expect(resolveEngineBackend({ backend: "local", remote_url: "ws://x", altcommand: "" })).toBe("local");
    expect(resolveEngineBackend({ backend: "Custom", remote_url: "ws://x", altcommand: "" })).toBe("custom");
  });

  it("is ready as soon as it is connected", async () => {
    const t = new FakeRemote();
    const e = new KataGoEngine(t, settings());
    await e.start();
    expect(e.state).toBe("ready");
  });

  it("rejects an empty or non-WebSocket URL without connecting", async () => {
    for (const url of ["", "http://example.test"]) {
      const t = new FakeRemote();
      const e = new KataGoEngine(t, settings({ remote_url: url }));
      await e.start();
      expect(e.state).toBe("dead");
      expect(e.lastError).toMatch(/URL/);
      expect(t.starts).toBe(0);
    }
  });

  it("reports a failed first connection", async () => {
    const t = new FakeRemote();
    t.failNext = 1;
    const e = new KataGoEngine(t, settings());
    await e.start();
    expect(e.state).toBe("dead");
    expect(e.lastError).toContain("connection refused");
  });

  it("reconnects and re-sends the outstanding queries, then delivers their results", async () => {
    const t = new FakeRemote();
    const e = new KataGoEngine(t, settings());
    const status: string[] = [];
    e.onStatus = (m) => status.push(m);
    await e.start();
    const results: string[] = [];
    const node = new GameNode(null, { SZ: 9 });
    e.requestAnalysis(node, { callback: (r) => results.push(r.id) });
    e.requestAnalysis(node, { callback: (r) => results.push(r.id), visits: 3 });
    await until(() => t.sent.length === 2);
    const [q1, q2] = ids(t.sent);
    t.answer(q1);
    expect(results).toEqual([q1]);

    t.failNext = 2; // the first two reconnect attempts fail
    t.drop();
    expect(e.state).toBe("ready"); // still usable while reconnecting
    e.requestAnalysis(node, { callback: (r) => results.push(r.id), visits: 4 }); // queued while disconnected
    await until(() => t.connected && t.sent.length === 4);
    expect(t.starts).toBe(4);
    const resent = ids(t.sent.slice(2));
    expect(resent).toHaveLength(2);
    expect(resent).toContain(q2);
    expect(resent).not.toContain(q1); // already answered
    for (const id of resent) t.answer(id);
    expect(results).toHaveLength(3);
    expect(e.isIdle()).toBe(true);
    expect(status.some((s) => s.includes("attempt 3/6"))).toBe(true);
    expect(status.at(-1)).toContain("Reconnected");
  });

  it("gives up after the last attempt and reports the engine as disconnected", async () => {
    const t = new FakeRemote();
    const e = new KataGoEngine(t, settings());
    await e.start();
    e.requestAnalysis(new GameNode(null, { SZ: 9 }), { callback: () => {} });
    t.failNext = 100;
    t.drop("server went away");
    await until(() => e.state === "dead");
    expect(t.starts).toBe(1 + KataGoEngine.RECONNECT_ATTEMPTS);
    expect(e.lastError).toContain("connection refused");
    expect(e.isIdle()).toBe(true);
  });

  it("a new game clears the resend backlog", async () => {
    const t = new FakeRemote();
    const e = new KataGoEngine(t, settings());
    await e.start();
    e.requestAnalysis(new GameNode(null, { SZ: 9 }), { callback: () => {} });
    await until(() => t.sent.length === 1);
    t.failNext = 1;
    t.drop();
    e.onNewGame();
    await until(() => t.connected);
    await new Promise((r) => setTimeout(r, 20));
    expect(ids(t.sent)).toHaveLength(1); // nothing re-sent
  });

  it("stops reconnecting when shut down", async () => {
    const t = new FakeRemote();
    const e = new KataGoEngine(t, settings());
    await e.start();
    t.failNext = 100;
    t.drop();
    await e.shutdown();
    await new Promise((r) => setTimeout(r, 60));
    expect(t.starts).toBeLessThanOrEqual(2);
    expect(e.state).toBe("stopped");
  });

  it("a local engine that exits is dead, not reconnected", async () => {
    const t = new FakeRemote();
    const e = new KataGoEngine(t, settings({ backend: "local" }));
    await e.start();
    t.handlers.onStderr("Started, ready to begin handling requests");
    t.handlers.onExit(1);
    expect(e.state).toBe("dead");
    expect(t.starts).toBe(1);
  });
});
