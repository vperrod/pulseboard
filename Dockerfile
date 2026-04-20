# ── Single-stage build (Oryx has Python + Node) ─────────────────────
FROM pulseboardacr.azurecr.io/oryx-python:3.12

WORKDIR /app

# Fix stale Microsoft GPG key in Oryx base image
RUN curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > /usr/share/keyrings/microsoft-prod.gpg \
    && sed -i 's|signed-by=/usr/share/keyrings/microsoft-prod.gpg|signed-by=/usr/share/keyrings/microsoft-prod.gpg|' /etc/apt/sources.list.d/*.list 2>/dev/null || true

RUN apt-get update && apt-get install -y --no-install-recommends \
    supervisor nginx ca-certificates gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Build frontend
COPY frontend/package*.json /app/frontend/
RUN cd /app/frontend && npm ci
COPY frontend/ /app/frontend/
RUN cd /app/frontend && npm run build

# Install Python dependencies
COPY pyproject.toml .
COPY backend/ backend/
RUN pip install --no-cache-dir .

# Copy built frontend
RUN cp -r /app/frontend/dist/* /usr/share/nginx/html/

# Copy configs
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Remove default nginx site
RUN rm -f /etc/nginx/sites-enabled/default

# Data directory for SQLite
RUN mkdir -p /app/data
ENV DB_PATH=/app/data/pulseboard.db

EXPOSE 80

CMD ["supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
