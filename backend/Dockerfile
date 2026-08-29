FROM python:3.11-slim

# Install system dependencies: Clang, LLDB, and Build Tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    clang \
    lldb \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install python packages
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY backend/ .

# Expose FastAPI port
EXPOSE 8000

# Run FastAPI server with Uvicorn using dynamic PORT env var
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
