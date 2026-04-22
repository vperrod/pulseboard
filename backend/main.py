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
from datetime import UTC, datetime

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend import database as db
from backend.hr_zones import calculate_zone
from backend.models import (
    ClaimDeviceRequest,
    DeviceMapping,
    LeaderboardEntry,
    LiveMetric,
    RegisterRequest,
    ScannedDevice,
    Session,
    SessionScheduleSlot,
    SessionScore,
    User,
    UserProfile,
)
from backend.scoring import SessionScorer

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

# ── Session scoring state ────────────────────────────────────────────

active_scorer: SessionScorer | None = None
active_session: Session | None = None
current_view_mode: str = "split"  # "split" | "metrics" | "leaderboard"


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
    score_task = asyncio.create_task(score_broadcast_loop())
    scheduler_task = asyncio.create_task(session_scheduler())
    yield
    if scanner_task:
        from backend.ble_scanner import scanner
        scanner.stop()
        scanner_task.cancel()
    watchdog_task.cancel()
    score_task.cancel()
    scheduler_task.cancel()


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
    await manager.broadcast({"type": "metric", **metric.model_dump(mode="json")})

    # Feed scoring engine
    if active_scorer and not active_scorer.paused:
        active_scorer.tick(user.id, user.name, zone, zone_label, zone_color, heart_rate, power)


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
                    await manager.broadcast({"type": "metric", **metric.model_dump(mode="json")})


async def score_broadcast_loop() -> None:
    """Broadcast leaderboard every second while a session is active."""
    while True:
        await asyncio.sleep(1)
        if active_scorer and active_session and active_session.active and not active_scorer.paused:
            elapsed = int((datetime.now(UTC) - active_session.created_at).total_seconds())
            entries = active_scorer.get_leaderboard()
            await manager.broadcast({
                "type": "leaderboard",
                "entries": [e.model_dump(mode="json") for e in entries],
                "session_id": active_session.id,
                "session_name": active_session.name,
                "elapsed_seconds": elapsed,
                "paused": False,
            })


async def session_scheduler() -> None:
    """Auto-start/stop sessions based on the schedule."""
    global active_session, active_scorer

    while True:
        await asyncio.sleep(15)
        try:
            now = datetime.now()
            current_day = now.weekday()  # 0=Mon
            current_time = now.strftime("%H:%M")

            schedule = await db.get_schedule()
            matching_slot = None
            for slot in schedule:
                if slot.active and slot.day_of_week == current_day and slot.start_time <= current_time < slot.end_time:
                    matching_slot = slot
                    break

            if matching_slot and not active_session:
                # Auto-start session
                session = Session(name=f"{matching_slot.start_time}–{matching_slot.end_time}", scheduled=True)
                await db.create_session(session)
                active_session = session
                active_scorer = SessionScorer(session.id)
                logger.info("Auto-started session %s (%s)", session.id, session.name)
                await manager.broadcast({
                    "type": "session_start",
                    "session_id": session.id,
                    "session_name": session.name,
                })

            elif active_session and active_session.scheduled and not matching_slot:
                # Auto-end scheduled session
                await _end_active_session()
                logger.info("Auto-ended scheduled session")

        except Exception:
            logger.exception("Session scheduler error")


async def _end_active_session() -> None:
    """End the active session: finalize scores, persist, broadcast, cleanup."""
    global active_session, active_scorer

    if not active_session:
        return

    ended_at = datetime.now(UTC).isoformat()
    await db.end_session(active_session.id, ended_at)

    if active_scorer:
        scores = active_scorer.finalize()
        if scores:
            await db.save_session_scores(scores)
        active_scorer = None

    session_id = active_session.id
    active_session = None

    await manager.broadcast({"type": "session_end", "session_id": session_id})


# ── REST endpoints ───────────────────────────────────────────────────


@app.post("/api/register", response_model=UserProfile)
async def register_user(req: RegisterRequest):
    user = User(name=req.name, email=req.email, max_hr=req.max_hr)
    await db.create_user(user)
    return UserProfile(id=user.id, name=user.name, email=user.email, max_hr=user.max_hr)


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
        email=user.email,
        max_hr=user.max_hr,
        device_address=device.device_address if device else None,
        device_name=device.device_name if device else None,
    )


