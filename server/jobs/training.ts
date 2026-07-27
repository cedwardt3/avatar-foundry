import { nanoid } from "nanoid";
import { ENV } from "../env";
import { buildPath } from "../storage";
import { createSpotInstance, isInstanceRunning as _isInstanceRunning, deleteInstance } from "./gce";
import type { TrainingRun, Character } from "../../drizzle/schema";

// Re-exported so existing callers (app/api/training-runs/[id]/status/route.ts)
// don't need to change their import path after this refactor.
export const isInstanceRunning = _isInstanceRunning;

/**
 * Builds the startup script that runs on boot. It:
 *   1. Pulls the training container (built from server/jobs/training-image/).
 *   2. Runs it with the character's dataset + output paths as env vars.
 *   3. Writes a status.json to GCS on completion (success or failure) so
 *      the app can poll without depending on the instance still existing.
 *   4. Deletes itself, so the spot VM only ever bills for the training
 *      window — no idle cleanup step required.
 *
 * Assumes the VM image (ENV.TRAINING_VM_IMAGE) is a GCP Deep Learning VM
 * image variant with NVIDIA drivers + Docker + NVIDIA Container Toolkit
 * preinstalled — see README "Building the training VM image".
 */
function buildStartupScript(opts: {
  runId: number;
  characterSlug: string;
  datasetGcsPrefix: string;
  checkpointGcsPath: string;
  statusGcsPath: string;
  hyperparams: TrainingRun["hyperparams"];
  triggerToken: string;
}): string {
  const hp = opts.hyperparams ?? {};
  return `#!/bin/bash
set -euo pipefail

STATUS_PATH="${opts.statusGcsPath}"

write_status() {
  echo "{\\"runId\\": ${opts.runId}, \\"status\\": \\"$1\\", \\"message\\": \\"$2\\"}" > /tmp/status.json
  gsutil cp /tmp/status.json "$STATUS_PATH"
}

trap 'write_status "failed" "startup script exited unexpectedly"' ERR

write_status "running" "training container starting"

gcloud auth configure-docker us-central1-docker.pkg.dev --quiet

docker run --rm --gpus all \\
  -e CHARACTER_SLUG="${opts.characterSlug}" \\
  -e TRIGGER_TOKEN="${opts.triggerToken}" \\
  -e DATASET_GCS_PREFIX="${opts.datasetGcsPrefix}" \\
  -e CHECKPOINT_GCS_PATH="${opts.checkpointGcsPath}" \\
  -e TRAIN_STEPS="${hp.steps ?? 1500}" \\
  -e LEARNING_RATE="${hp.learningRate ?? 0.0001}" \\
  -e RESOLUTION="${hp.resolution ?? 1024}" \\
  -e NETWORK_DIM="${hp.networkDim ?? 32}" \\
  -e NETWORK_ALPHA="${hp.networkAlpha ?? 16}" \\
  -e BATCH_SIZE="${hp.batchSize ?? 1}" \\
  us-central1-docker.pkg.dev/${ENV.GCP_PROJECT_ID}/avatar-foundry/avatar-foundry-trainer:latest

write_status "succeeded" "training complete, checkpoint uploaded"

# Self-delete: this is what keeps spot billing to the training window only.
gcloud compute instances delete "$(hostname)" --zone="${ENV.GCP_ZONE}" --quiet
`;
}

/**
 * Kicks off a training run: creates a spot GCE VM with the startup script
 * above. Returns the instance name so the caller can persist it on the
 * trainingRuns row for later polling.
 *
 * NOTE: this only creates the VM. Updating the trainingRuns row's status
 * to "provisioning" and storing the returned instance name is the
 * caller's responsibility (see app/api/training-runs/route.ts) — this
 * module intentionally has no DB dependency, to keep it testable in
 * isolation.
 */
export async function startTrainingRun(
  character: Pick<Character, "id" | "slug">,
  run: Pick<TrainingRun, "id" | "hyperparams" | "datasetImageCount">
): Promise<{ instanceName: string; zone: string }> {
  const zone = ENV.GCP_ZONE;
  // GCE instance names must match [a-z]([-a-z0-9]*[a-z0-9])? — no underscores.
  // nanoid()'s default alphabet includes '_', so sanitize the whole name
  // (not just the slug) rather than relying on each piece being clean.
  const instanceName = `train-${character.slug}-${run.id}-${nanoid(6)}`
    .toLowerCase()
    .replace(/_/g, "-");
  const checkpointGcsPath = `gs://${ENV.GCS_BUCKET}/${buildPath(
    character.slug,
    "checkpoints",
    `${run.id}/lora.safetensors`
  )}`;
  const statusGcsPath = `gs://${ENV.GCS_BUCKET}/${buildPath(
    character.slug,
    "checkpoints",
    `${run.id}/status.json`
  )}`;
  const datasetGcsPrefix = `gs://${ENV.GCS_BUCKET}/${buildPath(character.slug, "dataset", "")}`;

  const startupScript = buildStartupScript({
    runId: run.id,
    characterSlug: character.slug,
    datasetGcsPrefix,
    checkpointGcsPath,
    statusGcsPath,
    hyperparams: run.hyperparams,
    triggerToken: character.slug,
  });

  await createSpotInstance({
    name: instanceName,
    zone,
    machineType: ENV.TRAINING_MACHINE_TYPE,
    acceleratorType: ENV.TRAINING_GPU_TYPE,
    acceleratorCount: 1,
    sourceImage: `projects/${ENV.GCP_PROJECT_ID}/global/images/${ENV.TRAINING_VM_IMAGE}`,
    diskSizeGb: "100",
    startupScript,
    tags: ["avatar-foundry-training"],
  });

  return { instanceName, zone };
}

/** Cancels an in-progress run by deleting its instance. Caller should mark the trainingRuns row as "cancelled". */
export async function cancelTrainingRun(instanceName: string, zone: string): Promise<void> {
  await deleteInstance(instanceName, zone);
}
