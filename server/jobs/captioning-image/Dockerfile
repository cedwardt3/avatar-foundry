# Lightweight image captioning container using WD14 tagger — the same
# tool most of the LoRA-training community uses to auto-caption anime/
# illustration-style datasets. Swap for BLIP2 or similar if the dataset
# is photorealistic rather than illustrated.
#
# Build & push:
#   docker build -t gcr.io/avatar-foundry/avatar-foundry-captioner:latest .
#   docker push gcr.io/avatar-foundry/avatar-foundry-captioner:latest

FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y python3.10 python3-pip curl && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    onnxruntime-gpu \
    huggingface-hub \
    pillow \
    numpy

RUN curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts
ENV PATH="/root/google-cloud-sdk/bin:${PATH}"

WORKDIR /workspace
COPY entrypoint.py /workspace/entrypoint.py

ENTRYPOINT ["python3", "/workspace/entrypoint.py"]