@app.put("/api/profile/{user_id}", response_model=UserProfile)
async def update_profile(user_id: str, req: RegisterRequest):
    user = await db.update_user(user_id, name=req.name, email=req.email, max_hr=req.max_hr)
    if not user:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")
    device = await db.get_device_mapping_by_user(user_id)
    return UserProfile(
        id=user.id,
        name=user.name,
        email=user.email,
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
        email=user.email,
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
            id=u.id, name=u.name, email=u.email, max_hr=u.max_hr,
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
async def create_session_endpoint(name: str = ""):
    session = Session(name=name)
    await db.create_session(session)
    return session


# ── Session control endpoints ────────────────────────────────────────


class SessionStartRequest(BaseModel):
    name: str = ""


@app.post("/api/sessions/start")
async def start_session(req: SessionStartRequest | None = None):
    global active_session, active_scorer
    if active_session:
        raise HTTPException(status_code=409, detail="A session is already active")
    name = req.name if req else ""
    session = Session(name=name or datetime.now().strftime("%H:%M session"), scheduled=False)
    await db.create_session(session)
    active_session = session
    active_scorer = SessionScorer(session.id)
    await manager.broadcast({
        "type": "session_start",
        "session_id": session.id,
        "session_name": session.name,
    })
    return {"status": "started", "session_id": session.id, "session_name": session.name}


@app.post("/api/sessions/stop")
async def stop_session():
    if not active_session:
        raise HTTPException(status_code=404, detail="No active session")
    session_id = active_session.id
    await _end_active_session()
    return {"status": "stopped", "session_id": session_id}


@app.post("/api/sessions/pause")
async def pause_session():
    if not active_session or not active_scorer:
        raise HTTPException(status_code=404, detail="No active session")
    active_scorer.paused = True
    active_session.paused = True
    await db.set_session_paused(active_session.id, True)
    await manager.broadcast({
        "type": "session_pause",
        "session_id": active_session.id,
        "paused": True,
    })
    return {"status": "paused"}


@app.post("/api/sessions/resume")
async def resume_session():
    if not active_session or not active_scorer:
        raise HTTPException(status_code=404, detail="No active session")
    active_scorer.paused = False
    active_session.paused = False
    await db.set_session_paused(active_session.id, False)
    await manager.broadcast({
        "type": "session_pause",
        "session_id": active_session.id,
        "paused": False,
    })
    return {"status": "resumed"}


@app.get("/api/sessions/active")
async def get_active_session():
    if not active_session:
        return {"active": False}
    elapsed = int((datetime.now(UTC) - active_session.created_at).total_seconds())
    entries = active_scorer.get_leaderboard() if active_scorer else []
    return {
        "active": True,
        "session_id": active_session.id,
        "session_name": active_session.name,
        "elapsed_seconds": elapsed,
        "paused": active_session.paused,
        "leaderboard": [e.model_dump(mode="json") for e in entries],
    }


@app.get("/api/sessions")
async def list_sessions(date: str | None = None, start: str | None = None, end: str | None = None):
    if date:
        sessions = await db.get_sessions_by_date(date)
    elif start and end:
        sessions = await db.get_sessions_by_range(start, end)
    else:
        sessions = await db.get_sessions_by_date(datetime.now().strftime("%Y-%m-%d"))
    return [s.model_dump(mode="json") for s in sessions]


@app.get("/api/sessions/{session_id}")
async def get_session_detail(session_id: str):
    """Get a session's info and its participant scores."""
    scores = await db.get_session_scores(session_id)
    # Try to find the session in completed sessions
    # We need to look across all dates, so query directly
    session_row = await db.get_session_by_id(session_id)
    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session": session_row.model_dump(mode="json"),
        "scores": [s.model_dump(mode="json") for s in scores],
    }


class SessionUpdateRequest(BaseModel):
    name: str


@app.put("/api/sessions/{session_id}")
async def update_session(session_id: str, req: SessionUpdateRequest):
    updated = await db.update_session_name(session_id, req.name)
    if not updated:
        raise HTTPException(status_code=404, detail="Session not found")
    return updated.model_dump(mode="json")


@app.delete("/api/sessions/{session_id}")
async def delete_session_endpoint(session_id: str):
    # Don't allow deleting the active session
    if active_session and active_session.id == session_id:
        raise HTTPException(status_code=409, detail="Cannot delete the active session")
    deleted = await db.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted", "session_id": session_id}


