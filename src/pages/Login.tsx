import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button, Field, Input } from "@/components/ui";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "link">("password");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError("Adresse e-mail ou mot de passe incorrect.");
    } else {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
      });
      if (error) setError("Impossible d'envoyer le lien. Vérifie l'adresse e-mail.");
      else setMessage("Lien de connexion envoyé. Ouvre l'e-mail sur cet appareil.");
    }
    setBusy(false);
  }

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-rule bg-sheet p-6">
        <h1 className="mb-1">Carnet de suivi</h1>
        <p className="mb-6 text-ink-soft">Connexion à l'espace du cabinet.</p>
        <div className="space-y-4">
          <Field label="Adresse e-mail">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {mode === "password" && (
            <Field label="Mot de passe">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
          {error && <p className="text-sm text-late">{error}</p>}
          {message && <p className="text-sm text-done">{message}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {mode === "password" ? "Se connecter" : "Recevoir un lien de connexion"}
          </Button>
          <button
            type="button"
            className="w-full text-sm text-pen underline-offset-2 hover:underline"
            onClick={() => setMode(mode === "password" ? "link" : "password")}
          >
            {mode === "password" ? "Se connecter par lien e-mail" : "Se connecter avec le mot de passe"}
          </button>
        </div>
      </form>
    </main>
  );
}
