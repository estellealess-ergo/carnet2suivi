import { TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { CHART, activityHistory, chartGeometry, fieldUnit, numericFields, progressSentence, seriesOf, type Measure } from "@/lib/activity-progress";
import { fmtDay } from "@/lib/dates";
import { useNotes } from "@/lib/queries";
import { templateFields } from "@/lib/session-note";
import type { Activity, Patient } from "@/lib/types";
import { useActivities } from "./ActivityPicker";
import { Empty } from "./ui";

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Onglet Progression : une courbe par mesure chiffrée de chaque activité enregistrée. */
export function ProgressTab({ patient }: { patient: Patient }) {
  const notes = useNotes(patient.id);
  const activities = useActivities();
  const data = useMemo(
    () => activities.map((a) => ({ a, h: activityHistory(a, notes) })).filter((x) => x.h.length > 0),
    [activities, notes],
  );
  if (!data.length)
    return (
      <Empty>
        Les courbes apparaissent ici dès qu'une activité enregistrée (par exemple TypingClub) a été ajoutée dans les
        notes de séance de {patient.first_name}, avec des chiffres (vitesse, précision…).
      </Empty>
    );
  return (
    <div className="space-y-6">
      {data.map(({ a, h }) => (
        <ActivityProgress key={a.id} a={a} h={h} />
      ))}
    </div>
  );
}

function ActivityProgress({ a, h }: { a: Activity; h: Measure[] }) {
  const nums = numericFields(a, h);
  const fields = templateFields(a.template);
  return (
    <section className="rounded-lg border border-rule bg-sheet p-4">
      <h2 className="flex items-center gap-2">
        <TrendingUp className="size-5 text-pen" aria-hidden /> {a.title}
      </h2>
      <p className="mb-3 text-sm text-ink-soft">{progressSentence(a, h)}</p>
      {nums.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {nums.map((f) => {
            const unit = fieldUnit(a.template, f);
            return <LineChart key={f} title={`${cap(f)}${unit ? ` (${unit})` : ""}`} unit={unit} points={seriesOf(h, f)} />;
          })}
        </div>
      ) : (
        <p className="text-sm text-ink-soft">Pas encore assez de valeurs chiffrées pour une courbe (il en faut au moins deux).</p>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-pen">Voir le tableau des séances</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-ink-soft">
                <th className="py-1 pr-3 font-semibold">Date</th>
                {fields.map((f) => (
                  <th key={f} className="py-1 pr-3 font-semibold">
                    {cap(f)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {h.map((m, i) => (
                <tr key={i} className="border-b border-rule last:border-0">
                  <td className="py-1 pr-3">{fmtDay(m.date)}</td>
                  {fields.map((f) => (
                    <td key={f} className="py-1 pr-3 tabular-nums">
                      {m.values[f] || "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

/** Courbe simple : une seule série par graphique (pas de second axe), survol pour lire chaque séance. */
export function LineChart({ title, unit, points }: { title: string; unit: string; points: { date: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const { ticks, y, pts } = chartGeometry(points, unit);
  const { w, h, left, right } = CHART;
  const u = unit === "%" ? " %" : unit ? ` ${unit}` : "";
  const every = Math.ceil(pts.length / 6);
  const last = pts.at(-1)!;
  const hp = hover !== null ? pts[hover] : null;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-sm font-semibold">{title}</figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={`${title} : de ${fmt(pts[0]!.value)} à ${fmt(last.value)}${u}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={w - right} y1={y(t)} y2={y(t)} stroke="var(--color-rule)" strokeWidth={1} />
              <text x={left - 6} y={y(t) + 4} fontSize={11} textAnchor="end" fill="var(--color-ink-soft)">
                {fmt(t)}
              </text>
            </g>
          ))}
          {pts.map((p, i) =>
            i % every === 0 || i === pts.length - 1 ? (
              <text key={i} x={p.cx} y={h - 10} fontSize={11} textAnchor="middle" fill="var(--color-ink-soft)">
                {fmtDay(p.date).slice(0, 5)}
              </text>
            ) : null,
          )}
          {hp && <line x1={hp.cx} x2={hp.cx} y1={CHART.top} y2={h - CHART.bottom} stroke="var(--color-ink-soft)" strokeWidth={1} />}
          {pts.length > 1 && (
            <polyline
              points={pts.map((p) => `${p.cx},${p.cy}`).join(" ")}
              fill="none"
              stroke="var(--color-pen)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {pts.map((p, i) => (
            <circle key={i} cx={p.cx} cy={p.cy} r={hover === i ? 6 : 4} fill="var(--color-pen)" stroke="var(--color-sheet)" strokeWidth={2} />
          ))}
          <text x={last.cx + 8} y={last.cy + 4} fontSize={12} fontWeight={700} fill="var(--color-ink)">
            {fmt(last.value)}
            {u}
          </text>
          {/* Zones de survol plus larges que les points. */}
          {pts.map((p, i) => {
            const half = pts.length > 1 ? (pts[1]!.cx - pts[0]!.cx) / 2 : 40;
            return (
              <rect
                key={i}
                x={p.cx - half}
                y={0}
                width={half * 2}
                height={h}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onTouchStart={() => setHover(i)}
              />
            );
          })}
        </svg>
        {hp && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-rule bg-sheet px-2 py-1 text-xs shadow"
            style={{ left: `${(hp.cx / w) * 100}%`, top: 0 }}
          >
            <span className="text-ink-soft">{fmtDay(hp.date)}</span> · <strong>{fmt(hp.value)}{u}</strong>
          </div>
        )}
      </div>
    </figure>
  );
}
