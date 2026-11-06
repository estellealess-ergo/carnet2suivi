import { Plus } from "lucide-react";
import { useState } from "react";
import { TaskForm, TaskRow } from "@/components/bits";
import { Button, Empty, PageHeader } from "@/components/ui";
import { fullName } from "@/lib/labels";
import { usePatients, useTasks } from "@/lib/queries";

export function Tasks() {
  const patients = usePatients();
  const byId = new Map(patients.map((p) => [p.id, p]));
  // Les tâches d'un patient supprimé ne sont plus affichées.
  const tasks = useTasks().filter((t) => !t.patient_id || byId.has(t.patient_id));
  const [adding, setAdding] = useState(false);
  const todo = tasks.filter((t) => t.status === "a_faire");
  const done = tasks.filter((t) => t.status === "fait").reverse().slice(0, 50);

  return (
    <>
      <PageHeader title="Tâches" subtitle={`${todo.length} à faire`} />
      {adding ? (
        <div className="mb-5">
          <TaskForm patientId={null} onDone={() => setAdding(false)} />
        </div>
      ) : (
        <Button variant="primary" className="mb-5" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Nouvelle tâche du cabinet
        </Button>
      )}
      {todo.length === 0 ? (
        <Empty>Tout est fait.</Empty>
      ) : (
        <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet px-4">
          {todo.map((t) => (
            <TaskRow key={t.id} t={t} patientName={t.patient_id ? fullName(byId.get(t.patient_id)) : undefined} />
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer font-semibold text-ink-soft">Faites récemment</summary>
          <ul className="divide-y divide-rule">
            {done.map((t) => (
              <TaskRow key={t.id} t={t} patientName={t.patient_id ? fullName(byId.get(t.patient_id)) : undefined} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
