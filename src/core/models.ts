// KataGo models KaTrain offers to download (katrain/gui/popups.py BaseConfigPopup).

export interface ModelEntry {
  name: string;
  url: string;
  humanlike?: boolean;
  /** approximate download size in MB, shown before downloading */
  sizeMb?: number;
}

/** Downloaded by the "Download Models" button. */
export const DOWNLOADABLE_MODELS: ModelEntry[] = [
  { name: "Human-like model", url: "https://github.com/lightvector/KataGo/releases/download/v1.15.0/b18c384nbt-humanv0.bin.gz", humanlike: true, sizeMb: 99 },
  { name: "old 15 block model", url: "https://github.com/lightvector/KataGo/releases/download/v1.3.2/g170e-b15c192-s1672170752-d466197061.txt.gz", sizeMb: 48 },
];

/** katagotraining.org endpoints that name the current distributed models; resolved before downloading. */
export const MODEL_ENDPOINTS: ModelEntry[] = [
  { name: "Latest distributed model", url: "https://katagotraining.org/api/networks/newest_training/" },
  { name: "Strongest distributed model", url: "https://katagotraining.org/api/networks/get_strongest/" },
];

/** Known models, used to describe files found on disk. */
export const KNOWN_MODELS: ModelEntry[] = [
  ...DOWNLOADABLE_MODELS,
  { name: "Small transformer model (b10c384)", url: "https://github.com/lightvector/KataGo/releases/download/v1.17.1/b10c384h6nbttflrs.bin.gz" },
  { name: "Medium transformer model (b10c512)", url: "https://github.com/lightvector/KataGo/releases/download/v1.17.1/b10c512h8nbt3tflrs-fson-silu-rsnh.bin.gz" },
  { name: "Large transformer model (b11c768)", url: "https://github.com/lightvector/KataGo/releases/download/v1.17.1/b11c768h12nbt3tflrs-fson-silu.bin.gz" },
  { name: "Recommended 18b model", url: "https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz" },
  { name: "old 20 block model", url: "https://github.com/lightvector/KataGo/releases/download/v1.4.5/g170e-b20c256x2-s5303129600-d1228401921.bin.gz" },
  { name: "old 30 block model", url: "https://github.com/lightvector/KataGo/releases/download/v1.4.5/g170-b30c320x2-s4824661760-d1229536699.bin.gz" },
  { name: "old 40 block model", url: "https://github.com/lightvector/KataGo/releases/download/v1.4.5/g170-b40c256x2-s5095420928-d1229425124.bin.gz" },
];

export const fileName = (pathOrUrl: string) => pathOrUrl.split(/[\\/]/).pop() ?? pathOrUrl;

export function describeModel(path: string): string {
  const file = fileName(path);
  const known = KNOWN_MODELS.find((m) => fileName(m.url) === file);
  return known ? `${known.name} — ${file}` : file;
}

export const isHumanModel = (path: string) => fileName(path).includes("human");
