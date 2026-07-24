#!/usr/bin/env python3
"""
Entrypoint for the Avatar Foundry SDXL LoRA training container.

Reads config entirely from environment variables (set by the GCE startup
script in server/jobs/training.ts), so this container has no dependency
on the app's database or API — it only needs GCS paths and hyperparams.

Flow:
  1. Download the dataset (images + captions) from DATASET_GCS_PREFIX.
  2. Run sd-scripts' sdxl_train_network.py with the given hyperparams.
  3. Upload the resulting .safetensors checkpoint to CHECKPOINT_GCS_PATH.

Any failure here should raise/exit non-zero, which the shell startup
script's `trap` will catch and report as a failed status — see
buildStartupScript() in ../training.ts for the calling convention.
"""

import os
import subprocess
import sys
from pathlib import Path

def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        print(f"FATAL: missing required env var {name}", file=sys.stderr)
        sys.exit(1)
    return value

CHARACTER_SLUG = env("CHARACTER_SLUG")
TRIGGER_TOKEN = env("TRIGGER_TOKEN")
DATASET_GCS_PREFIX = env("DATASET_GCS_PREFIX")
CHECKPOINT_GCS_PATH = env("CHECKPOINT_GCS_PATH")
TRAIN_STEPS = env("TRAIN_STEPS", "1500")
LEARNING_RATE = env("LEARNING_RATE", "0.0001")
RESOLUTION = env("RESOLUTION", "1024")
NETWORK_DIM = env("NETWORK_DIM", "32")
NETWORK_ALPHA = env("NETWORK_ALPHA", "16")
BATCH_SIZE = env("BATCH_SIZE", "1")

DATASET_DIR = Path("/workspace/dataset") / CHARACTER_SLUG
OUTPUT_DIR = Path("/workspace/output")
DATASET_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def run(cmd: list[str]) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, check=True)


def main() -> None:
    print(f"[1/3] Downloading dataset for {CHARACTER_SLUG} from {DATASET_GCS_PREFIX}")
    run(["gsutil", "-m", "cp", "-r", f"{DATASET_GCS_PREFIX}*", str(DATASET_DIR)])

    image_count = len(list(DATASET_DIR.glob("*.png")) + list(DATASET_DIR.glob("*.jpg")))
    if image_count == 0:
        print("FATAL: no training images found after download", file=sys.stderr)
        sys.exit(1)
    print(f"  -> {image_count} images")

    # sd-scripts expects captions as sibling .txt files per image, and a
    # dataset config describing repeat count / resolution bucketing.
    # Captions are expected to already be written by the dataset-prep
    # stage before this job runs (see app/api/datasets/route.ts), each
    # one containing the TRIGGER_TOKEN so the LoRA associates the token
    # with this specific identity.

    print(f"[2/3] Training LoRA: {TRAIN_STEPS} steps, lr={LEARNING_RATE}, "
          f"res={RESOLUTION}, dim={NETWORK_DIM}/{NETWORK_ALPHA}, batch={BATCH_SIZE}")

    run([
        "python3", "/opt/sd-scripts/sdxl_train_network.py",
        "--pretrained_model_name_or_path=stabilityai/stable-diffusion-xl-base-1.0",
        f"--train_data_dir={DATASET_DIR}",
        f"--output_dir={OUTPUT_DIR}",
        f"--output_name={CHARACTER_SLUG}_lora",
        "--save_model_as=safetensors",
        f"--resolution={RESOLUTION}",
        f"--train_batch_size={BATCH_SIZE}",
        f"--max_train_steps={TRAIN_STEPS}",
        f"--learning_rate={LEARNING_RATE}",
        "--network_module=networks.lora",
        f"--network_dim={NETWORK_DIM}",
        f"--network_alpha={NETWORK_ALPHA}",
        "--mixed_precision=fp16",
        "--gradient_checkpointing",
        "--xformers",
        "--save_every_n_steps=500",  # periodic checkpoints — limits loss if the spot VM is preempted mid-run
    ])

    checkpoint_file = OUTPUT_DIR / f"{CHARACTER_SLUG}_lora.safetensors"
    if not checkpoint_file.exists():
        print("FATAL: training completed but no checkpoint file found", file=sys.stderr)
        sys.exit(1)

    print(f"[3/3] Uploading checkpoint to {CHECKPOINT_GCS_PATH}")
    run(["gsutil", "cp", str(checkpoint_file), CHECKPOINT_GCS_PATH])

    print("Done.")


if __name__ == "__main__":
    main()
