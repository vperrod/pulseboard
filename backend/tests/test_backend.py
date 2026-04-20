"""Tests for PulseBoard backend."""

import struct

import pytest

from backend.ble_scanner import parse_hr_measurement, parse_power_measurement
from backend.hr_zones import calculate_zone


# ── HR Zone tests ────────────────────────────────────────────────────


class TestHRZones:
    def test_zone1_recovery(self):
        zone, label, color = calculate_zone(100, 200)  # 50%
        assert zone == 1
        assert "Recovery" in label

    def test_zone2_easy(self):
        zone, label, color = calculate_zone(130, 200)  # 65%
        assert zone == 2
        assert "Easy" in label

    def test_zone3_aerobic(self):
        zone, label, color = calculate_zone(150, 200)  # 75%
        assert zone == 3
        assert "Aerobic" in label

    def test_zone4_threshold(self):
        zone, label, color = calculate_zone(170, 200)  # 85%
        assert zone == 4
        assert "Threshold" in label

    def test_zone5_max(self):
        zone, label, color = calculate_zone(190, 200)  # 95%
        assert zone == 5
        assert "Max" in label

    def test_above_max_hr(self):
        zone, label, color = calculate_zone(210, 200)  # 105%
        assert zone == 5

    def test_zero_hr(self):
        zone, label, color = calculate_zone(0, 200)
        assert zone == 0

    def test_zero_max_hr(self):
        zone, label, color = calculate_zone(150, 0)
        assert zone == 0

    def test_boundary_60_percent(self):
        # 60% is the boundary between zone 1 and zone 2
        zone, label, _ = calculate_zone(120, 200)  # exactly 60%
        assert zone == 2

    def test_exact_max(self):
        zone, label, _ = calculate_zone(200, 200)  # 100%
        assert zone == 5

    def test_realistic_runner(self):
        # 150 bpm with max 190 → 78.9% → Zone 3
        zone, label, _ = calculate_zone(150, 190)
        assert zone == 3


# ── BLE data parsing tests ──────────────────────────────────────────


class TestBLEParsing:
    def test_hr_8bit(self):
        # Flags: 0x00 (8-bit HR), HR: 72
        data = bytearray([0x00, 72])
        assert parse_hr_measurement(data) == 72

    def test_hr_16bit(self):
        # Flags: 0x01 (16-bit HR), HR: 300 (unlikely but valid)
        hr_bytes = struct.pack("<H", 300)
        data = bytearray([0x01]) + bytearray(hr_bytes)
        assert parse_hr_measurement(data) == 300

    def test_hr_with_rr_intervals(self):
        # Flags: 0x10 (8-bit HR, RR present), HR: 85, RR: ignored
        data = bytearray([0x10, 85, 0x00, 0x03])
        assert parse_hr_measurement(data) == 85

    def test_power_measurement(self):
        # Flags: 0x0000, Power: 250 watts
        flags = struct.pack("<H", 0)
        power = struct.pack("<h", 250)
        data = bytearray(flags + power)
        assert parse_power_measurement(data) == 250

    def test_power_zero(self):
        flags = struct.pack("<H", 0)
        power = struct.pack("<h", 0)
        data = bytearray(flags + power)
        assert parse_power_measurement(data) == 0


# ── Database tests ───────────────────────────────────────────────────


@pytest.fixture
async def setup_db(tmp_path, monkeypatch):
    """Use a temporary database for each test."""
    db_path = str(tmp_path / "test.db")
    import backend.database as db_module
    monkeypatch.setattr(db_module, "DB_PATH", db_path)
    await db_module.init_db()
    return db_module


@pytest.mark.asyncio
async def test_create_and_get_user(setup_db):
    db_module = setup_db
    from backend.models import User
    user = User(name="Alice", max_hr=185)
    await db_module.create_user(user)

    fetched = await db_module.get_user(user.id)
    assert fetched is not None
    assert fetched.name == "Alice"
    assert fetched.max_hr == 185


@pytest.mark.asyncio
async def test_update_user(setup_db):
    db_module = setup_db
    from backend.models import User
    user = User(name="Bob", max_hr=190)
    await db_module.create_user(user)

    updated = await db_module.update_user(user.id, name="Bobby", max_hr=195)
    assert updated is not None
    assert updated.name == "Bobby"
    assert updated.max_hr == 195


@pytest.mark.asyncio
async def test_claim_device(setup_db):
    db_module = setup_db
    from backend.models import DeviceMapping, User
    user = User(name="Charlie", max_hr=180)
    await db_module.create_user(user)

    mapping = DeviceMapping(device_address="AA:BB:CC:DD:EE:FF", device_name="Garmin FR265", user_id=user.id)
    await db_module.claim_device(mapping)

    fetched = await db_module.get_device_mapping_by_address("AA:BB:CC:DD:EE:FF")
    assert fetched is not None
    assert fetched.user_id == user.id
    assert fetched.device_name == "Garmin FR265"


@pytest.mark.asyncio
async def test_claim_device_replaces_old_mapping(setup_db):
    db_module = setup_db
    from backend.models import DeviceMapping, User
    user1 = User(name="Dave", max_hr=180)
    user2 = User(name="Eve", max_hr=175)
    await db_module.create_user(user1)
    await db_module.create_user(user2)

    # User1 claims device
    m1 = DeviceMapping(device_address="11:22:33:44:55:66", device_name="Polar H10", user_id=user1.id)
    await db_module.claim_device(m1)

    # User2 claims the same device — should replace
    m2 = DeviceMapping(device_address="11:22:33:44:55:66", device_name="Polar H10", user_id=user2.id)
    await db_module.claim_device(m2)

    fetched = await db_module.get_device_mapping_by_address("11:22:33:44:55:66")
    assert fetched is not None
    assert fetched.user_id == user2.id


@pytest.mark.asyncio
async def test_list_users(setup_db):
    db_module = setup_db
    from backend.models import User
    await db_module.create_user(User(name="Zara", max_hr=180))
    await db_module.create_user(User(name="Adam", max_hr=190))

    users = await db_module.list_users()
    assert len(users) == 2
    assert users[0].name == "Adam"  # sorted by name
