"""SQLite database layer using aiosqlite."""

from __future__ import annotations

import json

import aiosqlite

from backend.models import DeviceMapping, Session, SessionScheduleSlot, SessionScore, User

DB_PATH = "pulseboard.db"


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


_DEFAULT_SCHEDULE = [
    # Mon-Fri
    *[(d, "06:00", "07:00") for d in range(5)],
    *[(d, "07:00", "08:00") for d in range(5)],
    *[(d, "08:00", "09:00") for d in range(5)],
    *[(d, "09:30", "10:30") for d in range(5)],
    *[(d, "18:00", "19:00") for d in range(5)],
    *[(d, "19:00", "20:00") for d in range(5)],
    # Sat-Sun
    *[(d, "07:00", "08:00") for d in (5, 6)],
    *[(d, "08:00", "09:00") for d in (5, 6)],
    *[(d, "09:00", "10:00") for d in (5, 6)],
]


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
                active INTEGER NOT NULL DEFAULT 1,
                ended_at TEXT,
                scheduled INTEGER NOT NULL DEFAULT 0,
                paused INTEGER NOT NULL DEFAULT 0
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS session_schedule (
                id TEXT PRIMARY KEY,
                day_of_week INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS session_scores (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_name TEXT NOT NULL DEFAULT '',
                total_score REAL NOT NULL DEFAULT 0,
                zone_seconds TEXT NOT NULL DEFAULT '{}',
                avg_power REAL,
                peak_hr INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)

        # Migrate existing sessions table if columns missing
        cursor = await db.execute("PRAGMA table_info(sessions)")
        cols = {row[1] for row in await cursor.fetchall()}
        if "ended_at" not in cols:
            await db.execute("ALTER TABLE sessions ADD COLUMN ended_at TEXT")
        if "scheduled" not in cols:
            await db.execute("ALTER TABLE sessions ADD COLUMN scheduled INTEGER NOT NULL DEFAULT 0")
        if "paused" not in cols:
            await db.execute("ALTER TABLE sessions ADD COLUMN paused INTEGER NOT NULL DEFAULT 0")

        # Migrate existing users table if email column missing
        cursor = await db.execute("PRAGMA table_info(users)")
        user_cols = {row[1] for row in await cursor.fetchall()}
        if "email" not in user_cols:
            await db.execute("ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''")

        # Seed default schedule if empty
        cursor = await db.execute("SELECT COUNT(*) FROM session_schedule")
        count = (await cursor.fetchone())[0]
        if count == 0:
            for day, start, end in _DEFAULT_SCHEDULE:
                slot = SessionScheduleSlot(day_of_week=day, start_time=start, end_time=end)
                await db.execute(
                    "INSERT INTO session_schedule (id, day_of_week, start_time, end_time, active) VALUES (?, ?, ?, ?, ?)",
                    (slot.id, slot.day_of_week, slot.start_time, slot.end_time, 1),
                )

        await db.commit()


# ── Users ────────────────────────────────────────────────────────────


async def create_user(user: User) -> User:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO users (id, name, email, max_hr, created_at) VALUES (?, ?, ?, ?, ?)",
            (user.id, user.name, user.email, user.max_hr, user.created_at.isoformat()),
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
        return User(id=row["id"], name=row["name"], email=row["email"] if "email" in row.keys() else "", max_hr=row["max_hr"])


async def update_user(user_id: str, name: str | None = None, email: str | None = None, max_hr: int | None = None) -> User | None:
    user = await get_user(user_id)
    if not user:
        return None
    async with aiosqlite.connect(DB_PATH) as db:
        if name is not None:
            await db.execute("UPDATE users SET name = ? WHERE id = ?", (name, user_id))
            user.name = name
        if email is not None:
            await db.execute("UPDATE users SET email = ? WHERE id = ?", (email, user_id))
            user.email = email
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
        return [User(id=r["id"], name=r["name"], email=r["email"] if "email" in r.keys() else "", max_hr=r["max_hr"]) for r in rows]


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
            "INSERT INTO sessions (id, name, created_at, active, ended_at, scheduled, paused) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (session.id, session.name, session.created_at.isoformat(), int(session.active),
             session.ended_at.isoformat() if session.ended_at else None,
             int(session.scheduled), int(session.paused)),
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
        return _row_to_session(row)


async def get_session_by_id(session_id: str) -> Session | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        row = await cursor.fetchone()
        if not row:
            return None
        return _row_to_session(row)


async def end_session(session_id: str, ended_at: str | None = None) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE sessions SET active = 0, ended_at = ? WHERE id = ?",
            (ended_at, session_id),
        )
        await db.commit()


async def set_session_paused(session_id: str, paused: bool) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE sessions SET paused = ? WHERE id = ?", (int(paused), session_id))
        await db.commit()


