# PostPulse — single container: FastAPI backend serves the API + the frontend.
FROM python:3.11-slim

# ffmpeg/ffprobe are required for video editing and music mixing.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so this layer is cached across code changes.
COPY final/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# App code (backend + frontend). main.py serves ../frontend, so keep the layout.
COPY final/ ./final/

WORKDIR /app/final/backend

# Caches must live somewhere world-writable: Hugging Face Spaces may run the
# container as a non-root user, so point model/cache dirs at /tmp and reuse the
# apt-installed ffmpeg instead of letting imageio-ffmpeg download its own.
ENV HF_HOME=/tmp/hf-cache \
    XDG_CACHE_HOME=/tmp/cache \
    HOME=/tmp \
    IMAGEIO_FFMPEG_EXE=/usr/bin/ffmpeg \
    PORT=8000

# Make the rendered-video output dir writable regardless of the runtime user.
# (Per-video subfolders are created here at runtime.)
RUN mkdir -p /tmp/hf-cache /tmp/cache edited_versions \
    && chmod -R 777 /tmp/hf-cache /tmp/cache edited_versions

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
