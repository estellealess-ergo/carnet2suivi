# Consignes pour ce dépôt

Logiciel de suivi d'un cabinet libéral d'ergothérapie. Interface et textes en
français, en langage simple et non technique. Voir README.md pour l'état des étapes.

## Règles métier à respecter partout

- Toujours demander s'il faut enregistrer avant de quitter une page ou de fermer une saisie
  modifiée (`useUnsavedGuard` / `GuardProvider`).
- Seules les notes de séance reçoivent la date du jour par défaut. Ailleurs : pas de date
  automatique, l'utilisatrice choisit ; toutes les dates restent modifiables.
- Bouton Enregistrer toujours visible sur téléphone, même avec un long texte (barre collée en bas).
- La barre d'outils de gauche reste fixe et visible sur toutes les pages.
- Tableau de bord : tâches et prévisions d'aujourd'hui et des deux jours suivants ; les retards
  restent visibles.
- Une prévision reprise dans une note disparaît de la liste, mais peut être remise.
- Notes de séance en trois rubriques courtes : Fait / Observé / À reprendre (plus de DAP),
  professionnelles, claires et homogènes, utilisables telles quelles. Pendant la séance :
  mots-clés rapides ; après : débrief guidé de trois questions, à dicter.
- Jusqu'à 6 notes de séance ouvertes en même temps (notes côte à côte) ; patients réordonnables à la main.

## Règles techniques

- Toute écriture passe par `src/lib/repo.ts` (base locale + file d'envoi). Ne jamais écrire
  directement sur Supabase depuis l'interface : l'application doit fonctionner hors ligne.
- Jamais de suppression physique : `deleted_at`.
- Jamais de nom de patient envoyé à un service d'IA : passer par `askAssistant` (pseudonymisation).
- Toute nouvelle table : colonnes de synchronisation, déclencheurs, RLS et journal comme dans la
  migration de l'étape 1, et ajout dans `TABLES` (`src/lib/types.ts`) et dans `db.ts`.
- Avant de livrer : `npm run build` et `npm test`.
- Les échanges portant un `external_id` (Gmail) sont créés uniquement par les fonctions serveur,
  jamais par l'appareil (index unique côté serveur).
- La reprise Gmail ne prend que les adresses connues des fiches ou le libellé « Carnet de suivi ».
- Accès : un dossier est visible par sa propriétaire et les collègues avec qui il est partagé
  (`patient_shares`) ; un parent ne voit que les `family_reports` publiés de son enfant.
- Équipe et invitations : uniquement via la fonction serveur `team`.
- Jamais d'enregistrement audio (appel, séance, vocal) : uniquement la dictée de la praticienne,
  qui ne produit que du texte. Pour un échange, ne garder que les informations clés.

## Mode d'utilisation actuel

- La praticienne utilise l'app **sans serveur** (« sur cet appareil ») : pas d'abonnement supplémentaire.
  Toute fonction qui demande un serveur doit rester masquée quand `supabase` est absent.
- Version en ligne : GitHub Pages depuis ce dépôt (rendu public, il ne contient que du code,
  jamais de données ni de secrets). Chaque push sur `main` met l'app en ligne automatiquement
  (`.github/workflows/mise-en-ligne.yml`), à l'adresse https://estellealess-ergo.github.io/carnet2suivi/.
  Ne jamais committer de fichier `.env`, de clé, de donnée de patient, ni de nom ou d'adresse
  e-mail personnels (dépôt public). Auteur des commits : `estellealess-ergo <estellealess-ergo@users.noreply.github.com>`.
- Envoi aux familles : WhatsApp par lien (un clic par contact), pas d'API payante.
- Assistant sans serveur : IA intégrée à Chrome (`src/lib/local-ai.ts`, consignes dans `src/lib/prompts.ts`)
  ou copier-coller vers Claude avec pseudonymisation (`copyForClaude` / `pasteFromClaude`).
- Liaison directe téléphone ↔ ordinateur (`src/lib/peer-sync.ts`) : synchronise `TABLES` + `documents` sans serveur de données, messages chiffrés AES-GCM avec la clé de l'association. Toute nouvelle table locale à partager doit y être prise en compte.
- Documents joints et photos des notes (`note_id`, catégorie `photo`) : table locale `documents` (non synchronisée), incluse dans la sauvegarde chiffrée.