async def get_sessions_by_date(date_str: str) -> list[Session]:
    """Get all sessions whose created_at starts with date_str (YYYY-MM-DD)."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM sessions WHERE created_at LIKE ? ORDER BY created_at",
            (f"{date_str}%",),
        )
        rows = await cursor.fetchall()
        return [_row_to_session(r) for r in rows]


async def delete_session(session_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM session_scores WHERE session_id = ?", (session_id,))
        cursor = await db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        await db.commit()
        return cursor.rowcount > 0


async def update_session_name(session_id: str, name: str) -> Session | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("UPDATE sessions SET name = ? WHERE id = ?", (name, session_id))
        await db.commit()
        if cursor.rowcount == 0:
            return None
        cursor = await db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        row = await cursor.fetchone()
        return _row_to_session(row) if row else None


async def get_sessions_by_range(start_date: str, end_date: str) -> list[Session]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM sessions WHERE created_at >= ? AND created_at < ? ORDER BY created_at",
            (start_date, end_date),
        )
        rows = await cursor.fetchall()
        return [_row_to_session(r) for r in rows]


def _row_to_session(row) -> Session:
    from datetime import datetime
    ended_at = None
    if row["ended_at"]:
        try:
            ended_at = datetime.fromisoformat(row["ended_at"])
        except (ValueError, TypeError):
            pass
    return Session(
        id=row["id"],
        name=row["name"],
        active=bool(row["active"]),
        ended_at=ended_at,
        scheduled=bool(row["scheduled"]) if "scheduled" in row.keys() else False,
        paused=bool(row["paused"]) if "paused" in row.keys() else False,
    )


# ── Schedule ─────────────────────────────────────────────────────────


async def get_schedule() -> list[SessionScheduleSlot]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM session_schedule ORDER BY day_of_week, start_time")
        rows = await cursor.fetchall()
        return [
            SessionScheduleSlot(
                id=r["id"], day_of_week=r["day_of_week"],
                start_time=r["start_time"], end_time=r["end_time"],
                active=bool(r["active"]),
            )
            for r in rows
        ]


async def replace_schedule(slots: list[SessionScheduleSlot]) -> list[SessionScheduleSlot]:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM session_schedule")
        for s in slots:
            await db.execute(
                "INSERT INTO session_schedule (id, day_of_week, start_time, end_time, active) VALUES (?, ?, ?, ?, ?)",
                (s.id, s.day_of_week, s.start_time, s.end_time, int(s.active)),
            )
        await db.commit()
    return slots


async def add_schedule_slot(slot: SessionScheduleSlot) -> SessionScheduleSlot:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO session_schedule (id, day_of_week, start_time, end_time, active) VALUES (?, ?, ?, ?, ?)",
            (slot.id, slot.day_of_week, slot.start_time, slot.end_time, int(slot.active)),
        )
        await db.commit()
    return slot


async def delete_schedule_slot(slot_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("DELETE FROM session_schedule WHERE id = ?", (slot_id,))
        await db.commit()
        return cursor.rowcount > 0


async def update_schedule_slot(
    slot_id: str,
    day_of_week: int | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
) -> SessionScheduleSlot | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM session_schedule WHERE id = ?", (slot_id,))
        row = await cursor.fetchone()
        if not row:
            return None
        new_day = day_of_week if day_of_week is not None else row["day_of_week"]
        new_start = start_time if start_time is not None else row["start_time"]
        new_end = end_time if end_time is not None else row["end_time"]
        await db.execute(
            "UPDATE session_schedule SET day_of_week = ?, start_time = ?, end_time = ? WHERE id = ?",
            (new_day, new_start, new_end, slot_id),
        )
        await db.commit()
        return SessionScheduleSlot(
            id=slot_id, day_of_week=new_day,
            start_time=new_start, end_time=new_end,
            active=bool(row["active"]),
        )


# ── Scores ───────────────────────────────────────────────────────────


async def save_session_scores(scores: list[SessionScore]) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        for s in scores:
            await db.execute(
                "INSERT INTO session_scores (id, session_id, user_id, user_name, total_score, zone_seconds, avg_power, peak_hr, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (s.id, s.session_id, s.user_id, s.user_name, s.total_score,
                 json.dumps(s.zone_seconds), s.avg_power, s.peak_hr,
                 s.created_at.isoformat()),
            )
        await db.commit()


async def get_session_scores(session_id: str) -> list[SessionScore]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM session_scores WHERE session_id = ? ORDER BY total_score DESC",
            (session_id,),
        )
        rows = await cursor.fetchall()
        return [_row_to_score(r) for r in rows]


async def get_scores_by_date_range(start_date: str, end_date: str) -> list[SessionScore]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT ss.* FROM session_scores ss
               JOIN sessions s ON ss.session_id = s.id
               WHERE s.created_at >= ? AND s.created_at < ?
               ORDER BY ss.total_score DESC""",
            (start_date, end_date),
        )
        rows = await cursor.fetchall()
        return [_row_to_score(r) for r in rows]


def _row_to_score(row) -> SessionScore:
    return SessionScore(
        id=row["id"],
        session_id=row["session_id"],
        user_id=row["user_id"],
        user_name=row["user_name"],
        total_score=row["total_score"],
        zone_seconds=json.loads(row["zone_seconds"]) if row["zone_seconds"] else {},
        avg_power=row["avg_power"],
        peak_hr=row["peak_hr"],
    )
