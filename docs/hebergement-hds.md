# Mise en place du serveur HDS

Ce guide décrit l'installation du serveur du cabinet chez un hébergeur certifié HDS (hébergeur de
données de santé). Tant qu'il n'est pas en place, l'application ne doit pas contenir de vrais
dossiers patients, sauf en mode local avec sauvegardes.

## 1. Choisir l'offre

- **OVHcloud** : serveur dédié ou Public Cloud avec l'option « Healthcare (HDS) ».
- **Scaleway** : instances dans un projet HDS.

Il faut un contrat HDS signé avec l'hébergeur. Une machine de 2 vCPU et 4 Go de mémoire suffit
pour un cabinet. Compter environ 15 à 40 € par mois selon l'offre.

## 2. Installer Supabase

Suivre la documentation officielle « Self-Hosting with Docker » de Supabase sur le serveur :

1. Installer Docker.
2. Récupérer le dossier `docker` de Supabase et copier `.env.example` en `.env`.
3. Changer **tous** les secrets (`POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`,
   `SERVICE_ROLE_KEY`, mot de passe du tableau de bord).
4. Mettre le serveur derrière un nom de domaine avec HTTPS (par exemple `api.carnet2suivi.fr`).
5. Désactiver l'inscription libre (`DISABLE_SIGNUP=true`) : les comptes sont créés par
   l'administratrice depuis le tableau de bord.
6. Activer les sauvegardes automatiques chiffrées de la base, sur un stockage HDS.

## 3. Créer les tables

Dans l'éditeur SQL du tableau de bord Supabase, exécuter dans l'ordre les fichiers de
`supabase/migrations/` :

1. `20261105000000_etape1_socle.sql`
2. `20261106000000_etape2_communications.sql`
3. `20261107000000_etape3_equipe_famille.sql`

## 4. Fonctions serveur

Déployer les trois fonctions :

```
supabase functions deploy assistant
supabase functions deploy gmail
supabase functions deploy team
```

Puis définir les secrets :

| Secret | Rôle |
| --- | --- |
| `MISTRAL_API_KEY` | Assistant (mise au propre des notes, informations clés des échanges, messages aux familles) |
| `APP_URL` | Adresse de l'application, ex. `https://carnet2suivi.fr` (liens d'invitation) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Liaison Gmail (voir ci-dessous) |

### Liaison Gmail

1. Dans Google Cloud Console, créer un projet, activer l'**API Gmail**.
2. Écran de consentement OAuth : type « Externe », ajouter les champs d'application
   `gmail.readonly` et `gmail.send`, et ton adresse comme utilisatrice test.
3. Identifiants → « ID client OAuth » de type « Application Web », avec comme URI de redirection
   autorisée : `https://<adresse de l'application>/connexion-gmail`.
4. Reporter l'ID et le secret dans `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`.

### Premiers comptes

1. Dans le tableau de bord Supabase (Authentication), inviter ton adresse e-mail.
2. Dans l'application, Paramètres → Équipe du cabinet → « Créer le cabinet ».
3. Les collègues et les familles s'invitent ensuite depuis l'application.

Les noms des patients sont retirés sur l'appareil avant l'envoi. Vérifier tout de même les
conditions du fournisseur (absence de conservation et d'entraînement sur les données) et
l'inscrire au registre RGPD du cabinet.

## 5. Relier l'application

Dans le fichier `.env` de l'application :

```
VITE_SUPABASE_URL=https://api.carnet2suivi.fr
VITE_SUPABASE_ANON_KEY=…
```

Puis `npm run build` et déposer le dossier `dist/` sur un hébergement web en HTTPS (il ne contient
aucune donnée patient, mais il peut aussi être servi par le serveur HDS).

## 6. Avant le premier vrai patient

- Contrat HDS signé et registre des traitements RGPD à jour.
- Comptes créés avec un mot de passe solide ; double authentification si possible.
- Appareils (ordinateur, téléphone) verrouillés par code.
- Test de restauration d'une sauvegarde.
