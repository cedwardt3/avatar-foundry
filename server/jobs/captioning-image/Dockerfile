# Lightweight image captioning container using WD14 tagger — the same
# tool most of the LoRA-training community uses to auto-caption anime/
# illustration-style datasets. Swap for BLIP2 or similar if the dataset
# is photorealistic rather than illustrated.
#
# Build & push:
#   docker build -t us-central1-docker.pkg.dev/avatar-foundry/avatar-foundry/avatar-foundry-captioner:latest .
#   docker push us-central1-docker.pkg.dev/avatar-foundry/avatar-foundry/avatar-foundry-captioner:latest

FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y python3.10 python3-pip curl && rm -rf /var/lib/apt/lists/*

# huggingface-hub pinned below 1.0: the 1.x line rewrote the HTTP backend
# from `requests` to `httpx` and has a live bug where the redirect/backoff
# retry path reuses an already-closed httpx.Client, raising "Cannot send a
# request, as the client has been closed." on every hf_hub_download() call.
RUN pip install --no-cache-dir \
    onnxruntime-gpu \
    "huggingface-hub<1.0" \
    pillow \
    numpy

RUN curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts
ENV PATH="/root/google-cloud-sdk/bin:${PATH}"

WORKDIR /workspace
COPY entrypoint.py /workspace/entrypoint.py

ENTRYPOINT ["python3", "/workspace/entrypoint.py"]
