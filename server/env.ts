/**
 * Central place for reading environment variables. Every var used by the
 * backend is documented here so `README.md`'s setup section and this file
 * stay in sync — if you add a new one, add it in both places.
 */

function optional(name: string): string | undefined {
  return process.env[name];
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See README.md "Environment variables" for setup.`
    );
  }
  return value;
}

export const ENV = {
  // --- GCP project identity ---
  GCP_PROJECT_ID: optional("GCP_PROJECT_ID") ?? "avatar-foundry",
  GCP_REGION: optional("GCP_REGION") ?? "us-central1",
  GCP_ZONE: optional("GCP_ZONE") ?? "us-central1-a",

  // --- Cloud SQL (Postgres) ---
  // Either set DATABASE_URL for local/dev (plain connection string), or
  // set INSTANCE_CONNECTION_NAME for production (Cloud SQL connector,
  // no exposed IP/password needed if using IAM auth — see server/db.ts).
  DATABASE_URL: optional("DATABASE_URL"),
  INSTANCE_CONNECTION_NAME: optional("INSTANCE_CONNECTION_NAME"), // format: project:region:instance
  // Must match the IAM database user created via `gcloud sql users create`
  // (README "Database setup") — Postgres IAM usernames keep the service
  // account's email verbatim, not a sanitized/underscored form.
  DB_USER: optional("DB_USER") ?? "avatar-foundry-app@avatar-foundry.iam",
  DB_NAME: optional("DB_NAME") ?? "avatar_foundry",

  // --- Cloud Storage ---
  GCS_BUCKET: optional("GCS_BUCKET") ?? "avatar-foundry-assets",

  // --- Compute Engine training job orchestration ---
  // Name of the custom VM image with kohya_ss / sd-scripts baked in
  // (built via server/jobs/training-image/, see README).
  TRAINING_VM_IMAGE: optional("TRAINING_VM_IMAGE") ?? "avatar-foundry-trainer",
  TRAINING_MACHINE_TYPE: optional("TRAINING_MACHINE_TYPE") ?? "g2-standard-4", // pairs with 1x L4
  TRAINING_GPU_TYPE: optional("TRAINING_GPU_TYPE") ?? "nvidia-l4",
  USE_SPOT_INSTANCES: optional("USE_SPOT_INSTANCES") !== "false", // default true

  // Service account the app itself runs as, used to authenticate to the
  // Compute Engine / Storage APIs via google-auth-library's Application
  // Default Credentials. Locally this is a downloaded key file; in
  // production (Cloud Run etc.) this is implicit via the runtime identity.
  GOOGLE_APPLICATION_CREDENTIALS: optional("GOOGLE_APPLICATION_CREDENTIALS"),

  // --- Job-completion email notifications (Resend) ---
  RESEND_API_KEY: optional("RESEND_API_KEY"),
  NOTIFICATION_FROM_EMAIL: optional("NOTIFICATION_FROM_EMAIL") ?? "avatar-foundry@veteransip.org",
  NOTIFICATION_TO_EMAIL: optional("NOTIFICATION_TO_EMAIL") ?? "chuck@veteransip.org",
} as const;

export { required as requireEnv };
