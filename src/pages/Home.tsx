import { Link } from "react-router";
import { DueLabel, TaskRow } from "@/components/bits";
import { PageHeader, Pill } from "@/components/ui";
import { useLiveQuery } from "dexie-react-hooks";
import { bucketByHorizon, fmtLongDay, localDay, relativeDay } from "@/lib/dates";
import { db } from "@/lib/db";
import { groupsOf, patientsForDay } from "@/lib/schedule";
import { GroupBanners } from "./Journee";
import { fullName } from "@/lib/labels";
import { useForecasts, usePatients, useTasks } from "@/lib/queries";
import type { Forecast, Patient, Task } from "@/lib/types";

/**
 * Accueil : ce qui est à faire et prévu aujourd'hui et les deux jours suivants.
 * Tout ce qui est en retard reste affiché tant que ce n'est pas traité.
 */
export function Home() {
  const today = localDay();
  const patients = usePatients();
  const byId = new Map(patients.map((p) => [p.id, p]));
  // Les éléments d'un patient supprimé ne sont plus affichés.
  const tasks = useTasks().filter((t) => t.status === "a_faire" && (!t.patient_id || byId.has(t.patient_id)));
  const forecasts = useForecasts().filter((f) => f.status === "a_faire" && byId.has(f.patient_id));

  type Item = { kind: "task"; t: Task } | { kind: "forecast"; f: Forecast };
  const items: Item[] = [
    ...tasks.map((t) => ({ kind: "task" as const, t })),
    ...forecasts.map((f) => ({ kind: "forecast" as const, f })),
  ];
  const { overdue, days } = bucketByHorizon(items, (i) => (i.kind === "task" ? i.t.due_date : i.f.planned_date), today);
  const undatedUrgent = tasks.filter((t) => t.urgent && !t.due_date);
  const changes = useLiveQuery(() => db.day_changes.where("day").equals(today).toArray(), [today]) ?? [];
  const todays = patientsForDay(patients, changes, today).entries;

  return (
    <>
      <PageHeader
        title={<span className="first-letter:uppercase">{fmtLongDay(today)}</span>}
        subtitle={
          todays.length
            ? `${todays.length} patient${todays.length > 1 ? "s" : ""} prévu${todays.length > 1 ? "s" : ""} aujourd'hui.`
            : "Aucun patient prévu aujourd'hui."
        }
        actions={
          <Link to="/journee" className="inline-flex h-10 items-center rounded-md bg-pen px-3.5 font-semibold text-white">
            Ouvrir ma journée
          </Link>
        }
      />

      <GroupBanners groups={groupsOf(todays)} day={today} />

      {(overdue.length > 0 || undatedUrgent.length > 0) && (
        <section className="mb-8 rounded-lg border border-late/30 bg-late-soft/50 p-4" aria-labelledby="late">
          <h2 id="late" className="mb-2 text-late">
            En retard ou urgent
          </h2>
          <ItemList items={[...overdue, ...undatedUrgent.map((t) => ({ kind: "task" as const, t }))]} byId={byId} />
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {days.map((d) => (
          <section key={d.day} aria-labelledby={`d-${d.day}`}>
            <h2 id={`d-${d.day}`} className="mb-1 flex items-baseline gap-2 border-b-2 border-ink pb-1">
              {relativeDay(d.day, today)}
              <span className="text-sm font-normal text-ink-soft">{fmtLongDay(d.day)}</span>
            </h2>
            {d.items.length === 0 ? (
              <p className="py-2 text-sm text-ink-soft">Rien de prévu.</p>
            ) : (
              <ItemList items={d.items} byId={byId} hideDate />
            )}
          </section>
        ))}
      </div>
    </>
  );
}

function ItemList({
  items,
  byId,
  hideDate,
}: {
  items: ({ kind: "task"; t: Task } | { kind: "forecast"; f: Forecast })[];
  byId: Map<string, Patient>;
  hideDate?: boolean;
}) {
  return (
    <ul className="divide-y divide-rule">
      {items.map((i) =>
        i.kind === "task" ? (
          <TaskRow key={i.t.id} t={i.t} hideDate={hideDate} patientName={i.t.patient_id ? fullName(byId.get(i.t.patient_id)) : undefined} />
        ) : (
          <li key={i.f.id} className="py-2 pl-9">
            <p>
              <Link to={`/patients/${i.f.patient_id}?onglet=previsions`} className="font-semibold hover:underline">
                {fullName(byId.get(i.f.patient_id))}
              </Link>{" "}
              : {i.f.content}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Pill tone="pen">Prévision</Pill>
              {!hideDate && <DueLabel day={i.f.planned_date} />}
            </div>
          </li>
        ),
      )}
    </ul>
  );
}
