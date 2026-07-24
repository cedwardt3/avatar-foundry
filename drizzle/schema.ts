import {
  pgTable,
  pgEnum,
  serial,
  text,
  varchar,
  integer,
  real,
  jsonb,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * ============================================================
 * Avatar Foundry data model
 * ============================================================
 * Maps directly onto the seven-stage product journey:
 *   Canon → References → Dataset → Train → Create → Validate → Launch
 *
 * Design notes:
 * - Every image-bearing row stores a GCS object path, not the
 *   image bytes themselves. Actual files live in Cloud Storage;
 *   Postgres holds metadata, relationships, and provenance.
 * - trainingRuns and generations are both async-job-shaped:
 *   status moves through queued -> running -> succeeded/failed.
 *   The job orchestration layer (server/jobs/training.ts) owns
 *   writing status transitions here.
 * - validations is deliberately generic (subjectType/subjectId)
 *   so the same 1-5 rubric can score either a single generation
 *   or a whole character snapshot, mirroring the existing
 *   interiority grading rubric from the session-corpus workflow.
 * ============================================================
 */

export const trainingRunStatus = pgEnum("training_run_status", [
  "queued",
  "provisioning",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const generationStatus = pgEnum("generation_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

export const imageSource = pgEnum("image_source", [
  "kaggle_synthetic", // pulled from a public synthetic-face dataset — the only sanctioned source for real people
  "generated", // produced by this pipeline (e.g. a Create-stage output later promoted to a reference)
  "upload", // manually uploaded, still subject to the "no real people" policy at review time
]);

/**
 * Canon: the structured identity definition. One row per character.
 * This is the source of truth that everything else (dataset captions,
 * training trigger tokens, generation prompts, validation rubric)
 * gets checked against.
 */
export const characters = pgTable("characters", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(), // e.g. "mara_v" — used as the LoRA trigger token
  name: varchar("name", { length: 256 }).notNull(),

  // Canon fields — the "person, not a prompt" definition
  visualCanon: jsonb("visual_canon").$type<{
    age_range?: string;
    build?: string;
    hair?: string;
    eyes?: string;
    distinguishingFeatures?: string[];
    wardrobeAnchors?: string[];
  }>(),
  behavioralPresence: text("behavioral_presence"), // free-text personality/voice description
  signatureAnchors: jsonb("signature_anchors").$type<string[]>(), // must-preserve traits across generations
  prohibitedDrift: jsonb("prohibited_drift").$type<string[]>(), // explicit "must never become X" list

  sourceDataset: varchar("source_dataset", { length: 256 }), // e.g. "Kaggle: <dataset name>" — provenance for the seed reference images
  status: varchar("status", { length: 64 }).notNull().default("canon_drafting"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Character = typeof characters.$inferSelect;
export type InsertCharacter = typeof characters.$inferInsert;

/**
 * References: the curated seed image set a character's dataset
 * and training run are built from.
 */
export const referenceImages = pgTable("reference_images", {
  id: serial("id").primaryKey(),
  characterId: integer("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),

  gcsPath: text("gcs_path").notNull(), // gs://bucket/characters/{slug}/references/{filename}
  source: imageSource("source").notNull(),
  sourceDatasetRef: varchar("source_dataset_ref", { length: 256 }), // specific Kaggle dataset id/version if source = kaggle_synthetic

  // Coverage metadata — what this reference contributes to the set
  angle: varchar("angle", { length: 64 }), // front / three-quarter / profile
  expression: varchar("expression", { length: 64 }),
  lighting: varchar("lighting", { length: 64 }),
  notes: text("notes"),

  includeInDataset: boolean("include_in_dataset").notNull().default(true),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ReferenceImage = typeof referenceImages.$inferSelect;
export type InsertReferenceImage = typeof referenceImages.$inferInsert;

/**
 * Dataset: the processed, training-ready subset derived from
 * references. Captioning happens here (a quick, cheap GPU job —
 * WD14 tagger or similar — separate from the main LoRA training run).
 */
export const datasetImages = pgTable("dataset_images", {
  id: serial("id").primaryKey(),
  characterId: integer("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  referenceImageId: integer("reference_image_id").references(() => referenceImages.id, {
    onDelete: "set null",
  }),

  gcsPath: text("gcs_path").notNull(), // processed (cropped/resized) image used directly by the training script
  caption: text("caption"), // auto-generated or hand-edited training caption, must include the trigger token
  width: integer("width"),
  height: integer("height"),

  flaggedForReview: boolean("flagged_for_review").notNull().default(false), // e.g. possible contamination / off-canon
  reviewNotes: text("review_notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DatasetImage = typeof datasetImages.$inferSelect;
export type InsertDatasetImage = typeof datasetImages.$inferInsert;

/**
 * Training runs: one row per LoRA training job kicked off on the
 * self-hosted GCE GPU pipeline. Async job lifecycle lives here.
 */
export const trainingRuns = pgTable("training_runs", {
  id: serial("id").primaryKey(),
  characterId: integer("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),

  status: trainingRunStatus("status").notNull().default("queued"),

  // GCE job tracking
  gceInstanceName: varchar("gce_instance_name", { length: 128 }),
  gceZone: varchar("gce_zone", { length: 64 }),

  // Training config — kept explicit and visible per the "recommended
  // settings, visible logic" product principle in the Train stage copy
  baseModel: varchar("base_model", { length: 128 }).notNull().default("sdxl-1.0"),
  hyperparams: jsonb("hyperparams").$type<{
    steps?: number;
    learningRate?: number;
    resolution?: number;
    networkDim?: number;
    networkAlpha?: number;
    batchSize?: number;
  }>(),
  datasetImageCount: integer("dataset_image_count"),

  // Result
  checkpointGcsPath: text("checkpoint_gcs_path"), // gs://.../checkpoints/{runId}/lora.safetensors
  logsGcsPath: text("logs_gcs_path"),
  errorMessage: text("error_message"),

  // Cost tracking — worth keeping given the whole point was cost control
  estimatedCostUsd: real("estimated_cost_usd"),

  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TrainingRun = typeof trainingRuns.$inferSelect;
export type InsertTrainingRun = typeof trainingRuns.$inferInsert;

/**
 * Generations: individual images produced from a trained checkpoint
 * during the Create stage. Each one is fully reproducible — prompt,
 * seed, and which checkpoint produced it are all recorded.
 */
export const generations = pgTable("generations", {
  id: serial("id").primaryKey(),
  characterId: integer("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  trainingRunId: integer("training_run_id").references(() => trainingRuns.id, {
    onDelete: "set null",
  }),

  status: generationStatus("status").notNull().default("queued"),

  prompt: text("prompt").notNull(),
  negativePrompt: text("negative_prompt"),
  seed: integer("seed"),
  recipeName: varchar("recipe_name", { length: 128 }), // named/reusable content recipe, per the Create stage's "recipes before random prompts" principle

  outputGcsPath: text("output_gcs_path"),
  errorMessage: text("error_message"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Generation = typeof generations.$inferSelect;
export type InsertGeneration = typeof generations.$inferInsert;

/**
 * Validations: the 1-5 rubric scoring layer. Deliberately generic
 * across subject types so the same rubric instrument can score a
 * single generation or a character/checkpoint as a whole — mirrors
 * the existing interiority grading rubric used in the session-corpus
 * spreadsheet logging system, repurposed here as a technical QA gate
 * for identity consistency and drift.
 */
export const validationSubjectType = pgEnum("validation_subject_type", [
  "generation",
  "training_run",
  "character",
]);

export const validations = pgTable("validations", {
  id: serial("id").primaryKey(),
  subjectType: validationSubjectType("subject_type").notNull(),
  subjectId: integer("subject_id").notNull(), // FK target depends on subjectType — resolved in application code, not a DB constraint

  characterId: integer("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),

  // Rubric scores, 1-5 each. Keep individual dimensions rather than
  // one blended score so drift can be traced to a specific axis.
  identityConsistencyScore: integer("identity_consistency_score"), // does it still look/read like the canon character
  canonAdherenceScore: integer("canon_adherence_score"), // does behavior/appearance match signatureAnchors
  driftFlags: jsonb("drift_flags").$type<string[]>(), // which prohibitedDrift items were observed, if any

  raterNotes: text("rater_notes"),
  raterName: varchar("rater_name", { length: 128 }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ValidationRow = typeof validations.$inferSelect;
export type InsertValidationRow = typeof validations.$inferInsert;
