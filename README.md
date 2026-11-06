# Carnet de suivi (carnet2suivi)

Logiciel de suivi des patients d'un cabinet libéral d'ergothérapie, reconstruit à partir
d'ErgoCabinet (ancien dépôt `estellealess-ergo/ergocabinet`, créé avec Lovable).

C'est une **application web installable** sur ordinateur, iPhone et Android. Elle fonctionne
**hors connexion** : tout s'enregistre d'abord sur l'appareil, puis se synchronise avec le serveur
du cabinet dès que le réseau revient.

Elle complète Docorga (agenda, facturation) et Indy (comptabilité), qui ne sont pas refaits ici.

## Où en est la reconstruction

| Étape | Contenu | État |
| --- | --- | --- |
| 1 | Socle clinique : connexion, patients, Ma journée, notes de séance (Fait / Observé / À reprendre, dictée, versions), prévisions, tâches, bilans, objectifs, export Word, hors ligne, installation | **Fait** |
| 2 | Communications : Gmail rattaché aux patients, échanges notés par dictée, envoi aux familles | **Fait** (à tester avec le serveur) |
| 3 | Équipe du cabinet (partage dossier par dossier) et espace famille | **Fait** (à tester avec le serveur) |
| 4 | Reprise des données d'ErgoCabinet | **Fait** : écran dans Paramètres |

## Ce que fait l'étape 1

- **Accueil** : tâches et prévisions d'aujourd'hui, de demain et d'après-demain. Ce qui est en
  retard reste affiché tant que ce n'est pas traité.
- **Ma journée** : les patients du jour, dans l'ordre choisi (glisser-déposer ou flèches),
  l'information « À ne pas oublier » surlignée, les prévisions, la dernière séance, la note de
  séance et « La prochaine fois ».
- **Patients** : recherche, filtre par statut, ordre manuel.
- **Fiche patient** : l'information épinglée toujours en haut, puis les onglets Notes,
  Prévisions, À préparer, Bilans, Objectifs, Informations. Export Word du dossier sur une période.
- **Notes de séance en trois rubriques** : Fait, Observé, À reprendre.
  - Pendant la séance : quelques mots-clés en deux secondes (« puzzle 12/15 aide verbale »), avec
    des boutons pour les débuts de mots-clés déjà utilisés.
  - Juste après : « Débrief de la séance » pose trois questions courtes, une à une, à dicter ;
    les mots-clés pré-remplissent « Observé ». La note est composée automatiquement, même hors ligne.
- **Notes de séance** : texte mis en forme (gras, italique, souligné, couleurs, listes), dictée,
  mise au propre en trois rubriques par l'assistant, retour au texte d'origine, historique des
  versions, brouillon de secours enregistré toutes les 3 secondes.
- **Recherche rapide** : en haut à gauche, ou Ctrl+K (Cmd+K sur Mac), depuis n'importe quelle page.
- **Ma journée par date** : jour précédent / suivant, rythme une semaine sur deux (semaines paires ou
  impaires), « Pas de séance ce jour-là » et « Ajouter un patient ce jour-là » pour les changements ponctuels.
- **Documents** (onglet de la fiche) : PDF, images, courriers, gardés sur l'appareil et inclus dans la
  sauvegarde chiffrée.
- **Bilans** : boutons pour les tests habituels du cabinet. **Objectifs travaillés** cochés dans la note
  de séance, visibles dans l'onglet Objectifs.
- **Assistant de rédaction sans serveur** : IA intégrée à Chrome sur ordinateur (gratuite, le texte ne
  quitte pas l'appareil), à activer dans Paramètres ; sinon « Copier pour Claude » / « Coller la
  réponse », avec le nom du patient masqué.
- **Notes côte à côte** : jusqu'à six notes ouvertes en même temps. On coche les patients sur la
  page (patients du jour en premier) ou directement dans Ma journée.
- **Prévisions** : reprises dans une note en un clic ; elles disparaissent alors de la liste et
  peuvent être remises en prévision depuis l'historique.
- **Paramètres** : état de la synchronisation, installation, sauvegarde et restauration.

## Étapes 2 à 4

- **Échanges** (page et onglet de la fiche) : e-mails, appels, messages vocaux, SMS notés à la main.
  Après un appel, la praticienne **dicte** ce qui a été dit ; « Garder les informations clés »
  le réduit à l'essentiel (qui, à quel sujet, ce qu'il faut faire). Ce qui n'est rattaché à aucun
  patient apparaît dans « À rattacher ».
