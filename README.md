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

The app is deployed to Cloud Run in the `avatar-foundry` project, not
Vercel — it needs to run *as* the `avatar-foundry-app` service account
(implicit runtime identity, no key file) to reach Cloud SQL, GCS, and
Compute Engine, which Vercel can't provide.

```bash
gcloud run deploy avatar-foundry \
  --source . \
  --region=us-central1 \
  --allow-unauthenticated \
  --service-account=avatar-foundry-app@avatar-foundry.iam.gserviceaccount.com \
  --set-env-vars="GCP_PROJECT_ID=avatar-foundry,GCP_REGION=us-central1,GCP_ZONE=us-east4-a,INSTANCE_CONNECTION_NAME=avatar-foundry:us-central1:avatar-foundry-db,DB_NAME=avatar_foundry,GCS_BUCKET=avatar-foundry-assets,TRAINING_VM_IMAGE=avatar-foundry-trainer,TRAINING_MACHINE_TYPE=g2-standard-4,TRAINING_GPU_TYPE=nvidia-l4"
```

`--source .` builds via Cloud Native Buildpacks (no Dockerfile needed) —
it runs `npm run build` then `npm start`. `--allow-unauthenticated`
makes the `*.run.app` URL public with no IAM check; drop it and grant
`roles/run.invoker` to specific accounts instead if it should be
restricted.

## Validation

```bash
npm run build
npm run lint
```

## End-to-end tests

Playwright drives a real Chromium browser against the app — useful for
anything static analysis can't catch (does clicking a tab actually swap
the content, do the portrait images actually decode, etc.).

```bash
npx playwright install chromium   # first time only
npm run test:e2e                  # runs against localhost:3000 (starts the dev server if needed)
```

To test the live deployment instead of a local server:

```bash
PLAYWRIGHT_BASE_URL=https://avatar-foundry-987381419883.us-central1.run.app npm run test:e2e
```

## Checkpoint anchor probe (optional)

A full training run only gets checked against the character's signature
anchors (`characters.signatureAnchors`) once it finishes and reaches the
Validate stage — which means a run that was never going to preserve the
anchor still burns its entire training budget before anyone finds out.

Passing `hyperparams.probeIntervalSteps` when starting a run (`POST
/api/training-runs`) turns on a cheap interim tripwire instead: sd-scripts
renders a small fixed-seed sample batch every `probeIntervalSteps` steps
using the character's anchors as the prompt, and the training container
uploads those samples to GCS as they're produced (see
`server/jobs/training-image/entrypoint.py`'s background probe-upload
thread — the main thread is blocked inside the training subprocess for
the whole run, so this can't just happen inline).

`app/api/training-runs/[id]/status/route.ts` picks up new probe entries
on its normal polling and creates a `checkpointProbes` row per step
(`status: pending_review`). There's no CLIP/VLM scoring wired up in this
pipeline yet, so review is manual:

```bash
GET  /api/checkpoint-probes?trainingRunId=42        # list probes for a run
POST /api/checkpoint-probes/17/review               # { "passed": false, "raterNotes": "..." }
```

If an early probe clearly isn't showing the anchor, that's the signal to
stop burning training budget on a run that's already headed for a failed
Validate stage — there's no cancel API route yet, but
`cancelTrainingRun` in `server/jobs/training.ts` deletes the instance
directly (the caller is still responsible for marking the row
`cancelled`); fix Canon/Dataset before starting over.

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
Container Toolkit installed.

Not every Deep Learning VM family has Docker — the PyTorch-specific
families (e.g. `pytorch-latest-gpu`) are Conda-based and never install
it, which is a silent trap: the VM boots fine, but every startup script
fails at `docker run`. Use one of the `common-*` families instead —
those are the Docker-based DLVM images with the NVIDIA Container Toolkit
preconfigured:

```bash
gcloud compute images create avatar-foundry-trainer \
  --source-image-family=common-cu129-ubuntu-2204-nvidia-580 \
  --source-image-project=deeplearning-platform-release
```

The VM also needs [Private Google Access](https://cloud.google.com/vpc/docs/configure-private-google-access)
enabled on its subnet — job VMs have no external IP, so without it they
can't reach GCS/Artifact Registry to pull the container or write status:

```bash
gcloud compute networks subnets update default \
  --region=us-central1 --enable-private-ip-google-access
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
