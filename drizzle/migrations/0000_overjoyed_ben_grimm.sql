CREATE TYPE "public"."generation_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."image_source" AS ENUM('kaggle_synthetic', 'generated', 'upload');--> statement-breakpoint
CREATE TYPE "public"."training_run_status" AS ENUM('queued', 'provisioning', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."validation_subject_type" AS ENUM('generation', 'training_run', 'character');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "characters" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(256) NOT NULL,
	"visual_canon" jsonb,
	"behavioral_presence" text,
	"signature_anchors" jsonb,
	"prohibited_drift" jsonb,
	"source_dataset" varchar(256),
	"status" varchar(64) DEFAULT 'canon_drafting' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "characters_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dataset_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"character_id" integer NOT NULL,
	"reference_image_id" integer,
	"gcs_path" text NOT NULL,
	"caption" text,
	"width" integer,
	"height" integer,
	"flagged_for_review" boolean DEFAULT false NOT NULL,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "generations" (
	"id" serial PRIMARY KEY NOT NULL,
	"character_id" integer NOT NULL,
	"training_run_id" integer,
	"status" "generation_status" DEFAULT 'queued' NOT NULL,
	"prompt" text NOT NULL,
	"negative_prompt" text,
	"seed" integer,
	"recipe_name" varchar(128),
	"output_gcs_path" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reference_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"character_id" integer NOT NULL,
	"gcs_path" text NOT NULL,
	"source" "image_source" NOT NULL,
	"source_dataset_ref" varchar(256),
	"angle" varchar(64),
	"expression" varchar(64),
	"lighting" varchar(64),
	"notes" text,
	"include_in_dataset" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"character_id" integer NOT NULL,
	"status" "training_run_status" DEFAULT 'queued' NOT NULL,
	"gce_instance_name" varchar(128),
	"gce_zone" varchar(64),
	"base_model" varchar(128) DEFAULT 'sdxl-1.0' NOT NULL,
	"hyperparams" jsonb,
	"dataset_image_count" integer,
	"checkpoint_gcs_path" text,
	"logs_gcs_path" text,
	"error_message" text,
	"estimated_cost_usd" real,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "validations" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_type" "validation_subject_type" NOT NULL,
	"subject_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	"identity_consistency_score" integer,
	"canon_adherence_score" integer,
	"drift_flags" jsonb,
	"rater_notes" text,
	"rater_name" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dataset_images" ADD CONSTRAINT "dataset_images_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dataset_images" ADD CONSTRAINT "dataset_images_reference_image_id_reference_images_id_fk" FOREIGN KEY ("reference_image_id") REFERENCES "public"."reference_images"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generations" ADD CONSTRAINT "generations_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generations" ADD CONSTRAINT "generations_training_run_id_training_runs_id_fk" FOREIGN KEY ("training_run_id") REFERENCES "public"."training_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validations" ADD CONSTRAINT "validations_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