- **Aucun enregistrement** : l'application n'enregistre jamais un appel ni une séance. Seule la
  praticienne parle au micro, comme avec la dictée du téléphone, et seul le texte est gardé.
- **Gmail** : seuls les e-mails échangés avec les adresses des fiches (patient ou famille) sont repris.
  Un autre e-mail peut être envoyé dans l'application avec le libellé Gmail « Carnet de suivi ».
- **Envoi aux familles** : pour chaque séance du jour, un court message (proposé par l'assistant ou
  écrit à la main), relu, puis envoyé par e-mail, ouvert dans Messages, copié ou publié dans
  l'espace famille.
- **Famille** (onglet de la fiche) : responsables légaux, qui reçoit les comptes rendus, invitation
  dans l'espace famille, historique de ce qui a été transmis.
- **Équipe** (Paramètres) : création du cabinet, invitation d'une collègue. Chaque dossier reste
  privé tant qu'il n'est pas partagé (onglet Informations de la fiche). Un partage retiré efface
  le dossier de l'appareil de la collègue.
- **Espace famille** : un parent invité se connecte par lien e-mail et ne voit que les comptes
  rendus publiés pour son enfant.
- **Reprise d'ErgoCabinet** (Paramètres) : voir [docs/reprise-ergocabinet.md](docs/reprise-ergocabinet.md).

### Règles de fonctionnement

- Avant de quitter une page ou de fermer une saisie modifiée, l'application demande toujours
  s'il faut enregistrer.
- Seules les notes de séance reçoivent la date du jour par défaut. Partout ailleurs, la date
  est choisie par l'utilisatrice, et toutes les dates restent modifiables.
- Sur téléphone, le bouton Enregistrer reste visible même avec un long texte.
- La barre d'outils de gauche reste fixe sur toutes les pages.

## Données de santé : ce qui est prévu

- **Serveur** : Supabase **auto-hébergé chez un hébergeur certifié HDS** (OVHcloud ou Scaleway,
  offre HDS). Voir [docs/hebergement-hds.md](docs/hebergement-hds.md).
- **Cloisonnement** : chaque compte ne voit que ses dossiers (règles RLS simples, sans fonction
  `SECURITY DEFINER`, contrairement à l'ancienne version).
- **Traçabilité** : chaque création, modification et suppression est inscrite dans `audit_log`.
- **Pas de suppression définitive** depuis l'application (suppression « douce »).
- **Assistant IA** (mise au propre, objectifs SMART) : le nom du patient est **retiré sur
  l'appareil** avant l'envoi et remis dans la réponse. Le serveur appelle un fournisseur hébergé
  dans l'UE (Mistral AI par défaut). Sans serveur, ou hors connexion, l'assistant est masqué.
- **Gmail** : Google n'est pas un hébergeur HDS. Le contenu des e-mails repris est stocké sur le
  serveur HDS, mais les e-mails eux-mêmes restent dans Gmail. À inscrire au registre RGPD.
- **Dictée** : elle utilise la reconnaissance vocale du navigateur. Sur Chrome et Edge, le son est
  traité par les serveurs de Google ou Microsoft. Sur iPhone, la dictée du clavier Apple peut
  traiter le son sur l'appareil. À valider avec le DPO avant un usage réel.
- **Appareil** : les données hors ligne sont dans la base du navigateur, protégées par la session
  de l'appareil. Utiliser des appareils verrouillés par code. À la déconnexion, on peut effacer
  l'appareil.

## Mode local (essai)

Sans adresse de serveur dans `.env`, l'application fonctionne entièrement sur l'appareil, sans
compte. Pratique pour l'essayer, mais **pas pour de vrais dossiers** : il n'y a ni sauvegarde
serveur ni synchronisation. Penser à la sauvegarde manuelle dans Paramètres.

## Pour les développeurs

```bash
npm install
cp .env.example .env      # renseigner l'adresse et la clé publique du Supabase HDS
npm run dev               # http://localhost:5173
npm test                  # tests (synchronisation, dates, masquage des noms, export Word)
npm run build             # version de production dans dist/
```

- React 19, Vite, Tailwind CSS 4, React Router 7.
- Base locale : Dexie (IndexedDB). Toute l'interface lit la base locale.
- Synchronisation : `src/lib/sync.ts` (file d'envoi, curseur serveur, la version la plus récente gagne).
- Serveur : `supabase/migrations/` (tables, déclencheurs, RLS, journal) et
  `supabase/functions/` : `assistant` (IA), `gmail`, `team` (équipe, familles).
- Application installable : `vite-plugin-pwa` (tout le code est mis en cache ; les données
  patients ne passent jamais par ce cache).
