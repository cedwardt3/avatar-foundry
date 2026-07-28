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
import re
import subprocess
import sys
import threading
import time
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

# Checkpoint probe (optional — see drizzle/schema.ts checkpointProbes and
# trainingRuns.hyperparams.probeIntervalSteps). Unset PROBE_INTERVAL_STEPS
# disables the feature entirely; nothing below runs in that case.
PROBE_INTERVAL_STEPS = os.environ.get("PROBE_INTERVAL_STEPS")
ANCHOR_DESCRIPTION = os.environ.get("ANCHOR_DESCRIPTION", "")
PROBE_GCS_PREFIX = os.environ.get("PROBE_GCS_PREFIX")  # gs://.../checkpoints/{runId}/probes/
TRAINING_RUN_ID = os.environ.get("TRAINING_RUN_ID")

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


# --- Checkpoint anchor probe (optional) ---------------------------------
#
# A cheap interim tripwire: sd-scripts has built-in support for rendering
# a fixed-seed sample batch every N steps during training (--sample_prompts
# / --sample_every_n_steps), so no separate inference call is needed. The
# only wrinkle is that `run()` above blocks the main thread for the whole
# training subprocess, so a background thread polls the sample output
# directory and uploads new, fully-written images to GCS as they appear —
# otherwise nothing would be visible until the entire run finished, which
# defeats the point of an *early* warning.
#
# Same 4 fixed seeds every run so probe results are comparable step-to-step
# and run-to-run; this is a tripwire, not a statistically rigorous sample.
_PROBE_SEEDS = [1001, 1002, 1003, 1004]


def build_sample_prompts_file(anchor_description: str) -> Path:
    prompt = f"{TRIGGER_TOKEN}, {anchor_description}".strip(", ")
    lines = [
        f"{prompt} --n low quality, blurry, deformed, extra limbs "
        f"--w {RESOLUTION} --h {RESOLUTION} --d {seed} --l 7 --s 20"
        for seed in _PROBE_SEEDS
    ]
    path = Path("/workspace/sample_prompts.txt")
    path.write_text("\n".join(lines) + "\n")
    return path


def write_probe_status(step: int, gcs_paths: list[str]) -> None:
    """Merges this step's probe entry into a single status.json in GCS, so
    the app can detect new probes by polling one small file the same way
    it already detects job completion (see
    app/api/training-runs/[id]/status/route.ts) instead of listing the
    bucket on every poll."""
    import json
    import tempfile

    status_gcs_path = f"{PROBE_GCS_PREFIX}status.json"
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
        tmp_path = tmp.name

    payload = {"runId": int(TRAINING_RUN_ID), "probes": []}
    fetch = subprocess.run(["gsutil", "cp", status_gcs_path, tmp_path], capture_output=True)
    if fetch.returncode == 0:
        try:
            payload = json.loads(Path(tmp_path).read_text())
        except (json.JSONDecodeError, OSError):
            pass

    probes = [p for p in payload.get("probes", []) if p.get("step") != step]
    probes.append({"step": step, "sampleImageGcsPaths": gcs_paths, "anchorDescription": ANCHOR_DESCRIPTION})
    payload["probes"] = probes

    Path(tmp_path).write_text(json.dumps(payload))
    run(["gsutil", "cp", tmp_path, status_gcs_path])
    os.unlink(tmp_path)


def start_probe_watcher(sample_dir: Path, stop_event: threading.Event) -> threading.Thread:
    uploaded_steps: set[int] = set()

    def parse_step(filename: str) -> int | None:
        # sd-scripts names step-based samples with a zero-padded 6-digit
        # step count somewhere in the filename (e.g.
        # "{output_name}_000900_00_1001.png") — match on that rather than
        # the full filename format, which varies by sd-scripts version.
        match = re.search(r"(\d{6})", filename)
        return int(match.group(1)) if match else None

    def sweep() -> None:
        if not sample_dir.exists():
            return
        by_step: dict[int, list[Path]] = {}
        for f in sample_dir.glob("*.png"):
            step = parse_step(f.name)
            if step is not None:
                by_step.setdefault(step, []).append(f)

        for step, files in sorted(by_step.items()):
            if step in uploaded_steps or len(files) < len(_PROBE_SEEDS):
                continue
            # Skip if any file in the batch was written in the last few
            # seconds — sd-scripts writes them one at a time, and we want
            # the whole batch, not a partial one.
            if any(time.time() - f.stat().st_mtime < 5 for f in files):
                continue

            probe_prefix = f"{PROBE_GCS_PREFIX}step_{step}/"
            gcs_paths = []
            for f in sorted(files):
                dest = f"{probe_prefix}{f.name}"
                run(["gsutil", "cp", str(f), dest])
                gcs_paths.append(dest)

            uploaded_steps.add(step)
            write_probe_status(step, gcs_paths)
            print(f"[probe] uploaded {len(gcs_paths)} sample(s) for step {step}", flush=True)

    def loop() -> None:
        while not stop_event.is_set():
            try:
                sweep()
            except Exception as e:  # non-fatal: a probe hiccup must never take down the real training run
                print(f"[probe] watcher error (non-fatal): {e}", file=sys.stderr, flush=True)
            stop_event.wait(15)
        sweep()  # final pass in case the last batch landed right as training finished

    thread = threading.Thread(target=loop, daemon=True)
    thread.start()
    return thread


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

    train_cmd = [
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
    ]

    probe_enabled = bool(PROBE_INTERVAL_STEPS and PROBE_GCS_PREFIX and TRAINING_RUN_ID)
    if probe_enabled:
        sample_prompts_path = build_sample_prompts_file(ANCHOR_DESCRIPTION)
        train_cmd += [
            f"--sample_prompts={sample_prompts_path}",
            f"--sample_every_n_steps={PROBE_INTERVAL_STEPS}",
            "--sample_sampler=euler_a",
        ]
    elif PROBE_INTERVAL_STEPS or PROBE_GCS_PREFIX:
        # Partially configured — warn and skip rather than failing the run
        # over a tripwire feature that isn't the point of the job.
        print("[probe] PROBE_INTERVAL_STEPS/PROBE_GCS_PREFIX/TRAINING_RUN_ID incompletely set — probe disabled", flush=True)

    stop_probe = threading.Event()
    probe_thread = start_probe_watcher(OUTPUT_DIR / "sample", stop_probe) if probe_enabled else None

    try:
        run(train_cmd)
    finally:
        if probe_thread is not None:
            stop_probe.set()
            probe_thread.join(timeout=60)

    checkpoint_file = OUTPUT_DIR / f"{CHARACTER_SLUG}_lora.safetensors"
    if not checkpoint_file.exists():
        print("FATAL: training completed but no checkpoint file found", file=sys.stderr)
        sys.exit(1)

    print(f"[3/3] Uploading checkpoint to {CHECKPOINT_GCS_PATH}")
    run(["gsutil", "cp", str(checkpoint_file), CHECKPOINT_GCS_PATH])

    print("Done.")


if __name__ == "__main__":
    main()
