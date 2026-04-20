"""FastAPI application — REST API + WebSocket hub for PulseBoard."""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend import database as db
from backend.ble_scanner import scanner
from backend.hr_zones import calculate_zone
from backend.models import (
    ClaimDeviceRequest,
    DeviceMapping,
    LiveMetric,
    RegisterRequest,
    ScannedDevice,
    Session,
    User,
    UserProfile,
)

logger = logging.getLogger("pulseboard")

# ── WebSocket connection manager ─────────────────────────────────────


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.active.remove(ws)

    async def broadcast(self, data: dict) -> None:
        dead: list[WebSocket] = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active.remove(ws)


manager = ConnectionManager()

# ── In-memory live state ─────────────────────────────────────────────

# device_address → latest LiveMetric
live_metrics: dict[str, LiveMetric] = {}
# device_address → last-seen timestamp (for signal-lost detection)
last_seen: dict[str, float] = {}

SIGNAL_LOST_SECONDS = 10


# ── Lifecycle ────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    scanner_task = asyncio.create_task(scanner.run(on_metric_callback))
    watchdog_task = asyncio.create_task(signal_lost_watchdog())
    yield
    scanner.stop()
    scanner_task.cancel()
    watchdog_task.cancel()


app = FastAPI(title="PulseBoard", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── BLE → WebSocket bridge ──────────────────────────────────────────


async def on_metric_callback(device_address: str, heart_rate: int, power: int | None) -> None:
    """Called by the BLE scanner whenever a new reading arrives."""
    import time

    last_seen[device_address] = time.time()

    mapping = await db.get_device_mapping_by_address(device_address)
    if not mapping:
        # Unknown device — still track it so it shows in scan results
        return

    user = await db.get_user(mapping.user_id)
    if not user:
        return

    zone, zone_label, zone_color = calculate_zone(heart_rate, user.max_hr)
    metric = LiveMetric(
        user_id=user.id,
        user_name=user.name,
        heart_rate=heart_rate,
        power=power,
        zone=zone,
        zone_label=zone_label,
        zone_color=zone_color,
        connected=True,
    )
    live_metrics[device_address] = metric
    await manager.broadcast(metric.model_dump(mode="json"))


async def signal_lost_watchdog() -> None:
    """Periodically check for devices that stopped sending data."""
    import time

    while True:
        await asyncio.sleep(3)
        now = time.time()
        for addr, ts in list(last_seen.items()):
            if now - ts > SIGNAL_LOST_SECONDS and addr in live_metrics:
                metric = live_metrics[addr]
                if metric.connected:
                    metric.connected = False
                    await manager.broadcast(metric.model_dump(mode="json"))


# ── REST endpoints ───────────────────────────────────────────────────


@app.post("/api/register", response_model=UserProfile)
async def register_user(req: RegisterRequest):
    user = User(name=req.name, max_hr=req.max_hr)
    await db.create_user(user)
    return UserProfile(id=user.id, name=user.name, max_hr=user.max_hr)


@app.get("/api/profile/{user_id}", response_model=UserProfile)
async def get_profile(user_id: str):
    user = await db.get_user(user_id)
    if not user:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")
    device = await db.get_device_mapping_by_user(user_id)
    return UserProfile(
        id=user.id,
        name=user.name,
        max_hr=user.max_hr,
        device_address=device.device_address if device else None,
        device_name=device.device_name if device else None,
    )


@app.put("/api/profile/{user_id}", response_model=UserProfile)
async def update_profile(user_id: str, req: RegisterRequest):
    user = await db.update_user(user_id, name=req.name, max_hr=req.max_hr)
    if not user:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")
    device = await db.get_device_mapping_by_user(user_id)
    return UserProfile(
        id=user.id,
        name=user.name,
        max_hr=user.max_hr,
        device_address=device.device_address if device else None,
        device_name=device.device_name if device else None,
    )


@app.get("/api/devices/scan", response_model=list[ScannedDevice])
async def scan_devices():
    discovered = scanner.get_discovered_devices()
    mappings = await db.get_all_device_mappings()
    mapping_lookup = {m.device_address: m.user_id for m in mappings}

    result = []
    for d in discovered:
        result.append(ScannedDevice(
            address=d["address"],
            name=d["name"],
            rssi=d.get("rssi", 0),
            services=d.get("services", []),
            claimed_by=mapping_lookup.get(d["address"]),
        ))
    return result


@app.post("/api/devices/claim", response_model=UserProfile)
async def claim_device(req: ClaimDeviceRequest):
    user = await db.get_user(req.user_id)
    if not user:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")
    mapping = DeviceMapping(device_address=req.device_address, device_name=req.device_name, user_id=req.user_id)
    await db.claim_device(mapping)
    return UserProfile(
        id=user.id,
        name=user.name,
        max_hr=user.max_hr,
        device_address=mapping.device_address,
        device_name=mapping.device_name,
    )


@app.get("/api/users/active", response_model=list[LiveMetric])
async def active_users():
    return list(live_metrics.values())


@app.post("/api/sessions", response_model=Session)
async def create_session(name: str = ""):
    session = Session(name=name)
    await db.create_session(session)
    return session


# ── WebSocket ────────────────────────────────────────────────────────


@app.websocket("/ws/live")
async def websocket_live(ws: WebSocket):
    await manager.connect(ws)
    try:
        # Send current state snapshot on connect
        for metric in live_metrics.values():
            await ws.send_json(metric.model_dump(mode="json"))
        # Keep alive — client doesn't need to send anything
        while True:
            # Accept pings/messages to keep connection alive
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)
