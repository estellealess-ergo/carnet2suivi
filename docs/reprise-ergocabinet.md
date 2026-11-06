# Reprise des données d'ErgoCabinet

La reprise se fait **une fois le serveur HDS en place et relié** : les dossiers repris partent
directement vers ce serveur.

## 1. Exporter les tables de l'ancienne application

L'ancienne application utilise la base de données de Lovable Cloud. Il faut en sortir un fichier
par table, au format CSV ou JSON. Depuis le projet ErgoCabinet dans Lovable, ouvre la partie
base de données de Cloud et exporte chaque table en CSV. Si l'option n'apparaît pas, demande à
l'assistant de Lovable : « Exporte chacune de ces tables en CSV, une par fichier ».

Tables utiles (les autres sont ignorées) :

- `patients` (indispensable)
- `progress_notes`, `progress_note_versions`, `clinical_sessions`
- `next_session_plans`, `tasks`
- `assessments`, `goals`, `goal_progress`
- `guardians`, `patient_guardians`
- `communications`, `parent_reports`

Garder les noms de fichiers d'origine (par exemple `patients_rows.csv`) : l'application reconnaît
la table d'après le nom.

## 2. Reprendre dans le Carnet de suivi

1. Se connecter au Carnet de suivi.
2. Paramètres → « Reprendre les données d'ErgoCabinet » → « Choisir les fichiers ».
3. Sélectionner tous les fichiers d'un coup. L'écran affiche ce qui va être repris et ce qui est ignoré.
4. « Reprendre ces données ». La synchronisation envoie tout au serveur.

## Ce qui change pendant la reprise

- Les dossiers repris appartiennent au compte qui fait la reprise. Ils peuvent ensuite être
  partagés avec une collègue depuis la fiche patient.
- Statut « Fin de suivi » → « Archivé ». Lieux « Atelier » et « Ponctuel » → « Autre ».
- Les anciennes fiches de séance structurées deviennent des notes de séance.
- Les prévisions déjà faites sont rangées dans l'historique des prévisions.
- Les tâches « prioritaires » deviennent « urgentes ».
- Des appels et vocaux, seuls les résumés sont repris, pas les retranscriptions intégrales.
- Les comptes rendus publiés dans l'ancien portail sont repris comme publiés.
- Les accès des familles ne sont pas repris : il faut renvoyer une invitation depuis l'onglet
  Famille de chaque patient.
- Les factures, rendez-vous et intégrations Docorga ne sont pas repris (gérés par Docorga et Indy).
- Refaire la reprise ne crée pas de doublon et n'écrase pas une note modifiée depuis.
- Les fichiers exportés contiennent des données de santé : les effacer une fois la reprise vérifiée.
