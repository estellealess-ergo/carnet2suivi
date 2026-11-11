/**
 * Modèle de données de l'étape 1.
 *
 * Chaque ligne existe à l'identique sur l'appareil (IndexedDB) et sur le serveur
 * (PostgreSQL / Supabase hébergé HDS). Les identifiants sont créés sur l'appareil,
 * ce qui permet de tout saisir hors ligne puis de synchroniser plus tard.
 */

export type Iso = string; // date-heure ISO 8601
export type IsoDay = string; // AAAA-MM-JJ

export interface SyncedRow {
  id: string;
  owner_id: string | null;
  created_at: Iso;
  updated_at: Iso;
  /** Suppression « douce » : la ligne reste pour que la suppression se synchronise. */
  deleted_at: Iso | null;
}

export type PatientStatus = "actif" | "bilan" | "liste_attente" | "pause" | "non_suivi" | "archive";
export type Weekday =
  | "Lundi"
  | "Mardi"
  | "Mercredi"
  | "Jeudi"
  | "Vendredi"
  | "Samedi"
  | "Dimanche"
  | "Ponctuel";
export type Place = "cabinet" | "domicile" | "ecole" | "teleconsultation" | "autre";

export interface Patient extends SyncedRow {
  first_name: string;
  last_name: string;
  birth_date: IsoDay | null;
  status: PatientStatus;
  usual_day: Weekday | null;
  usual_time: string | null;
  usual_place: Place | null;
  frequency: "ponctuel" | "hebdomadaire" | "bimensuel" | null;
  /** Pour un suivi une semaine sur deux : semaines paires ou impaires. */
  week_parity?: "paire" | "impaire" | null;
  /** Ordre dans « Ma journée ». */
  day_order: number;
  /** Ordre manuel dans la liste des patients. */
  sort_order: number;
  school_name: string | null;
  school_class: string | null;
  phone: string | null;
  email: string | null;
  consultation_reason: string | null;
  diagnosis: string | null;
  care_start_date: IsoDay | null;
  /** Information toujours affichée en haut de la fiche et dans Ma journée. */
  pinned_info: string | null;
  notes: string | null;
}

export type NoteKind = "seance" | "generale";

/** Observation / note de séance (fusion des anciennes tables progress_notes et clinical_sessions). */
export interface Note extends SyncedRow {
  patient_id: string;
  kind: NoteKind;
  note_date: IsoDay;
  /** Texte mis en forme (HTML limité : gras, italique, couleur, listes). */
  content_html: string;
  /** Brouillon brut (dictée) conservé tel quel avant mise au propre. */
  raw_text: string | null;
  /** Objectifs travaillés pendant la séance. */
  goal_ids?: string[] | null;
}

export interface NoteVersion extends SyncedRow {
  note_id: string;
  patient_id: string;
  content_html: string;
  saved_at: Iso;
}

export type ForecastStatus = "a_faire" | "transferee" | "abandonnee";

/** Prévision : ce qui est prévu pour une prochaine séance. */
export interface Forecast extends SyncedRow {
  patient_id: string;
  content: string;
  planned_date: IsoDay | null;
  status: ForecastStatus;
  /** Note dans laquelle la prévision a été reprise. */
  note_id: string | null;
}

export type TaskStatus = "a_faire" | "fait";

export interface Task extends SyncedRow {
  patient_id: string | null;
  title: string;
  due_date: IsoDay | null;
  status: TaskStatus;
  urgent: boolean;
  details: string | null;
}

/** Bilan. */
export interface Assessment extends SyncedRow {
  patient_id: string;
  assessment_date: IsoDay | null;
  reason: string | null;
  tests_used: string | null;
  results: string | null;
  observations: string | null;
  synthesis: string | null;
  recommendations: string | null;
}

export type GoalStatus = "en_cours" | "atteint" | "suspendu" | "abandonne";

export interface Goal extends SyncedRow {
  patient_id: string;
  title: string;
  smart_statement: string | null;
  status: GoalStatus;
  /** Avancement de 0 à 100. */
  progress: number;
  target_date: IsoDay | null;
  review_date: IsoDay | null;
  sort_order: number;
}

export interface GoalProgress extends SyncedRow {
  goal_id: string;
  patient_id: string;
  progress: number;
  comment: string | null;
  recorded_on: IsoDay;
}

