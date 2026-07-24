#!/usr/bin/env python3
"""
Entrypoint for the Avatar Foundry captioning container.

Downloads reference images, runs WD14 tagger (ONNX) on each, writes a
sibling .txt caption file per image with the trigger token prepended,
then uploads the whole dataset/ directory back to GCS. Deliberately
stateless and DB-free, same convention as the training container.
"""

import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        print(f"FATAL: missing required env var {name}", file=sys.stderr)
        sys.exit(1)
    return value


CHARACTER_SLUG = env("CHARACTER_SLUG")
TRIGGER_TOKEN = env("TRIGGER_TOKEN")
REFERENCES_GCS_PREFIX = env("REFERENCES_GCS_PREFIX")
DATASET_GCS_PREFIX = env("DATASET_GCS_PREFIX")

REFERENCES_DIR = Path("/workspace/references")
DATASET_DIR = Path("/workspace/dataset")
REFERENCES_DIR.mkdir(parents=True, exist_ok=True)
DATASET_DIR.mkdir(parents=True, exist_ok=True)

# WD14 tagger — a widely-used ONNX model for auto-tagging illustration/
# anime-style images. Confidence threshold tuned conservatively; hand
# review of captions is still expected before training, per the Dataset
# stage's review step in the product flow.
WD14_MODEL_REPO = "SmilingWolf/wd-v1-4-convnext-tagger-v2"
TAG_THRESHOLD = 0.35


def run(cmd: list[str]) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, check=True)


def load_tagger():
    from huggingface_hub import hf_hub_download
    import onnxruntime as ort
    import csv

    model_path = hf_hub_download(WD14_MODEL_REPO, "model.onnx")
    tags_path = hf_hub_download(WD14_MODEL_REPO, "selected_tags.csv")

    session = ort.InferenceSession(model_path, providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
    with open(tags_path, newline="", encoding="utf-8") as f:
        tags = [row["name"] for row in csv.DictReader(f)]
    return session, tags


def tag_image(session, tags: list[str], image_path: Path) -> list[str]:
    input_shape = session.get_inputs()[0].shape  # [1, H, W, 3]
    size = input_shape[1]

    img = Image.open(image_path).convert("RGB").resize((size, size))
    arr = np.asarray(img, dtype=np.float32)[:, :, ::-1]  # RGB -> BGR, matches WD14's training convention
    arr = np.expand_dims(arr, axis=0)

    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    probs = session.run([output_name], {input_name: arr})[0][0]

    return [tags[i] for i, p in enumerate(probs) if p >= TAG_THRESHOLD]


def main() -> None:
    print(f"[1/4] Downloading references for {CHARACTER_SLUG} from {REFERENCES_GCS_PREFIX}")
    run(["gsutil", "-m", "cp", "-r", f"{REFERENCES_GCS_PREFIX}*", str(REFERENCES_DIR)])

    image_paths = sorted(
        [p for p in REFERENCES_DIR.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}]
    )
    if not image_paths:
        print("FATAL: no reference images found after download", file=sys.stderr)
        sys.exit(1)
    print(f"  -> {len(image_paths)} reference images")

    print(f"[2/4] Loading WD14 tagger ({WD14_MODEL_REPO})")
    session, tags = load_tagger()

    print("[3/4] Captioning images")
    for image_path in image_paths:
        detected_tags = tag_image(session, tags, image_path)
        caption = ", ".join([TRIGGER_TOKEN] + detected_tags)

        dest_image = DATASET_DIR / image_path.name
        dest_caption = DATASET_DIR / f"{image_path.stem}.txt"
        dest_image.write_bytes(image_path.read_bytes())
        dest_caption.write_text(caption, encoding="utf-8")
        print(f"  {image_path.name}: {caption[:80]}{'...' if len(caption) > 80 else ''}")

    print(f"[4/4] Uploading dataset to {DATASET_GCS_PREFIX}")
    run(["gsutil", "-m", "cp", "-r", f"{DATASET_DIR}/*", DATASET_GCS_PREFIX])

    print("Done.")


if __name__ == "__main__":
    main()
