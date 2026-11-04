// Engine model selection and the "Download Models" button (katrain/gui/popups.py check_models / download_models).

import { useCallback, useEffect, useState } from "react";
import { t, tf } from "../core/i18n";
import { describeModel, DOWNLOADABLE_MODELS, fileName, isHumanModel, MODEL_ENDPOINTS, type ModelEntry } from "../core/models";
import { platform, type DownloadProgress, type ModelFile } from "../state/platform";

interface Props {
  model: string;
  humanlikeModel: string;
  onModel: (path: string) => void;
  onHumanlikeModel: (path: string) => void;
}

const mb = (n: number) => `${(n / 1e6).toFixed(0)} MB`;

export function ModelPicker({ model, humanlikeModel, onModel, onHumanlikeModel }: Props) {
  const [files, setFiles] = useState<ModelFile[]>([]);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setFiles(await platform.listModels([model, humanlikeModel]));
    } catch (e) {
      setMessage(String(e));
    }
  }, [model, humanlikeModel]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let unlisten = () => {};
    void platform
      .onDownloadProgress((p) => {
        setProgress((prev) => ({ ...prev, [p.name]: p }));
        if (p.done) void refresh();
      })
      .then((u) => (unlisten = u));
    return () => unlisten();
  }, [refresh]);

  const [catalog, setCatalog] = useState<ModelEntry[] | null>(null);

  /** Show the downloadable models; the distributed ones are looked up on katagotraining.org first. */
  const openCatalog = async () => {
    setMessage(null);
    if (catalog) {
      setCatalog(null);
      return;
    }
    const entries: ModelEntry[] = [...DOWNLOADABLE_MODELS];
    setCatalog(entries);
    for (const ep of MODEL_ENDPOINTS) {
      try {
        const url = await platform.resolveModelEndpoint(ep.url);
        entries.push({ name: ep.name, url });
        setCatalog([...entries]);
      } catch (e) {
        console.warn(`Failed to retrieve info for model: ${e}`);
      }
    }
  };

  const download = (m: ModelEntry) => {
    setProgress((prev) => ({ ...prev, [m.name]: { name: m.name, received: 0, total: null, done: false, error: null, path: null } }));
    platform
      .downloadModel(m.name, m.url)
      .then((path) => {
        // first human-like model: use it right away so the human-like AIs work
        if (m.humanlike && !humanlikeModel) onHumanlikeModel(path);
      })
      .catch((e) => setProgress((prev) => ({ ...prev, [m.name]: { ...prev[m.name], done: true, error: String(e) } })));
  };

  const normal = files.filter((f) => !isHumanModel(f.path));
  const human = files.filter((f) => isHumanModel(f.path));
  const options = (list: ModelFile[], current: string) => {
    const known = list.some((f) => f.path === current);
    return [
      ...(current && !known ? [<option key={current} value={current}>{describeModel(current)}</option>] : []),
      ...list.map((f) => (
        <option key={f.path} value={f.path}>
          {describeModel(f.path)} ({mb(f.size)})
        </option>
      )),
    ];
  };

  return (
    <div className="model-picker">
      {platform.isDesktop && (
        <>
          <label className="field">
            <span className="field-label">{t("engine:model")}</span>
            <span className="field-input">
              <select value={model} onChange={(e) => onModel(e.target.value)} aria-label={t("engine:model")}>
                {options(normal, model)}
              </select>
            </span>
            <span className="field-hint">{tf("models available", { num: normal.length })}</span>
          </label>
          <label className="field">
            <span className="field-label">{t("engine:humanlike_model")}</span>
            <span className="field-input">
              <select value={humanlikeModel} onChange={(e) => onHumanlikeModel(e.target.value)} aria-label={t("engine:humanlike_model")}>
                <option value="">—</option>
                {options(human, humanlikeModel)}
              </select>
            </span>
            <span className="field-hint">{tf("models available", { num: human.length })}</span>
          </label>
          <div className="download-row">
            <button className="text-button" onClick={() => void openCatalog()} aria-expanded={!!catalog}>
              {t("download models button")} {catalog ? "▴" : "▾"}
            </button>
            {message && <span className="muted">{message}</span>}
          </div>
          {catalog && (
            <div className="download-list">
              {catalog.map((m) => {
                const have = files.some((f) => f.name === fileName(m.url));
                const p = progress[m.name];
                return (
                  <div key={m.name} className={`download ${p?.error ? "error" : ""}`}>
                    <span className="download-name" title={fileName(m.url)}>
                      {m.name}
                      {m.sizeMb ? <span className="muted"> · {m.sizeMb} MB</span> : null}
                    </span>
                    {p?.error ? (
                      <span>{p.error}</span>
                    ) : have || p?.done ? (
                      <span className="downloaded">✓</span>
                    ) : p ? (
                      <>
                        <progress max={p.total ?? undefined} value={p.total ? p.received : undefined} />
                        <span>{p.total ? `${mb(p.received)} / ${mb(p.total)}` : p.received ? mb(p.received) : "…"}</span>
                      </>
                    ) : (
                      <button className="text-button small" onClick={() => download(m)} aria-label={`${t("download models button")}: ${m.name}`}>
                        ↓
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