/** Responsable légal / proche à qui l'on transmet les nouvelles du suivi. */
export interface Guardian extends SyncedRow {
  patient_id: string;
  civility: "Madame" | "Monsieur" | null;
  first_name: string;
  last_name: string;
  relation: string | null;
  email: string | null;
  phone: string | null;
  /** Reçoit les comptes rendus du jour. */
  receives_reports: boolean;
  /** Compte de l'espace famille (rempli par le serveur à l'invitation). */
  user_id: string | null;
}

export type Channel = "email" | "appel" | "vocal" | "sms" | "whatsapp" | "autre";

/** Un échange : e-mail, appel, message vocal, SMS… */
export interface Communication extends SyncedRow {
  /** Vide tant que l'échange n'est pas rattaché à un patient. */
  patient_id: string | null;
  channel: Channel;
  direction: "entrant" | "sortant";
  occurred_at: Iso;
  /** Nom ou adresse de l'interlocuteur. */
  counterpart: string | null;
  subject: string | null;
  body: string | null;
  /** Informations clés de l'échange (mise au propre de ce qui a été dicté). */
  summary: string | null;
  status: "a_traiter" | "traite";
  /** Identifiant chez le fournisseur (ex. Gmail) : évite les doublons. */
  external_id: string | null;
  thread_id: string | null;
}

/** Compte rendu destiné à la famille : envoyé par e-mail/SMS et/ou publié dans l'espace famille. */
export interface FamilyReport extends SyncedRow {
  patient_id: string;
  note_id: string | null;
  report_date: IsoDay;
  content: string;
  status: "brouillon" | "envoye";
  sent_at: Iso | null;
  sent_via: string | null;
  recipients: string | null;
  /** Visible dans l'espace famille. */
  published: boolean;
  /** Prénom du patient, recopié pour l'espace famille (qui n'a pas accès au dossier). */
  patient_first_name: string;
}

/** Partage d'un dossier patient avec une collègue du cabinet. */
export interface PatientShare extends SyncedRow {
  patient_id: string;
  user_id: string;
  /** Propriétaire du dossier (recopié pour des règles d'accès simples). */
  patient_owner_id: string | null;
}

/** Changement ponctuel du planning : séance ajoutée ou annulée pour une date précise. */
export interface DayChange extends SyncedRow {
  patient_id: string;
  day: IsoDay;
  kind: "ajout" | "annulation";
  time: string | null;
}

/** Document rattaché au dossier (PDF, image, courrier). Gardé sur l'appareil uniquement. */
export interface PatientDocument extends SyncedRow {
  patient_id: string;
  /** Note de séance à laquelle la photo est rattachée. */
  note_id?: string | null;
  title: string;
  category: "bilan" | "courrier" | "ecole" | "medical" | "photo" | "compte_rendu" | "autre";
  doc_date: IsoDay | null;
  file_name: string;
  mime: string;
  size: number;
  blob: Blob;
}

export interface Tables {
  patients: Patient;
  notes: Note;
  note_versions: NoteVersion;
  forecasts: Forecast;
  tasks: Task;
  assessments: Assessment;
  goals: Goal;
  goal_progress: GoalProgress;
  guardians: Guardian;
  communications: Communication;
  family_reports: FamilyReport;
  patient_shares: PatientShare;
  day_changes: DayChange;
  activities: Activity;
}

export type TableName = keyof Tables;

export const TABLES: TableName[] = [
  "patients",
  "notes",
  "note_versions",
  "forecasts",
  "tasks",
  "assessments",
  "goals",
  "goal_progress",
  "guardians",
  "communications",
  "family_reports",
  "patient_shares",
  "day_changes",
  "activities",
];

/**
 * Activité enregistrée, à ajouter en un clic dans une note de séance.
 * Le modèle contient des cases à remplir entre crochets : « TypingClub, leçon [leçon] : [vitesse] mpm ».
 */
export interface Activity extends SyncedRow {
  title: string;
  template: string;
  rubric: "fait" | "observe" | "reprendre";
  sort_order: number;
}

/** Brouillon local d'un éditeur (jamais synchronisé) : protège la saisie en cours. */
export interface Draft {
  key: string;
  html: string;
  note_date: IsoDay | null;
  /** Mots-clés notés pendant la séance. */
  jots?: string[];
  /** Photos prises pendant la saisie, pas encore rattachées à la note. */
  photos?: PendingPhoto[];
  saved_at: Iso;
}

export interface OutboxEntry {
  seq?: number;
  table: TableName;
  row_id: string;
  queued_at: Iso;
}


export interface PendingPhoto {
  id: string;
  name: string;
  blob: Blob;
}
