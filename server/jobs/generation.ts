import { nanoid } from "nanoid";
import { ENV } from "../env";
import { buildPath } from "../storage";
import { createSpotInstance } from "./gce";
import type { Character, Generation, TrainingRun } from "../../drizzle/schema";

/**
 * Generation is the cheapest, fastest job in the pipeline — single image,
 * seconds of actual inference — but still needs a GPU with the base SDXL
 * model plus the character's LoRA checkpoint loaded. Same spot-VM pattern
 * as training/captioning for consistency, though in practice this is the
 * job most worth eventually moving to a warm/persistent endpoint if
 * generation volume grows, since cold-start (VM boot + model load) will
 * dominate wall-clock time for a single-image request.
 */
export async function startGenerationJob(
  character: Pick<Character, "id" | "slug">,
  trainingRun: Pick<TrainingRun, "id" | "checkpointGcsPath">,
  generation: Pick<Generation, "id" | "prompt" | "negativePrompt" | "seed">
): Promise<{ instanceName: string; zone: string }> {
  if (!trainingRun.checkpointGcsPath) {
    throw new Error("Training run has no checkpoint yet — cannot generate from an incomplete run.");
  }

  const instanceName = `gen-${character.slug}-${generation.id}-${nanoid(6)}`.toLowerCase();
  const zone = ENV.GCP_ZONE;

  const outputGcsPath = `gs://${ENV.GCS_BUCKET}/${buildPath(
    character.slug,
    "generations",
    `${generation.id}.png`
  )}`;
  const statusGcsPath = `gs://${ENV.GCS_BUCKET}/${buildPath(
    character.slug,
    "generations",
    `${generation.id}.status.json`
  )}`;

  // Seed of 0 is falsy but valid — check for null/undefined explicitly
  // rather than `generation.seed || randomSeed`, which would silently
  // discard an intentional seed of 0 and break generation reproducibility.
  const seed = generation.seed ?? Math.floor(Math.random() * 2 ** 31);

  const startupScript = `#!/bin/bash
set -euo pipefail

STATUS_PATH="${statusGcsPath}"

write_status() {
  echo "{\\"generationId\\": ${generation.id}, \\"status\\": \\"$1\\", \\"message\\": \\"$2\\"}" > /tmp/status.json
  gsutil cp /tmp/status.json "$STATUS_PATH"
}

trap 'write_status "failed" "generation startup script exited unexpectedly"' ERR

write_status "running" "generation container starting"

docker run --rm --gpus all \\
  -e CHARACTER_SLUG="${character.slug}" \\
  -e CHECKPOINT_GCS_PATH="${trainingRun.checkpointGcsPath}" \\
  -e PROMPT="${generation.prompt.replace(/"/g, '\\"')}" \\
  -e NEGATIVE_PROMPT="${(generation.negativePrompt ?? "").replace(/"/g, '\\"')}" \\
  -e SEED="${seed}" \\
  -e OUTPUT_GCS_PATH="${outputGcsPath}" \\
  gcr.io/${ENV.GCP_PROJECT_ID}/avatar-foundry-generator:latest

write_status "succeeded" "generation complete, image uploaded"

gcloud compute instances delete "$(hostname)" --zone="${zone}" --quiet
`;

  await createSpotInstance({
    name: instanceName,
    zone,
    machineType: "g2-standard-4",
    acceleratorType: ENV.TRAINING_GPU_TYPE,
    acceleratorCount: 1,
    sourceImage: `projects/${ENV.GCP_PROJECT_ID}/global/images/${ENV.TRAINING_VM_IMAGE}`,
    diskSizeGb: "50",
    startupScript,
    tags: ["avatar-foundry-generation"],
  });

  return { instanceName, zone };
}
