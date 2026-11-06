import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { finishGmailConnect } from "@/lib/comms";
import { toast } from "@/components/ui";

/** Retour de Google après l'autorisation d'accès à Gmail. */
export function GmailCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const q = new URLSearchParams(window.location.search);
    const code = q.get("code");
    if (!code) {
      setError("Google n'a pas donné l'autorisation.");
      return;
    }
    finishGmailConnect(code, q.get("state") ?? "")
      .then(({ email }) => {
        toast(`Boîte ${email} reliée`);
        navigate("/echanges", { replace: true });
      })
      .catch((e: Error) => setError(e.message));
  }, [navigate]);
  return error ? (
    <p>
      {error} <Link to="/parametres" className="font-semibold text-pen">Retour aux paramètres</Link>
    </p>
  ) : (
    <p className="text-ink-soft">Liaison de Gmail en cours…</p>
  );
}
