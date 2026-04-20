"""SQLite database layer using aiosqlite."""

from __future__ import annotations

import aiosqlite

from backend.models import DeviceMapping, Session, User

DB_PATH = "pulseboard.db"


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                max_hr INTEGER NOT NULL DEFAULT 190,
                created_at TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS device_mappings (
                device_address TEXT PRIMARY KEY,
                device_name TEXT NOT NULL DEFAULT '',
                user_id TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1
            )
        """)
        await db.commit()


# ── Users ────────────────────────────────────────────────────────────


async def create_user(user: User) -> User:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO users (id, name, max_hr, created_at) VALUES (?, ?, ?, ?)",
            (user.id, user.name, user.max_hr, user.created_at.isoformat()),
        )
        await db.commit()
    return user


async def get_user(user_id: str) -> User | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        if not row:
            return None
        return User(id=row["id"], name=row["name"], max_hr=row["max_hr"])


async def update_user(user_id: str, name: str | None = None, max_hr: int | None = None) -> User | None:
    user = await get_user(user_id)
    if not user:
        return None
    async with aiosqlite.connect(DB_PATH) as db:
        if name is not None:
            await db.execute("UPDATE users SET name = ? WHERE id = ?", (name, user_id))
            user.name = name
        if max_hr is not None:
            await db.execute("UPDATE users SET max_hr = ? WHERE id = ?", (max_hr, user_id))
            user.max_hr = max_hr
        await db.commit()
    return user


async def list_users() -> list[User]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM users ORDER BY name")
        rows = await cursor.fetchall()
        return [User(id=r["id"], name=r["name"], max_hr=r["max_hr"]) for r in rows]


async def delete_user(user_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM device_mappings WHERE user_id = ?", (user_id,))
        cursor = await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        await db.commit()
        return cursor.rowcount > 0


# ── Device Mappings ──────────────────────────────────────────────────


async def claim_device(mapping: DeviceMapping) -> DeviceMapping:
    async with aiosqlite.connect(DB_PATH) as db:
        # Remove any existing mapping for this device or this user
        await db.execute("DELETE FROM device_mappings WHERE device_address = ?", (mapping.device_address,))
        await db.execute("DELETE FROM device_mappings WHERE user_id = ?", (mapping.user_id,))
        await db.execute(
            "INSERT INTO device_mappings (device_address, device_name, user_id) VALUES (?, ?, ?)",
            (mapping.device_address, mapping.device_name, mapping.user_id),
        )
        await db.commit()
    return mapping


async def get_device_mapping_by_address(address: str) -> DeviceMapping | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM device_mappings WHERE device_address = ?", (address,))
        row = await cursor.fetchone()
        if not row:
            return None
        return DeviceMapping(device_address=row["device_address"], device_name=row["device_name"], user_id=row["user_id"])


async def get_device_mapping_by_user(user_id: str) -> DeviceMapping | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM device_mappings WHERE user_id = ?", (user_id,))
        row = await cursor.fetchone()
        if not row:
            return None
        return DeviceMapping(device_address=row["device_address"], device_name=row["device_name"], user_id=row["user_id"])


async def get_all_device_mappings() -> list[DeviceMapping]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM device_mappings")
        rows = await cursor.fetchall()
        return [
            DeviceMapping(device_address=r["device_address"], device_name=r["device_name"], user_id=r["user_id"])
            for r in rows
        ]


# ── Sessions ─────────────────────────────────────────────────────────


async def create_session(session: Session) -> Session:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO sessions (id, name, created_at, active) VALUES (?, ?, ?, ?)",
            (session.id, session.name, session.created_at.isoformat(), int(session.active)),
        )
        await db.commit()
    return session


async def get_active_session() -> Session | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM sessions WHERE active = 1 ORDER BY created_at DESC LIMIT 1")
        row = await cursor.fetchone()
        if not row:
            return None
        return Session(id=row["id"], name=row["name"], active=bool(row["active"]))


async def end_session(session_id: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE sessions SET active = 0 WHERE id = ?", (session_id,))
        await db.commit()
