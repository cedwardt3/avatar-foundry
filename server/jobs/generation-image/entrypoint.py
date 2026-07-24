#!/usr/bin/env python3
"""
Entrypoint for the Avatar Foundry generation container. Loads SDXL base
+ the character's trained LoRA checkpoint (downloaded from GCS), runs a
single txt2img generation, uploads the result. Stateless and DB-free,
same convention as the training/captioning containers.
"""

import os
import subprocess
import sys
from pathlib import Path

import torch
from diffusers import StableDiffusionXLPipeline


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        print(f"FATAL: missing required env var {name}", file=sys.stderr)
        sys.exit(1)
    return value


CHARACTER_SLUG = env("CHARACTER_SLUG")
CHECKPOINT_GCS_PATH = env("CHECKPOINT_GCS_PATH")
PROMPT = env("PROMPT")
NEGATIVE_PROMPT = env("NEGATIVE_PROMPT", "")
SEED = int(env("SEED", "0"))
OUTPUT_GCS_PATH = env("OUTPUT_GCS_PATH")

CHECKPOINT_DIR = Path("/workspace/checkpoint")
OUTPUT_PATH = Path("/workspace/output.png")
CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)


def run(cmd: list[str]) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, check=True)


def main() -> None:
    print(f"[1/4] Downloading LoRA checkpoint from {CHECKPOINT_GCS_PATH}")
    local_checkpoint = CHECKPOINT_DIR / "lora.safetensors"
    run(["gsutil", "cp", CHECKPOINT_GCS_PATH, str(local_checkpoint)])

    print("[2/4] Loading SDXL base pipeline")
    pipe = StableDiffusionXLPipeline.from_pretrained(
        "stabilityai/stable-diffusion-xl-base-1.0",
        torch_dtype=torch.float16,
        variant="fp16",
    ).to("cuda")

    print(f"[3/4] Loading LoRA for {CHARACTER_SLUG} and generating (seed={SEED})")
    pipe.load_lora_weights(str(local_checkpoint))

    generator = torch.Generator(device="cuda").manual_seed(SEED)
    # Trigger token is prepended, matching the convention the captioning
    # container used when writing training captions — the LoRA only knows
    # this identity by that token.
    full_prompt = f"{CHARACTER_SLUG}, {PROMPT}"

    image = pipe(
        prompt=full_prompt,
        negative_prompt=NEGATIVE_PROMPT or None,
        num_inference_steps=30,
        guidance_scale=7.0,
        generator=generator,
    ).images[0]

    image.save(OUTPUT_PATH)

    print(f"[4/4] Uploading result to {OUTPUT_GCS_PATH}")
    run(["gsutil", "cp", str(OUTPUT_PATH), OUTPUT_GCS_PATH])

    print("Done.")


if __name__ == "__main__":
    main()
