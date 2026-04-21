"""Tests for the scoring engine."""

from backend.scoring import SessionScorer, ZONE_POINTS, power_multiplier


def test_zone_points():
    assert ZONE_POINTS == {0: 0, 1: 1, 2: 2, 3: 4, 4: 8, 5: 16}


def test_power_multiplier():
    assert power_multiplier(None) == 1.0
    assert power_multiplier(0) == 1.0
    assert power_multiplier(100) == 2.0
    assert power_multiplier(200) == 3.0
    assert power_multiplier(50) == 1.5


def test_scorer_tick_and_leaderboard():
    scorer = SessionScorer("test-session")

    # User A: 5 ticks in zone 5 (16 pts each) with no power (1.0x) = 80 pts
    for _ in range(5):
        scorer.tick("userA", "Alice", 5, "Zone 5 – Max", "#EF4444", 185, None)

    # User B: 5 ticks in zone 3 (4 pts each) with 200W (3.0x) = 60 pts
    for _ in range(5):
        scorer.tick("userB", "Bob", 3, "Zone 3 – Aerobic", "#22C55E", 140, 200)

    lb = scorer.get_leaderboard()
    assert len(lb) == 2
    assert lb[0].user_id == "userA"
    assert lb[0].rank == 1
    assert lb[0].score == 80.0
    assert lb[1].user_id == "userB"
    assert lb[1].rank == 2
    assert lb[1].score == 60.0

    # User B zone_seconds should have 5 seconds in zone 3
    assert lb[1].zone_seconds["3"] == 5


def test_scorer_power_overtakes():
    scorer = SessionScorer("test2")

    # User A: zone 4 (8 pts), no power = 8/tick
    # User B: zone 2 (2 pts), 300W (4.0x) = 8/tick
    for _ in range(10):
        scorer.tick("a", "A", 4, "Z4", "#F97316", 170, None)
        scorer.tick("b", "B", 2, "Z2", "#3B82F6", 120, 300)

    lb = scorer.get_leaderboard()
    assert lb[0].score == 80.0
    assert lb[1].score == 80.0  # tied


def test_scorer_paused():
    scorer = SessionScorer("test3")
    scorer.tick("u", "User", 5, "Z5", "#EF4444", 190, None)  # 16 pts
    scorer.paused = True
    scorer.tick("u", "User", 5, "Z5", "#EF4444", 190, None)  # should not count
    lb = scorer.get_leaderboard()
    assert lb[0].score == 16.0


def test_scorer_finalize():
    scorer = SessionScorer("test4")
    for _ in range(10):
        scorer.tick("u1", "User1", 3, "Z3", "#22C55E", 150, 150)

    results = scorer.finalize()
    assert len(results) == 1
    r = results[0]
    assert r.session_id == "test4"
    assert r.user_id == "u1"
    assert r.total_score == 100.0  # 4 * 2.5 * 10
    assert r.zone_seconds["3"] == 10
    assert r.avg_power == 150.0
    assert r.peak_hr == 150


def test_scorer_peak_hr():
    scorer = SessionScorer("test5")
    scorer.tick("u", "U", 3, "Z3", "#22C55E", 150, None)
    scorer.tick("u", "U", 5, "Z5", "#EF4444", 195, None)
    scorer.tick("u", "U", 3, "Z3", "#22C55E", 140, None)
    results = scorer.finalize()
    assert results[0].peak_hr == 195
