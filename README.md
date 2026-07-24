# Avatar Foundry

Avatar Foundry is a trust-centered prototype workspace for designing, training,
testing, and packaging persistent fictional AI identities.

The interface demonstrates the complete seven-stage product journey:

1. Canon
2. References
3. Dataset
4. Train
5. Create
6. Validate
7. Launch

Mara Vey and Lila Mercer are included as proof cases. Prototype actions are
explicitly labeled; this repository does not yet connect image ingestion,
dataset processing, model training, generation, or export to production
backend services.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

This is a standard Next.js application and can be imported directly into
Vercel. Use the default framework settings; no environment variables are
required for the current prototype.

## Validation

```bash
npm run build
npm run lint
```

## Backend setup (GCP)

The prototype UI is now backed by a real pipeline: Postgres (Cloud SQL)
for structured data, Cloud Storage for images/checkpoints, and Compute
Engine spot GPU VMs for LoRA training. None of the commands below have
been run yet — they're the exact steps to provision everything, to be
run once GPU quota is approved on the `avatar-foundry` project.

**Prerequisite:** `NVIDIA_L4_GPUS` quota approved in your target region
(a manual Trust & Safety request is in flight as of this writing — see
project notes). Nothing GPU-related below will work until that clears;
the Cloud SQL and Storage steps can be done in parallel.

### 1. Enable required APIs

```bash
gcloud config set project avatar-foundry
gcloud services enable \
  compute.googleapis.com \
  sqladmin.googleapis.com \
  storage.googleapis.com \
  artifactregistry.googleapis.com
```

### 2. Cloud SQL (Postgres)

```bash
gcloud sql instances create avatar-foundry-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=us-central1

gcloud sql databases create avatar_foundry --instance=avatar-foundry-db

# IAM database authentication — no password to manage. Grant your app's
# runtime service account the cloudsql.instanceUser role, then create a
# matching IAM database user:
gcloud sql users create avatar-foundry-app@avatar-foundry.iam \
  --instance=avatar-foundry-db --type=cloud_iam_service_account
```

Set `INSTANCE_CONNECTION_NAME=avatar-foundry:us-central1:avatar-foundry-db`
in your environment (see `.env.example`). Then run migrations:

```bash
npm run db:generate   # drizzle-kit generate — writes SQL from drizzle/schema.ts
npm run db:migrate    # drizzle-kit migrate — applies it
```
(Add these two as `package.json` scripts once you're ready to run them —
they call `drizzle-kit generate` / `drizzle-kit migrate` respectively.)

### 3. Cloud Storage bucket

```bash
gcloud storage buckets create gs://avatar-foundry-assets \
  --location=us-central1 --uniform-bucket-level-access
```

### 4. Training container

Build and push the LoRA training image (`server/jobs/training-image/`):

```bash
cd server/jobs/training-image
gcloud auth configure-docker gcr.io
docker build -t gcr.io/avatar-foundry/avatar-foundry-trainer:latest .
docker push gcr.io/avatar-foundry/avatar-foundry-trainer:latest
```

### 5. Training VM image

The training job (`server/jobs/training.ts`) boots a VM from a custom
image expected to already have NVIDIA drivers, Docker, and the NVIDIA
Container Toolkit installed. The fastest path is basing it on one of
GCP's official Deep Learning VM images rather than building from scratch:

```bash
gcloud compute images create avatar-foundry-trainer \
  --source-image-family=common-gpu-debian-11 \
  --source-image-project=deeplearning-platform-release
```

### 6. Service account & IAM

The app's own runtime identity needs permission to create/delete Compute
Engine instances, read/write the GCS bucket, and connect to Cloud SQL:

```bash
gcloud iam service-accounts create avatar-foundry-app

for role in roles/compute.instanceAdmin.v1 roles/storage.objectAdmin roles/cloudsql.instanceUser roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding avatar-foundry \
    --member="serviceAccount:avatar-foundry-app@avatar-foundry.iam.gserviceaccount.com" \
    --role="$role"
done
```

Locally, download a key for this service account and point
`GOOGLE_APPLICATION_CREDENTIALS` at it. In production, attach this
service account directly to the runtime (Cloud Run, GCE, etc.) instead —
no key file needed there.
