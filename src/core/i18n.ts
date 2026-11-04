// Minimal gettext-style translation layer. KaTrain's .po catalogs are loaded by the UI
// (see src/ui/i18nLoader.ts); the core only needs lookup and Python-style formatting.

type Catalog = Record<string, string>;

let fallback: Catalog = {};
let active: Catalog = {};

export function setCatalogs(english: Catalog, selected: Catalog) {
  fallback = english;
  active = selected;
}

/** Translate a msgid, falling back to English and then to the msgid itself. */
export function t(msgid: string): string {
  return active[msgid] || fallback[msgid] || msgid;
}

/** Translate and fill Python str.format style placeholders: {name}, {name:.1f}, {name:.2%}. */
export function tf(msgid: string, values: Record<string, unknown>): string {
  return pyFormat(t(msgid), values);
}

export function pyFormat(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)(?::([^}]*))?\}/g, (whole, name: string, spec: string | undefined) => {
    if (!(name in values)) return whole;
    const v = values[name];
    if (spec === undefined || spec === "") return String(v);
    const m = /^([+])?\.(\d+)([f%])$/.exec(spec);
    if (!m || typeof v !== "number") return String(v);
    const digits = parseInt(m[2], 10);
    let s = m[3] === "%" ? `${(v * 100).toFixed(digits)}%` : v.toFixed(digits);
    if (m[1] === "+" && v >= 0) s = `+${s}`;
    return s;
  });
}

/** Parse a gettext .po file into msgid -> msgstr, skipping empty translations. */
export function parsePo(source: string): Catalog {
  const catalog: Catalog = {};
  let msgid: string | null = null;
  let msgstr: string | null = null;
  let target: "id" | "str" | null = null;
  const unquote = (s: string) => JSON.parse(s.replace(/\t/g, "\\t")) as string;
  const flush = () => {
    if (msgid !== null && msgid !== "" && msgstr) catalog[msgid] = msgstr;
    msgid = msgstr = null;
    target = null;
  };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#") || line === "") {
      if (line === "") flush();
      continue;
    }
    if (line.startsWith("msgid ")) {
      flush();
      msgid = unquote(line.slice(6));
      target = "id";
    } else if (line.startsWith("msgstr ")) {
      msgstr = unquote(line.slice(7));
      target = "str";
    } else if (line.startsWith('"')) {
      if (target === "id") msgid = (msgid ?? "") + unquote(line);
      else if (target === "str") msgstr = (msgstr ?? "") + unquote(line);
    }
  }
  flush();
  return catalog;
}
