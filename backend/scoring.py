"""Real-time scoring engine for PulseBoard sessions."""

from __future__ import annotations

from dataclasses import dataclass, field

from backend.models import LeaderboardEntry, SessionScore

# Exponential zone points per second
ZONE_POINTS: dict[int, int] = {0: 0, 1: 1, 2: 2, 3: 4, 4: 8, 5: 16}


def power_multiplier(watts: int | None) -> float:
    """1.0 + 0.01 per watt.  200W → 3.0x, 0/None → 1.0x."""
    if not watts or watts <= 0:
        return 1.0
    return 1.0 + watts * 0.01


@dataclass
class _UserAccum:
    """Per-user score accumulator for a single session."""
    user_name: str = ""
    total: float = 0.0
    zone_seconds: dict[str, int] = field(default_factory=lambda: {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0})
    power_sum: float = 0.0
    power_count: int = 0
    peak_hr: int = 0
    last_hr: int = 0
    last_zone: int = 0
    last_zone_label: str = ""
    last_zone_color: str = ""
    last_power: int | None = None


class SessionScorer:
    """Accumulates scores for all participants during a session."""

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self._users: dict[str, _UserAccum] = {}
        self.paused = False

    def tick(self, user_id: str, user_name: str, zone: int, zone_label: str, zone_color: str, heart_rate: int, power: int | None) -> None:
        """Call ~once per second per user to accumulate score."""
        if self.paused:
            return

        acc = self._users.get(user_id)
        if acc is None:
            acc = _UserAccum(user_name=user_name)
            self._users[user_id] = acc

        acc.user_name = user_name
        acc.last_hr = heart_rate
        acc.last_zone = zone
        acc.last_zone_label = zone_label
        acc.last_zone_color = zone_color
        acc.last_power = power

        if heart_rate > acc.peak_hr:
            acc.peak_hr = heart_rate

        pts = ZONE_POINTS.get(zone, 0) * power_multiplier(power)
        acc.total += pts

        z_key = str(zone)
        if z_key in acc.zone_seconds:
            acc.zone_seconds[z_key] += 1

        if power and power > 0:
            acc.power_sum += power
            acc.power_count += 1

    def get_leaderboard(self) -> list[LeaderboardEntry]:
        """Return sorted leaderboard with ranks, merging latest live data."""
        entries = []
        for uid, acc in self._users.items():
            entries.append(LeaderboardEntry(
                user_id=uid,
                user_name=acc.user_name,
                score=round(acc.total, 1),
                heart_rate=acc.last_hr,
                zone=acc.last_zone,
                zone_label=acc.last_zone_label,
                zone_color=acc.last_zone_color,
                zone_seconds=dict(acc.zone_seconds),
                power=acc.last_power,
            ))
        entries.sort(key=lambda e: e.score, reverse=True)
        for i, e in enumerate(entries):
            e.rank = i + 1
        return entries

    def finalize(self) -> list[SessionScore]:
        """Return final scores for DB persistence."""
        results = []
        for uid, acc in self._users.items():
            avg_power = round(acc.power_sum / acc.power_count, 1) if acc.power_count > 0 else None
            results.append(SessionScore(
                session_id=self.session_id,
                user_id=uid,
                user_name=acc.user_name,
                total_score=round(acc.total, 1),
                zone_seconds=dict(acc.zone_seconds),
                avg_power=avg_power,
                peak_hr=acc.peak_hr,
            ))
        results.sort(key=lambda s: s.total_score, reverse=True)
        return results

    def reset(self) -> None:
        self._users.clear()
        self.paused = False
