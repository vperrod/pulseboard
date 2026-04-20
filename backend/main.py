"""FastAPI application — REST API + WebSocket hub for PulseBoard."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import random
import time as _time
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend import database as db
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

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logging.getLogger("pulseboard.ble").setLevel(logging.DEBUG)
logging.getLogger("aiosqlite").setLevel(logging.WARNING)
logging.getLogger("bleak.backends.winrt.scanner").setLevel(logging.WARNING)
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
# device_address → latest raw HR reading (for scan preview, even unclaimed devices)
device_hr_preview: dict[str, int] = {}

SIGNAL_LOST_SECONDS = 10

BLE_ENABLED = os.getenv("BLE_ENABLED", "false").lower() in ("true", "1", "yes")
SCANNER_KEY = os.getenv("PULSEBOARD_SCANNER_KEY", "")


# ── API key auth ─────────────────────────────────────────────────────


async def verify_scanner_key(authorization: str = Header(...)) -> None:
    """Verify the scanner API key from the Authorization header."""
    if not SCANNER_KEY:
        raise HTTPException(status_code=503, detail="Scanner key not configured")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or token != SCANNER_KEY:
        raise HTTPException(status_code=401, detail="Invalid scanner key")


# ── Lifecycle ────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    scanner_task = None
    if BLE_ENABLED:
        from backend.ble_scanner import scanner
        scanner_task = asyncio.create_task(scanner.run(on_metric_callback))
    else:
        logger.info("BLE scanner disabled (set BLE_ENABLED=true to enable)")
    watchdog_task = asyncio.create_task(signal_lost_watchdog())
    yield
    if scanner_task:
        from backend.ble_scanner import scanner
        scanner.stop()
        scanner_task.cancel()
    watchdog_task.cancel()


ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")
app = FastAPI(title="PulseBoard", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["*"], allow_headers=["*"])


# ── BLE → WebSocket bridge ──────────────────────────────────────────


async def on_metric_callback(device_address: str, heart_rate: int, power: int | None) -> None:
    """Called by the BLE scanner whenever a new reading arrives."""
    import time

    last_seen[device_address] = time.time()

    # Always track raw HR for scan preview (even unclaimed devices)
    if heart_rate > 0:
        device_hr_preview[device_address] = heart_rate

    mapping = await db.get_device_mapping_by_address(device_address)
    if not mapping:
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


# ── Remote-discovered devices (populated by Android scanner) ────────

# device_address → { address, name, rssi, services }
_remote_discovered: dict[str, dict] = {}


@app.get("/api/devices/scan", response_model=list[ScannedDevice])
async def scan_devices():
    # Merge local BLE scanner + remote-pushed devices
    all_discovered: dict[str, dict] = {}
    all_discovered.update(_remote_discovered)
    if BLE_ENABLED:
        from backend.ble_scanner import scanner
        for d in scanner.get_discovered_devices():
            all_discovered[d["address"]] = d

    mappings = await db.get_all_device_mappings()
    mapping_lookup = {m.device_address: m.user_id for m in mappings}

    result = []
    for d in all_discovered.values():
        addr = d["address"]
        result.append(ScannedDevice(
            address=addr,
            name=d["name"],
            rssi=d.get("rssi", 0),
            services=d.get("services", []),
            claimed_by=mapping_lookup.get(addr),
            heart_rate_preview=device_hr_preview.get(addr),
            has_hr_service="0000180d" in " ".join(d.get("services", [])),
        ))
    # Sort: HR-capable devices first, then those with a reading, then by signal
    result.sort(key=lambda x: (not x.has_hr_service, x.heart_rate_preview is None, x.rssi))
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


@app.get("/api/users", response_model=list[UserProfile])
async def list_all_users():
    users = await db.list_users()
    mappings = await db.get_all_device_mappings()
    mapping_by_user = {m.user_id: m for m in mappings}
    result = []
    for u in users:
        m = mapping_by_user.get(u.id)
        result.append(UserProfile(
            id=u.id, name=u.name, max_hr=u.max_hr,
            device_address=m.device_address if m else None,
            device_name=m.device_name if m else None,
        ))
    return result


@app.delete("/api/users/{user_id}")
async def delete_user(user_id: str):
    # Clean up live state for this user
    mapping = await db.get_device_mapping_by_user(user_id)
    if mapping:
        live_metrics.pop(mapping.device_address, None)
        last_seen.pop(mapping.device_address, None)
        device_hr_preview.pop(mapping.device_address, None)
    deleted = await db.delete_user(user_id)
    if not deleted:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")
    # Broadcast clear so dashboard removes this user
    await manager.broadcast({"type": "user_removed", "user_id": user_id})
    return {"status": "deleted"}


@app.get("/api/users/active", response_model=list[LiveMetric])
async def active_users():
    return list(live_metrics.values())


# ── Remote scanner push endpoints ────────────────────────────────────


class MetricPush(BaseModel):
    device_address: str
    device_name: str = ""
    heart_rate: int
    power: int | None = None


class DeviceDiscovery(BaseModel):
    address: str
    name: str = "Unknown"
    rssi: int = 0
    services: list[str] = []


@app.post("/api/metrics/push", dependencies=[Depends(verify_scanner_key)])
async def push_metric(data: MetricPush):
    """Accept a metric reading from a remote BLE scanner (e.g. Android app)."""
    await on_metric_callback(data.device_address, data.heart_rate, data.power)
    return {"status": "ok"}


@app.post("/api/metrics/push/batch", dependencies=[Depends(verify_scanner_key)])
async def push_metrics_batch(data: list[MetricPush]):
    """Accept a batch of metric readings from a remote BLE scanner."""
    for m in data:
        await on_metric_callback(m.device_address, m.heart_rate, m.power)
    return {"status": "ok", "count": len(data)}


@app.post("/api/devices/discovered", dependencies=[Depends(verify_scanner_key)])
async def push_discovered_devices(devices: list[DeviceDiscovery]):
    """Accept discovered BLE devices from a remote scanner for registration."""
    for d in devices:
        _remote_discovered[d.address] = {
            "address": d.address,
            "name": d.name,
            "rssi": d.rssi,
            "services": d.services,
        }
    return {"status": "ok", "count": len(devices)}


# ── Web Bluetooth push (browser → server, no scanner key) ───────────


class WebPush(BaseModel):
    user_id: str
    heart_rate: int
    power: int | None = None
    device_name: str = ""


_web_bt_mapped: set[str] = set()


@app.post("/api/metrics/web-push")
async def web_push_metric(data: WebPush):
    """Accept HR from Web Bluetooth (browser push, no scanner key needed)."""
    user_id = data.user_id
    device_address = f"web:{user_id}"

    if user_id not in _web_bt_mapped:
        user = await db.get_user(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        mapping = await db.get_device_mapping_by_address(device_address)
        if not mapping:
            await db.claim_device(DeviceMapping(
                device_address=device_address,
                device_name=data.device_name or "Web Bluetooth",
                user_id=user_id,
            ))
        _web_bt_mapped.add(user_id)

    await on_metric_callback(device_address, data.heart_rate, data.power)
    return {"status": "ok"}


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


# ── Demo / simulation ───────────────────────────────────────────────

DEMO_USERS = [
    {"name": "Alex", "max_hr": 190, "device": "AA:BB:CC:00:00:01", "device_name": "Garmin FR265", "base_hr": 145, "has_power": False},
    {"name": "Jordan", "max_hr": 185, "device": "AA:BB:CC:00:00:02", "device_name": "Polar H10", "base_hr": 155, "has_power": False},
    {"name": "Sam", "max_hr": 195, "device": "AA:BB:CC:00:00:03", "device_name": "COROS Pace 3", "base_hr": 130, "has_power": False},
    {"name": "Taylor", "max_hr": 180, "device": "AA:BB:CC:00:00:04", "device_name": "Wahoo TICKR", "base_hr": 160, "has_power": True},
    {"name": "Morgan", "max_hr": 200, "device": "AA:BB:CC:00:00:05", "device_name": "Garmin FR965", "base_hr": 140, "has_power": True},
    {"name": "Casey", "max_hr": 188, "device": "AA:BB:CC:00:00:06", "device_name": "Apple Watch Ultra", "base_hr": 135, "has_power": False},
    {"name": "Riley", "max_hr": 192, "device": "AA:BB:CC:00:00:07", "device_name": "Polar Verity", "base_hr": 150, "has_power": False},
    {"name": "Quinn", "max_hr": 178, "device": "AA:BB:CC:00:00:08", "device_name": "Garmin Venu 3", "base_hr": 165, "has_power": False},
]

_demo_task: asyncio.Task | None = None


@app.post("/api/demo/start")
async def start_demo():
    """Seed demo users + devices and start simulating live HR/power data."""
    global _demo_task

    # Create users and device mappings
    for u in DEMO_USERS:
        user = User(name=u["name"], max_hr=u["max_hr"])
        try:
            await db.create_user(user)
        except Exception:
            pass  # already exists on restart
        mapping = DeviceMapping(device_address=u["device"], device_name=u["device_name"], user_id=user.id)
        await db.claim_device(mapping)
        # Populate discovered list so /devices/scan works
        _remote_discovered[u["device"]] = {
            "address": u["device"],
            "name": u["device_name"],
            "rssi": random.randint(-70, -40),
            "services": ["0000180d-0000-1000-8000-00805f9b34fb"],
        }

    # Start simulation loop
    if _demo_task is None or _demo_task.done():
        _demo_task = asyncio.create_task(_demo_loop())

    return {"status": "demo started", "users": len(DEMO_USERS)}


@app.post("/api/demo/stop")
async def stop_demo():
    global _demo_task
    if _demo_task and not _demo_task.done():
        _demo_task.cancel()
        _demo_task = None
    # Clear live state
    live_metrics.clear()
    device_hr_preview.clear()
    last_seen.clear()
    await manager.broadcast({"type": "clear"})
    return {"status": "demo stopped"}


async def _demo_loop():
    """Simulate realistic HR fluctuations for all demo users."""
    t = 0.0
    while True:
        for i, u in enumerate(DEMO_USERS):
            # Simulate HR: base + sinusoidal drift + random jitter + occasional spikes
            phase = t * 0.1 + i * 1.3  # offset each user
            drift = math.sin(phase) * 15 + math.sin(phase * 2.7) * 8
            jitter = random.randint(-3, 3)
            spike = random.randint(0, 20) if random.random() < 0.05 else 0
            hr = max(60, min(u["max_hr"] + 5, int(u["base_hr"] + drift + jitter + spike)))

            power = None
            if u["has_power"]:
                power = max(50, int(200 + math.sin(phase * 0.8) * 60 + random.randint(-10, 10)))

            await on_metric_callback(u["device"], hr, power)

        t += 1.0
        await asyncio.sleep(1)
