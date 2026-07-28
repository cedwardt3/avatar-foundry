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

# sd-scripts' DreamBooth-style dataset loader requires --train_data_dir to be
# the *parent* of one or more subfolders named "<repeats>_<class>", not a flat
# folder of images — it walks immediate subdirectories looking for that
# "<int>_..." naming pattern and skips anything else (see config_util.py's
# "ignore directory without repeats" warning). REPEATS controls how many
# times each image is seen per epoch given the small dataset size.
REPEATS = 10
DATASET_DIR = Path("/workspace/dataset") / CHARACTER_SLUG
IMAGES_DIR = DATASET_DIR / f"{REPEATS}_{TRIGGER_TOKEN}"
OUTPUT_DIR = Path("/workspace/output")
IMAGES_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def run(cmd: list[str]) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, check=True)


def main() -> None:
    print(f"[1/3] Downloading dataset for {CHARACTER_SLUG} from {DATASET_GCS_PREFIX}")
    run(["gsutil", "-m", "cp", "-r", f"{DATASET_GCS_PREFIX}*", str(IMAGES_DIR)])

    image_count = sum(
        len(list(IMAGES_DIR.glob(f"*{ext}")))
        for ext in (".png", ".jpg", ".jpeg", ".webp")
    )
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
        # Dataset is tiny (a couple dozen images) — multiprocess DataLoader
        # workers add fork/CUDA-init deadlock risk for no benefit here, and
        # already caused a stuck (0% GPU, no progress) training run. Force
        # synchronous single-process loading instead.
        "--max_data_loader_n_workers=0",
        "--network_module=networks.lora",
        f"--network_dim={NETWORK_DIM}",
        f"--network_alpha={NETWORK_ALPHA}",
        "--mixed_precision=fp16",
        # SDXL's stock VAE overflows in fp16, producing NaN latents that
        # sd-scripts silently zeroes out (confirmed via a real run's logs:
        # "NaN found in latents, replacing with zeros" on every image) —
        # this corrupts training without ever raising an error. Keep the
        # VAE itself in fp32 while the rest of the model stays fp16.
        "--no_half_vae",
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
