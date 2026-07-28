CREATE TYPE "public"."checkpoint_probe_status" AS ENUM('pending_review', 'passed', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "checkpoint_probes" (
	"id" serial PRIMARY KEY NOT NULL,
	"character_id" integer NOT NULL,
	"training_run_id" integer NOT NULL,
	"checkpoint_step" integer NOT NULL,
	"sample_image_gcs_paths" jsonb NOT NULL,
	"anchor_description" text NOT NULL,
	"status" "checkpoint_probe_status" DEFAULT 'pending_review' NOT NULL,
	"rater_name" varchar(128),
	"rater_notes" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkpoint_probes" ADD CONSTRAINT "checkpoint_probes_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkpoint_probes" ADD CONSTRAINT "checkpoint_probes_training_run_id_training_runs_id_fk" FOREIGN KEY ("training_run_id") REFERENCES "public"."training_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
