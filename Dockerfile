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

# Hosts inject the port via $PORT; default to 8000 for local `docker run`.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
