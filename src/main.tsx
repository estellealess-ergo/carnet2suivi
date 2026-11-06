import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/400-italic.css";
import "@fontsource/atkinson-hyperlegible-next/600.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Shell } from "./components/Shell";
import { AuthProvider, useAuth } from "./lib/auth";
import { initPeerSync } from "./lib/peer-sync";
import { Exchanges } from "./pages/Exchanges";
import { FamilySend } from "./pages/FamilySend";
import { FamilySpace } from "./pages/FamilySpace";
import { GmailCallback } from "./pages/GmailCallback";
import { Home } from "./pages/Home";
import { Journee } from "./pages/Journee";
import { Login } from "./pages/Login";
import { PatientDetail } from "./pages/PatientDetail";
import { Patients } from "./pages/Patients";
import { Settings } from "./pages/Settings";
import { SideBySide } from "./pages/SideBySide";
import { Tasks } from "./pages/Tasks";

// L'application peut être servie dans un sous-dossier (ex. GitHub Pages : /carnet2suivi-app/).
const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined;

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/journee", element: <Journee /> },
      { path: "/patients", element: <Patients /> },
      { path: "/patients/:id", element: <PatientDetail /> },
      { path: "/notes", element: <SideBySide /> },
      { path: "/taches", element: <Tasks /> },
      { path: "/parametres", element: <Settings /> },
      { path: "/echanges", element: <Exchanges /> },
      { path: "/envoi", element: <FamilySend /> },
      { path: "/connexion-gmail", element: <GmailCallback /> },
      { path: "*", element: <Home /> },
    ],
  },
], { basename });

function Gate() {
  const { ready, session, localOnly, mode } = useAuth();
  if (!ready) return null;
  if (!localOnly && !session) return <Login />;
  if (mode === "famille") return <FamilySpace />;
  return <RouterProvider router={router} />;
}

// Demande au navigateur de ne pas effacer la base locale en cas de manque de place.
void navigator.storage?.persist?.();

// Liaison directe téléphone ↔ ordinateur, si les appareils ont été reliés.
void initPeerSync();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <Gate />
    </AuthProvider>
  </StrictMode>,
);