# ── View mode (broadcast to all clients) ─────────────────────────────


class ViewModeRequest(BaseModel):
    mode: str  # "split" | "metrics" | "leaderboard"


@app.post("/api/view-mode")
async def set_view_mode(req: ViewModeRequest):
    global current_view_mode
    if req.mode not in ("split", "metrics", "leaderboard"):
        raise HTTPException(status_code=400, detail="Invalid mode")
    current_view_mode = req.mode
    await manager.broadcast({"type": "view_mode", "mode": current_view_mode})
    return {"status": "ok", "mode": current_view_mode}


# ── Schedule management ──────────────────────────────────────────────


@app.get("/api/schedule")
async def get_schedule():
    slots = await db.get_schedule()
    return [s.model_dump(mode="json") for s in slots]


@app.put("/api/schedule")
async def replace_schedule(slots: list[SessionScheduleSlot]):
    result = await db.replace_schedule(slots)
    return [s.model_dump(mode="json") for s in result]


@app.post("/api/schedule")
async def add_schedule_slot(slot: SessionScheduleSlot):
    result = await db.add_schedule_slot(slot)
    return result.model_dump(mode="json")


@app.delete("/api/schedule/{slot_id}")
async def delete_schedule_slot(slot_id: str):
    deleted = await db.delete_schedule_slot(slot_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Slot not found")
    return {"status": "deleted"}


class ScheduleSlotUpdate(BaseModel):
    day_of_week: int | None = None
    start_time: str | None = None
    end_time: str | None = None


@app.put("/api/schedule/{slot_id}")
async def update_schedule_slot(slot_id: str, req: ScheduleSlotUpdate):
    updated = await db.update_schedule_slot(
        slot_id,
        day_of_week=req.day_of_week,
        start_time=req.start_time,
        end_time=req.end_time,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Slot not found")
    return updated.model_dump(mode="json")


# ── Historical leaderboards ──────────────────────────────────────────


@app.get("/api/leaderboards/daily")
async def daily_leaderboard(date: str | None = None):
    """Get leaderboard for a specific day. Aggregates all sessions."""
    target = date or datetime.now().strftime("%Y-%m-%d")
    sessions = await db.get_sessions_by_date(target)
    all_scores: dict[str, dict] = {}
    session_details = []

    for s in sessions:
        scores = await db.get_session_scores(s.id)
        session_details.append({
            "session_id": s.id,
            "session_name": s.name,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "scores": [sc.model_dump(mode="json") for sc in scores],
        })
        for sc in scores:
            if sc.user_id not in all_scores:
                all_scores[sc.user_id] = {
                    "user_id": sc.user_id, "user_name": sc.user_name,
                    "total_score": 0.0, "sessions_count": 0,
                    "zone_seconds": {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0},
                    "peak_hr": 0, "power_sum": 0.0, "power_count": 0,
                }
            agg = all_scores[sc.user_id]
            agg["total_score"] += sc.total_score
            agg["sessions_count"] += 1
            agg["peak_hr"] = max(agg["peak_hr"], sc.peak_hr)
            for z in ("1", "2", "3", "4", "5"):
                agg["zone_seconds"][z] += sc.zone_seconds.get(z, 0)
            if sc.avg_power is not None:
                agg["power_sum"] += sc.avg_power
                agg["power_count"] += 1

    combined = sorted(all_scores.values(), key=lambda x: x["total_score"], reverse=True)
    for i, entry in enumerate(combined):
        entry["rank"] = i + 1
        entry["avg_power"] = round(entry.pop("power_sum") / entry.pop("power_count"), 1) if entry["power_count"] > 0 else None
        if "power_count" in entry:
            del entry["power_count"]

    return {"date": target, "combined": combined, "sessions": session_details}


@app.get("/api/leaderboards/weekly")
async def weekly_leaderboard(date: str | None = None):
    """Get aggregated leaderboard for the week containing the given date."""
    from datetime import timedelta
    target = datetime.strptime(date, "%Y-%m-%d") if date else datetime.now()
    monday = target - timedelta(days=target.weekday())
    sunday = monday + timedelta(days=7)
    start_str = monday.strftime("%Y-%m-%d")
    end_str = sunday.strftime("%Y-%m-%d")

    scores = await db.get_scores_by_date_range(start_str, end_str)
    return _aggregate_scores(scores, start_str, end_str, "weekly")


@app.get("/api/leaderboards/monthly")
async def monthly_leaderboard(year: int | None = None, month: int | None = None):
    """Get aggregated leaderboard for the given month."""
    from datetime import timedelta
    now = datetime.now()
    y = year or now.year
    m = month or now.month
    start_str = f"{y:04d}-{m:02d}-01"
    if m == 12:
        end_str = f"{y + 1:04d}-01-01"
    else:
        end_str = f"{y:04d}-{m + 1:02d}-01"

    scores = await db.get_scores_by_date_range(start_str, end_str)
    return _aggregate_scores(scores, start_str, end_str, "monthly")


def _aggregate_scores(scores: list[SessionScore], start: str, end: str, period: str) -> dict:
    agg: dict[str, dict] = {}
    for sc in scores:
        if sc.user_id not in agg:
            agg[sc.user_id] = {
                "user_id": sc.user_id, "user_name": sc.user_name,
                "total_score": 0.0, "sessions_count": 0,
                "zone_seconds": {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0},
                "peak_hr": 0, "power_sum": 0.0, "power_count": 0,
            }
        a = agg[sc.user_id]
        a["total_score"] += sc.total_score
        a["sessions_count"] += 1
        a["peak_hr"] = max(a["peak_hr"], sc.peak_hr)
        for z in ("1", "2", "3", "4", "5"):
            a["zone_seconds"][z] += sc.zone_seconds.get(z, 0)
        if sc.avg_power is not None:
            a["power_sum"] += sc.avg_power
            a["power_count"] += 1

    combined = sorted(agg.values(), key=lambda x: x["total_score"], reverse=True)
    for i, entry in enumerate(combined):
        entry["rank"] = i + 1
        entry["avg_power"] = round(entry.pop("power_sum") / entry.pop("power_count"), 1) if entry["power_count"] > 0 else None
        if "power_count" in entry:
            del entry["power_count"]

    return {"period": period, "start": start, "end": end, "combined": combined}


# ── WebSocket ────────────────────────────────────────────────────────


@app.websocket("/ws/live")
async def websocket_live(ws: WebSocket):
    await manager.connect(ws)
    try:
        # Send current view mode
        await ws.send_json({"type": "view_mode", "mode": current_view_mode})
        # Send active session info if any
        if active_session:
            elapsed = int((datetime.now(UTC) - active_session.created_at).total_seconds())
            await ws.send_json({
                "type": "session_start",
                "session_id": active_session.id,
                "session_name": active_session.name,
                "elapsed_seconds": elapsed,
                "paused": active_session.paused,
            })
            # Send current leaderboard
            if active_scorer:
                entries = active_scorer.get_leaderboard()
                await ws.send_json({
                    "type": "leaderboard",
                    "entries": [e.model_dump(mode="json") for e in entries],
                    "session_id": active_session.id,
                    "session_name": active_session.name,
                    "elapsed_seconds": elapsed,
                    "paused": active_scorer.paused,
                })
        # Send current metric state snapshot
        for metric in live_metrics.values():
            await ws.send_json({"type": "metric", **metric.model_dump(mode="json")})
        # Keep alive
        while True:
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
    """Seed demo users + devices, start a session, and simulate live HR/power."""
    global _demo_task, active_session, active_scorer

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

    # Start a demo session with scoring
    if not active_session:
        session = Session(name="Demo Session", scheduled=False)
        await db.create_session(session)
        active_session = session
        active_scorer = SessionScorer(session.id)
        await manager.broadcast({
            "type": "session_start",
            "session_id": session.id,
            "session_name": session.name,
        })

    # Start simulation loop
    if _demo_task is None or _demo_task.done():
        _demo_task = asyncio.create_task(_demo_loop())

    return {"status": "demo started", "users": len(DEMO_USERS), "session_id": active_session.id}


@app.post("/api/demo/stop")
async def stop_demo():
    global _demo_task
    if _demo_task and not _demo_task.done():
        _demo_task.cancel()
        _demo_task = None

    # End the active session (finalizes scores)
    await _end_active_session()

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
