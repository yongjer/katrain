// Loads KaTrain's gettext catalogs (katrain/i18n/locales/*/LC_MESSAGES/katrain.po).
// English is bundled; other languages are loaded on demand.

import englishSource from "../../katrain/i18n/locales/en/LC_MESSAGES/katrain.po?raw";
import { parsePo, setCatalogs } from "../core/i18n";

const loaders = import.meta.glob("../../katrain/i18n/locales/*/LC_MESSAGES/katrain.po", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

const english = parsePo(englishSource);
const available = new Map<string, () => Promise<string>>();
for (const [path, load] of Object.entries(loaders)) {
  const lang = /locales\/([^/]+)\//.exec(path)?.[1];
  if (lang) available.set(lang, load);
}

export const LANGUAGES: [string, string][] = (
  [
    ["en", "English"],
    ["tw", "繁體中文"],
    ["cn", "简体中文"],
    ["jp", "日本語"],
    ["ko", "한국어"],
    ["de", "Deutsch"],
    ["es", "Español"],
    ["fr", "Français"],
    ["ru", "Русский"],
    ["tr", "Türkçe"],
    ["ua", "Українська"],
  ] as [string, string][]
).filter(([code]) => available.has(code));

const cache = new Map<string, Record<string, string>>([["en", english]]);
setCatalogs(english, english);

export async function setLanguage(lang: string) {
  let catalog = cache.get(lang);
  if (!catalog) {
    const load = available.get(lang);
    catalog = load ? parsePo(await load()) : english;
    cache.set(lang, catalog);
  }
  setCatalogs(english, catalog);
  document.documentElement.lang = ({ tw: "zh-Hant", cn: "zh-Hans", jp: "ja", ua: "uk" } as Record<string, string>)[lang] ?? lang;
}
