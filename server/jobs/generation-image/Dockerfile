# SDXL inference container that loads a character's trained LoRA
# checkpoint and generates a single image from a prompt. Built on
# diffusers rather than sd-scripts (training and inference use different
# tooling even though they share the same underlying model family).
#
# Build & push:
#   docker build -t gcr.io/avatar-foundry/avatar-foundry-generator:latest .
#   docker push gcr.io/avatar-foundry/avatar-foundry-generator:latest

FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y python3.10 python3-pip curl && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    torch --index-url https://download.pytorch.org/whl/cu121 \
    diffusers[torch] \
    transformers \
    accelerate \
    safetensors

RUN curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts
ENV PATH="/root/google-cloud-sdk/bin:${PATH}"

WORKDIR /workspace
COPY entrypoint.py /workspace/entrypoint.py

ENTRYPOINT ["python3", "/workspace/entrypoint.py"]
