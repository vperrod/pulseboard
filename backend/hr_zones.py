"""HR zone calculation and color coding."""

from __future__ import annotations

ZONE_CONFIG = [
    (0.50, 0.60, 1, "Zone 1 – Recovery", "#94A3B8"),   # gray/slate
    (0.60, 0.70, 2, "Zone 2 – Easy", "#3B82F6"),       # blue
    (0.70, 0.80, 3, "Zone 3 – Aerobic", "#22C55E"),    # green
    (0.80, 0.90, 4, "Zone 4 – Threshold", "#F97316"),  # orange
    (0.90, 1.00, 5, "Zone 5 – Max", "#EF4444"),        # red
]


def calculate_zone(heart_rate: int, max_hr: int) -> tuple[int, str, str]:
    """Return (zone_number, zone_label, zone_color) for the given HR."""
    if max_hr <= 0 or heart_rate <= 0:
        return 0, "", "#94A3B8"

    pct = heart_rate / max_hr
    for low, high, num, label, color in ZONE_CONFIG:
        if pct < high:
            return num, label, color
    # Above 100% max HR → still Zone 5
    return 5, "Zone 5 – Max", "#EF4444"
