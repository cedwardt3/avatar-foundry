# SDXL LoRA training container. Built once, pushed to gcr.io, referenced
# by server/jobs/training.ts's startup script. Rebuild + push whenever
# entrypoint.py or the pinned sd-scripts version changes.
#
# Build & push (run locally or in Cloud Build):
#   docker build -t gcr.io/avatar-foundry/avatar-foundry-trainer:latest .
#   docker push gcr.io/avatar-foundry/avatar-foundry-trainer:latest

FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y \
    python3.10 python3-pip git curl \
    && rm -rf /var/lib/apt/lists/*

# kohya_ss's sd-scripts — the de facto standard SDXL LoRA training toolkit.
# Pinned to a specific commit for reproducibility; bump deliberately.
RUN git clone https://github.com/kohya-ss/sd-scripts.git /opt/sd-scripts \
    && cd /opt/sd-scripts \
    && pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir xformers bitsandbytes

# Google Cloud SDK, for gsutil (dataset download + checkpoint upload)
RUN curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts
ENV PATH="/root/google-cloud-sdk/bin:${PATH}"

WORKDIR /workspace
COPY entrypoint.py /workspace/entrypoint.py

ENTRYPOINT ["python3", "/workspace/entrypoint.py"]
