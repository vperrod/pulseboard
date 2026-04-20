"""Pydantic models for PulseBoard."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, Field


# ── Database row models ──────────────────────────────────────────────


class User(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    name: str
    max_hr: int = 190
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class DeviceMapping(BaseModel):
    device_address: str  # BLE MAC address
    device_name: str = ""  # e.g. "Garmin FR265"
    user_id: str


class Session(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    name: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    active: bool = True


# ── Runtime / API models ────────────────────────────────────────────


class LiveMetric(BaseModel):
    """A single metric snapshot pushed from the BLE scanner."""

    user_id: str
    user_name: str = ""
    heart_rate: int = 0
    power: int | None = None
    zone: int = 0  # 1-5
    zone_label: str = ""
    zone_color: str = ""
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    connected: bool = True


class RegisterRequest(BaseModel):
    name: str
    max_hr: int = 190


class ClaimDeviceRequest(BaseModel):
    user_id: str
    device_address: str
    device_name: str = ""


class ScannedDevice(BaseModel):
    address: str
    name: str
    rssi: int = 0
    services: list[str] = []
    claimed_by: str | None = None  # user_id if already claimed
    heart_rate_preview: int | None = None  # live HR for identification
    has_hr_service: bool = False  # whether device advertises HR service


class UserProfile(BaseModel):
    id: str
    name: str
    max_hr: int
    device_address: str | None = None
    device_name: str | None = None
