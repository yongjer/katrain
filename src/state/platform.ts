// Everything that differs between the Tauri desktop app and a plain browser (used for UI development).

import type { EngineSettings, EngineTransport } from "../core/engine";

export interface OpenedFile {
  name: string;
  path: string | null;
  contents: string;
}

export interface ModelFile {
  path: string;
  name: string;
  size: number;
}

export interface DownloadProgress {
  name: string;
  received: number;
  total: number | null;
  done: boolean;
  error: string | null;
  path: string | null;
}

export interface Platform {
  isDesktop: boolean;
  /** Model files on disk (bundled, downloaded, ~/.katrain, and next to `extraPaths`). */
  listModels(extraPaths: string[]): Promise<ModelFile[]>;
  /** Resolve a katagotraining.org endpoint to a model URL. */
  resolveModelEndpoint(url: string): Promise<string>;
  /** Download a model; resolves to the saved path. */
  downloadModel(name: string, url: string): Promise<string>;
  onDownloadProgress(cb: (p: DownloadProgress) => void): Promise<() => void>;
  makeTransport(): EngineTransport;
  openGameFile(): Promise<OpenedFile | null>;
  /** Save to `path`, or ask where to save when path is null. Returns the path written, or null if cancelled. */
  saveTextFile(contents: string, suggestedName: string, path: string | null): Promise<string | null>;
  loadConfig(): Promise<string | null>;
  saveConfig(contents: string): Promise<void>;
}

type Handlers = Parameters<EngineTransport["setHandlers"]>[0];

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---------------------------------------------------------------- Tauri
class TauriTransport implements EngineTransport {
  private handlers: Handlers | null = null;
  private generation = 0;
  private listening: Promise<void> | null = null;

  setHandlers(h: Handlers) {
    this.handlers = h;
  }

  private listen(): Promise<void> {
    if (!this.listening) {
      this.listening = (async () => {
        const { listen } = await import("@tauri-apps/api/event");
        type Line = { generation: number; line: string };
        // Accept events from the newest process only; a restart bumps the generation.
        const current = (g: number) => {
          if (g < this.generation) return false;
          this.generation = g;
          return true;
        };
        await listen<Line>("katago-stdout", (e) => current(e.payload.generation) && this.handlers?.onStdout(e.payload.line));
        await listen<Line>("katago-stderr", (e) => current(e.payload.generation) && this.handlers?.onStderr(e.payload.line));
        await listen<{ generation: number; code: number | null }>(
          "katago-exit",
          (e) => e.payload.generation === this.generation && this.handlers?.onExit(e.payload.code),
        );
      })();
    }
    return this.listening;
  }

  async start(settings: EngineSettings) {
    await this.listen();
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{ generation: number; command: string[] }>("engine_start", { settings });
    this.generation = Math.max(this.generation, result.generation);
    this.handlers?.onStderr(`Started KataGo with ${result.command.join(" ")}`);
  }

  async send(line: string) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("engine_send", { line });
  }

  async stop() {
    const { invoke } = await import("@tauri-apps/api/core");
    this.generation++;
    await invoke("engine_stop");
  }
}

const GAME_FILTERS = [{ name: "Go game records", extensions: ["sgf", "gib", "ngf"] }];

const tauriPlatform: Platform = {
  isDesktop: true,
  async listModels(extraPaths) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ModelFile[]>("list_models", { extraPaths });
  },
  async resolveModelEndpoint(url) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("resolve_model_endpoint", { url });
  },
  async downloadModel(name, url) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("download_model", { name, url });
  },
  async onDownloadProgress(cb) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<DownloadProgress>("model-download", (e) => cb(e.payload));
  },
  makeTransport: () => new TauriTransport(),
  async openGameFile() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await open({ multiple: false, directory: false, filters: GAME_FILTERS });
    if (!path || Array.isArray(path)) return null;
    const contents = await invoke<string>("read_game_file", { path });
    return { name: path.split(/[\\/]/).pop() ?? path, path, contents };
  },
  async saveTextFile(contents, suggestedName, path) {
    const { invoke } = await import("@tauri-apps/api/core");
    let target = path;
    if (!target) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      target = await save({ defaultPath: suggestedName, filters: [{ name: "SGF", extensions: ["sgf"] }] });
      if (!target) return null;
    }
    await invoke("write_text_file", { path: target, contents });
    return target;
  },
  async loadConfig() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string | null>("load_config");
  },
  async saveConfig(contents) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_config", { contents });
  },
};

// ---------------------------------------------------------------- Browser (development)
/**
 * Talks to scripts/engine-bridge.mjs, a tiny local server that runs KataGo for browser-based UI work.
 * Without a bridge the app still runs; the engine simply reports that it is not available.
 */
class HttpBridgeTransport implements EngineTransport {
  private handlers: Handlers | null = null;
  private source: EventSource | null = null;
  private base: string | null = null;
  private token = "";
  constructor(bridge: string | null) {
    if (bridge) {
      const url = new URL(bridge);
      this.token = url.searchParams.get("token") ?? "";
      this.base = url.origin;
    }
  }

  private url(path: string, extra = "") {
    return `${this.base}${path}?token=${encodeURIComponent(this.token)}${extra}`;
  }

  setHandlers(h: Handlers) {
    this.handlers = h;
  }

  async start(settings: EngineSettings) {
    if (!this.base) throw new Error("No KataGo available in the browser. Run the desktop app, or start scripts/engine-bridge.mjs and open the URL it prints");
    this.source?.close();
    const res = await fetch(this.url("/start"), { method: "POST", body: JSON.stringify(settings) });
    if (!res.ok) throw new Error(await res.text());
    const { generation } = (await res.json()) as { generation: number };
    this.source = new EventSource(this.url("/events", `&generation=${generation}`));
    this.source.addEventListener("stdout", (e) => this.handlers?.onStdout((e as MessageEvent).data));
    this.source.addEventListener("stderr", (e) => this.handlers?.onStderr((e as MessageEvent).data));
    this.source.addEventListener("exit", (e) => {
      this.source?.close();
      this.handlers?.onExit(Number((e as MessageEvent).data));
    });
  }

  async send(line: string) {
    await fetch(this.url("/send"), { method: "POST", body: line });
  }

  async stop() {
    this.source?.close();
    this.source = null;
    if (this.base) await fetch(this.url("/stop"), { method: "POST" }).catch(() => {});
  }
}

const browserPlatform: Platform = {
  isDesktop: false,
  async listModels() {
    return [];
  },
  async resolveModelEndpoint() {
    throw new Error("Model downloads need the desktop app");
  },
  async downloadModel() {
    throw new Error("Model downloads need the desktop app");
  },
  async onDownloadProgress() {
    return () => {};
  },
  makeTransport: () => new HttpBridgeTransport(new URLSearchParams(window.location.search).get("bridge")),
  openGameFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".sgf,.gib,.ngf";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        resolve({ name: file.name, path: null, contents: await file.text() });
      };
      input.click();
    });
  },
  async saveTextFile(contents, suggestedName) {
    const url = URL.createObjectURL(new Blob([contents], { type: "application/x-go-sgf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return suggestedName;
  },
  async loadConfig() {
    try {
      return localStorage.getItem("katrain-config");
    } catch {
      return null;
    }
  },
  async saveConfig(contents) {
    try {
      localStorage.setItem("katrain-config", contents);
    } catch {
      /* storage unavailable */
    }
  },
};

export const platform: Platform = isTauri ? tauriPlatform : browserPlatform;
