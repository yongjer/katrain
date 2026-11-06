// The app's handling of an engine that has stopped: the status bar keeps saying so, and the settings dialog or the
// engine indicator can start it again without changing any setting.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { EngineTransport } from "../src/core/engine";

type Handlers = Parameters<EngineTransport["setHandlers"]>[0];

const fake = vi.hoisted(() => {
  const t = {
    handlers: null as unknown as Parameters<EngineTransport["setHandlers"]>[0],
    starts: 0,
    sent: [] as string[],
    setHandlers(h: Handlers) {
      t.handlers = h;
    },
    async start() {
      t.starts++;
    },
    async send(line: string) {
      t.sent.push(line);
    },
    async stop() {},
  };
  return t;
});

vi.mock("../src/state/platform", () => ({
  platform: {
    isDesktop: true,
    loadConfig: async () => null,
    saveConfig: async () => {},
    makeTransport: () => fake,
    transportKind: () => "fake",
  },
}));

import { getEngine, init, playAt, requestCloseDialog, restartEngine, setDialogCloseGuard, openDialog, updateConfig, useStore } from "../src/state/store";

const until = async (cond: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

const status = () => useStore.getState().status;

/** Let KataGo (the fake transport) get ready, unless it has already stopped. */
async function ready() {
  fake.handlers.onStderr("Started, ready to begin handling requests");
  await until(() => getEngine()!.state === "ready");
}

/** Let the running KataGo crash. */
async function crash() {
  await ready();
  fake.handlers.onExit(1);
  expect(getEngine()!.state).toBe("dead");
}

describe("a stopped engine", () => {
  beforeAll(async () => {
    await init();
  });

  it("keeps its error in the status bar when a move is played", async () => {
    await crash();
    expect(status()?.level).toBe("error");
    playAt([3, 3]);
    expect(status()?.level).toBe("error");
    expect(status()?.message).toContain("Engine died unexpectedly");
  });

  it("restarts when the settings are applied unchanged", async () => {
    expect(getEngine()!.state).toBe("dead"); // since the test above
    const starts = fake.starts;
    fake.sent.length = 0;
    updateConfig((c) => void (c.engine = structuredClone(c.engine)), { restartDeadEngine: true });
    await until(() => fake.starts === starts + 1);
    expect(getEngine()!.isAlive).toBe(true);
    // the position that could not be analyzed is analyzed now
    await until(() => fake.sent.length > 0);
  });

  it("does not restart a running engine when the settings are applied unchanged", async () => {
    await ready();
    const starts = fake.starts;
    updateConfig(() => {}, { restartDeadEngine: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.starts).toBe(starts);
  });

  it("restarts from the engine indicator", async () => {
    await crash();
    const starts = fake.starts;
    await restartEngine();
    expect(fake.starts).toBe(starts + 1);
    expect(getEngine()!.isAlive).toBe(true);
  });
});

describe("closing a dialog", () => {
  it("asks the dialog's close guard first", () => {
    openDialog("settings");
    let blocking = true;
    setDialogCloseGuard(() => blocking);
    requestCloseDialog();
    expect(useStore.getState().dialog).toBe("settings");
    blocking = false;
    requestCloseDialog();
    expect(useStore.getState().dialog).toBeNull();
    setDialogCloseGuard(null);
  });
});
