# PulseBoard

Real-time group heart rate monitoring dashboard for gym/fitness classes. Python 3.12 / FastAPI / React / Tailwind / Vite.

## Commands

```bash
pip install -e ".[dev]"                    # Install with dev deps
ruff check backend/                        # Lint (must pass before commit)
pytest backend/tests/ -v --tb=short        # Tests (must pass before push)
uvicorn backend.main:app --reload          # API + WebSocket on :8000
cd frontend && npm ci && npm run dev       # Vite dev server on :5173
```

## Architecture

- **`backend/main.py`** — FastAPI monolith: REST API + WebSocket hub + BLE callbacks + demo mode. Endpoints grouped by `# ── Section ──` comments.
- **`backend/models.py`** — Pydantic v2 models: User, Session, SessionScore, LiveMetric, LeaderboardEntry, DeviceMapping.
- **`backend/database.py`** — aiosqlite CRUD. Tables: users, sessions, session_scores, session_schedule, device_mappings. Migrations via `ALTER TABLE ADD COLUMN` with `try/except`.
- **`backend/scoring.py`** — SessionScorer: zone-based exponential points (Z1=1, Z2=2, Z3=4, Z4=8, Z5=16 pts/s) with power multiplier. Accumulates live, finalizes to DB on session end.
- **`backend/hr_zones.py`** — 5-zone HR calculation from max_hr.
- **`backend/ble_scanner.py`** — Bluetooth LE scanner (bleak). Optional: `BLE_ENABLED=true`.
- **`frontend/`** — React 19 + TypeScript 6 + Vite 8 + Tailwind v4. Routes: `/`, `/register`, `/admin`, `/hrdashboard`, `/liveleaderboard`, `/fullleaderboard`.

## Style

- Ruff, 120-char line length. See `pyproject.toml` for config.
- `from __future__ import annotations` at top of every module.
- Commit messages: `area: short description` (e.g. `scoring: fix power multiplier`).

## Deployment

- Docker: single-stage from `pulseboardacr.azurecr.io/oryx-python:3.12`. Builds frontend with Node 22, serves via nginx + supervisord (nginx + uvicorn).
- Azure: Container App `pulseboard-app`, RG `pulseboard-rg`, ACR `pulseboardacr`.
- CD: ruff + pytest → `az acr build` (SHA-tagged) → `az containerapp update`.
- Production: https://pulseboard-app.wonderfulwater-2c91b112.westeurope.azurecontainerapps.io/

## Gotchas

- WebSocket in dev mode connects directly to `:8000` (bypasses Vite proxy). Production uses nginx `/ws/` proxy.
- Session scores only persist when a session **ends** — live data is in-memory via `SessionScorer`.
- Demo mode (`POST /api/demo/start`) seeds 14 days of historical data + starts live HR simulation. Idempotent (checks before seeding).
- Container Apps won't pull fresh `:latest` images — always use unique SHA tags.
- `.db` files are gitignored. Docker path: `/home/data/pulseboard.db`.
- Frontend `dist/` is gitignored — Docker builds it fresh each deploy.
