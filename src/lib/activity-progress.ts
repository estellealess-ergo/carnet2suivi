/**
 * Progression d'une activité enregistrée, relue dans le texte des notes de séance.
 * Rien n'est stocké à part : une note corrigée à la main corrige aussi la courbe.
 */
import { fmtDay } from "./dates";
import { htmlToText } from "./html";
import { templateFields } from "./session-note";
import type { Activity, IsoDay, Note } from "./types";

export type Measure = { date: IsoDay; noteId: string; values: Record<string, string> };

const escRe = (s: string) => s.replace(/[.*+?^${}()|\\]/g, "\\$&");

// Une case peut contenir « ; » (touche du clavier) mais pas le séparateur « espace ; espace » entre deux éléments.
const FIELD = "((?:(?! ; )[^\\n])+?)";
const LAST = "((?:(?! ; )[^\\n])+)";

/** « leçon [leçon] : [vitesse] mpm » → expression qui retrouve les valeurs dans le texte d'une note. */
export function templateRegex(template: string): RegExp {
  const parts = template.trim().split(/(\[[^\]]+\])/);
  const src = parts
    .map((p) => (/^\[[^\]]+\]$/.test(p) ? FIELD : escRe(p).replace(/\s+/g, "\\s*")))
    .join("");
  // La dernière case va jusqu'au séparateur « ; » entre deux éléments, ou à la fin de ligne.
  return new RegExp(src.endsWith(FIELD) ? src.slice(0, -FIELD.length) + LAST : src, "gi");
}

export function activityHistory(a: Activity, notes: Note[]): Measure[] {
  const fields = templateFields(a.template);
  const re = templateRegex(a.template);
  const out: Measure[] = [];
  for (const n of [...notes].filter((x) => x.kind === "seance" && !x.deleted_at).sort((x, y) => x.note_date.localeCompare(y.note_date))) {
    const text = htmlToText(n.content_html);
    for (const m of text.matchAll(re)) {
      // Une case de modèle peut apparaître plusieurs fois : la première valeur compte.
      const names = [...a.template.matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]!.trim());
      const values: Record<string, string> = {};
      names.forEach((k, i) => (values[k] ??= (m[i + 1] ?? "").trim()));
      if (fields.some((f) => values[f] && values[f] !== "—")) out.push({ date: n.note_date, noteId: n.id, values });
    }
  }
  return out;
}

export function toNumber(v?: string): number | null {
  if (!v) return null;
  const m = v.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*%?$/);
  return m ? Number(m[1]!.replace(",", ".")) : null;
}

/** Unité écrite juste après la case dans le modèle : « [vitesse] mpm » → « mpm », « [précision] % » → « % ». */
export function fieldUnit(template: string, field: string): string {
  const m = template.match(new RegExp(`\\[${escRe(field)}\\]\\s*(%|[A-Za-zÀ-ÿ/]{1,6})(?=[\\s,;.)]|$)`));
  return m?.[1] ?? "";
}

/** Cases chiffrées avec au moins deux valeurs : ce sont elles qui ont une courbe. */
export function numericFields(a: Activity, history: Measure[]): string[] {
  return templateFields(a.template).filter((f) => history.filter((h) => toNumber(h.values[f]) !== null).length >= 2);
}

export function seriesOf(history: Measure[], field: string) {
  return history.map((h) => ({ date: h.date, value: toNumber(h.values[field]) })).filter((p): p is { date: IsoDay; value: number } => p.value !== null);
}

const fmtNum = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** Phrase de synthèse, pour l'écran et le compte rendu d'évolution. */
export function progressSentence(a: Activity, history: Measure[]): string {
  if (!history.length) return "";
  const parts = numericFields(a, history).map((f) => {
    const s = seriesOf(history, f);
    const unit = fieldUnit(a.template, f);
    const u = unit === "%" ? " %" : unit ? ` ${unit}` : "";
    return `${f} de ${fmtNum(s[0]!.value)}${u} à ${fmtNum(s.at(-1)!.value)}${u}`;
  });
  const span = history.length > 1 ? `${history.length} séances, du ${fmtDay(history[0]!.date)} au ${fmtDay(history.at(-1)!.date)}` : `1 séance, le ${fmtDay(history[0]!.date)}`;
  return `${a.title} (${span})${parts.length ? ` : ${parts.join(" ; ")}` : ""}.`;
}

