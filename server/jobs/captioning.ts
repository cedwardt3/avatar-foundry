import { nanoid } from "nanoid";
import { ENV } from "../env";
import { buildPath } from "../storage";
import { createSpotInstance } from "./gce";
import type { Character } from "../../drizzle/schema";

/**
 * Captioning is deliberately a separate, much cheaper job from training:
 * it needs a small GPU (or even CPU) for a few minutes per batch, not the
 * L4 + 20-40 minutes that LoRA training needs. Keeping it separate means
 * re-running captions (e.g. after adding more references) doesn't require
 * touching the training pipeline at all.
 *
 * Flow: copies the selected reference images into the dataset/ prefix,
 * runs WD14 tagger (or similar) against each one, writes a sibling .txt
 * caption file per image (the format sd-scripts' training script expects),
 * and prefixes every caption with the character's trigger token so the
 * LoRA learns to associate that token with this identity.
 */
export async function startCaptioningJob(
  character: Pick<Character, "id" | "slug">,
  opts: { jobId: string; referenceGcsPaths: string[] }
): Promise<{ instanceName: string; zone: string }> {
  const instanceName = `caption-${character.slug.replace(/_/g, "-")}-${opts.jobId.replace(/_/g, "-")}-${nanoid(6)}`.toLowerCase();
  const zone = ENV.GCP_ZONE;

  const referencesPrefix = `gs://${ENV.GCS_BUCKET}/${buildPath(character.slug, "references", "")}`;
  const datasetPrefix = `gs://${ENV.GCS_BUCKET}/${buildPath(character.slug, "dataset", "")}`;
  const statusPath = `gs://${ENV.GCS_BUCKET}/${buildPath(
    character.slug,
    "dataset",
    `_jobs/${opts.jobId}/status.json`
  )}`;

  const startupScript = `#!/bin/bash
set -euo pipefail

STATUS_PATH="${statusPath}"

write_status() {
  echo "{\\"jobId\\": \\"${opts.jobId}\\", \\"status\\": \\"$1\\", \\"message\\": \\"$2\\"}" > /tmp/status.json
  gsutil cp /tmp/status.json "$STATUS_PATH"
}

trap 'write_status "failed" "captioning startup script exited unexpectedly"' ERR

write_status "running" "captioning container starting"

docker run --rm --gpus all \\
  -e CHARACTER_SLUG="${character.slug}" \\
  -e TRIGGER_TOKEN="${character.slug}" \\
  -e REFERENCES_GCS_PREFIX="${referencesPrefix}" \\
  -e DATASET_GCS_PREFIX="${datasetPrefix}" \\
  us-central1-docker.pkg.dev/${ENV.GCP_PROJECT_ID}/avatar-foundry/avatar-foundry-captioner:latest

write_status "succeeded" "captioning complete"

gcloud compute instances delete "$(hostname)" --zone="${zone}" --quiet
`;

  // Captioning is far lighter-weight than training — a small T4 (or even
  // CPU-only) instance is plenty and keeps this job cheap to re-run.
  await createSpotInstance({
    name: instanceName,
    zone,
    machineType: "g2-standard-4",
    acceleratorType: ENV.TRAINING_GPU_TYPE, // reuse the same GPU family already quota-approved; WD14 doesn't need much VRAM
    acceleratorCount: 1,
    sourceImage: `projects/${ENV.GCP_PROJECT_ID}/global/images/${ENV.TRAINING_VM_IMAGE}`, // same base image, different container
    diskSizeGb: "150",
    startupScript,
    tags: ["avatar-foundry-captioning"],
  });

  return { instanceName, zone };
}