/* ------------------------------------------------------------------ géométrie du graphique */

export const CHART = { w: 560, h: 200, left: 44, right: 56, top: 16, bottom: 30 };

function niceStep(range: number, target = 4) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

export function chartGeometry(points: { date: string; value: number }[], unit: string) {
  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) (lo -= 1), (hi += 1);
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (unit === "%") (lo = Math.max(0, lo)), (hi = Math.min(100, Math.max(hi, lo + step)));
  if (lo < 0 && Math.min(...vals) >= 0) lo = 0;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 1000; t += step) ticks.push(Math.round(t * 1000) / 1000);
  const { w, h, left, right, top, bottom } = CHART;
  const x = (i: number) => (points.length === 1 ? left + (w - left - right) / 2 : left + (i * (w - left - right)) / (points.length - 1));
  const y = (v: number) => top + ((hi - v) * (h - top - bottom)) / (hi - lo || 1);
  return { ticks, x, y, pts: points.map((p, i) => ({ ...p, cx: x(i), cy: y(p.value) })) };
}

const C = { line: "#2f5d86", grid: "#dbe2e7", text: "#55636e", ink: "#1f2a33", surface: "#ffffff" };
const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Le même graphique en SVG autonome, pour l'image du compte rendu Word. */
export function chartSvgString(points: { date: string; value: number }[], unit: string, title: string): string {
  const { ticks, y, pts } = chartGeometry(points, unit);
  const { w, h, left, right } = CHART;
  const u = unit === "%" ? " %" : unit ? ` ${unit}` : "";
  const every = Math.ceil(pts.length / 6);
  const H = h + 26;
  const g = (s: string) => `<g transform="translate(0,26)">${s}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" font-family="Calibri, Arial, sans-serif">
<rect width="${w}" height="${H}" fill="${C.surface}"/>
<text x="0" y="16" font-size="14" font-weight="bold" fill="${C.ink}">${escXml(title)}</text>
${g(
  ticks.map((t) => `<line x1="${left}" x2="${w - right}" y1="${y(t)}" y2="${y(t)}" stroke="${C.grid}" stroke-width="1"/><text x="${left - 6}" y="${y(t) + 4}" font-size="11" text-anchor="end" fill="${C.text}">${fmtNum(t)}</text>`).join("") +
    pts.map((p, i) => (i % every === 0 || i === pts.length - 1 ? `<text x="${p.cx}" y="${h - 10}" font-size="11" text-anchor="middle" fill="${C.text}">${fmtDay(p.date).slice(0, 5)}</text>` : "")).join("") +
    (pts.length > 1 ? `<polyline points="${pts.map((p) => `${p.cx},${p.cy}`).join(" ")}" fill="none" stroke="${C.line}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : "") +
    pts.map((p) => `<circle cx="${p.cx}" cy="${p.cy}" r="4" fill="${C.line}" stroke="${C.surface}" stroke-width="2"/>`).join("") +
    `<text x="${pts.at(-1)!.cx + 8}" y="${pts.at(-1)!.cy + 4}" font-size="12" font-weight="bold" fill="${C.ink}">${fmtNum(pts.at(-1)!.value)}${u}</text>`,
)}
</svg>`;
}

/** SVG → PNG (navigateur), pour Word. */
export async function svgToPng(svg: string, scale = 2): Promise<{ data: Uint8Array; width: number; height: number }> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  await new Promise<void>((res, rej) => ((img.onload = () => res()), (img.onerror = rej), (img.src = url)));
  const canvas = document.createElement("canvas");
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
  return { data: new Uint8Array(await blob.arrayBuffer()), width: img.width, height: img.height };
}
