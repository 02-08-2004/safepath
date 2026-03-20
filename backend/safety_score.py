# ── Phase 3: Safety Scoring Engine ──────────────────────────────────────────
# Computes a 0-100 safety score for a road segment using weighted factors.
# Called by the route optimizer to assign costs to graph edges.

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SegmentFactors:
    """All measurable safety factors for a single road segment."""
    lighting:         float = 50.0   # 0 = no light, 100 = fully lit
    crime_incidents:  int   = 0      # number of incidents within 100 m in last 30 days
    crowd_density:    float = 50.0   # 0 = deserted, 100 = very busy
    has_cctv:         bool  = False
    has_patrol:       bool  = False
    near_hospital:    bool  = False  # bonus — quick emergency access
    time_of_day:      int   = 12     # hour 0-23 (lighting weight increases at night)


# Factor weights — must sum to 1.0
WEIGHTS = {
    "lighting":  0.30,
    "crime":     0.25,
    "crowd":     0.25,
    "cctv":      0.20,
}


def calculate_safety_score(factors: SegmentFactors) -> int:
    """
    Returns an integer safety score in [0, 100].
    Higher = safer.
    """
    # Lighting adjustment: weight climbs to 0.45 between 20:00-05:00
    is_night = factors.time_of_day >= 20 or factors.time_of_day <= 5
    lighting_weight = 0.45 if is_night else WEIGHTS["lighting"]
    crime_weight    = 0.25
    crowd_weight    = 0.20 if is_night else WEIGHTS["crowd"]
    cctv_weight     = 0.10 if is_night else WEIGHTS["cctv"]

    # Normalise crime count: 0 incidents → 100, each incident costs 10 points (floor 0)
    crime_score = max(0.0, 100.0 - factors.crime_incidents * 10)

    # CCTV / patrol bonuses
    cctv_score  = 100.0 if factors.has_cctv    else 20.0
    crowd_score = factors.crowd_density

    # If patrol is active, add flat +5 bonus (capped at 100)
    patrol_bonus   = 5.0 if factors.has_patrol   else 0.0
    hospital_bonus = 3.0 if factors.near_hospital else 0.0

    raw = (
        factors.lighting * lighting_weight +
        crime_score       * crime_weight    +
        crowd_score       * crowd_weight    +
        cctv_score        * cctv_weight     +
        patrol_bonus + hospital_bonus
    )
    return min(100, round(raw))


def score_to_label(score: int) -> str:
    if score >= 75: return "safe"
    if score >= 50: return "moderate"
    return "danger"


def score_to_cost(score: int) -> float:
    """
    Convert safety score to a path cost for A* / Dijkstra.
    Low safety score = high cost = route optimizer avoids it.
    Uses an exponential penalty so very unsafe segments are strongly avoided.
    """
    safety_ratio = score / 100.0
    return 1.0 + (1.0 - safety_ratio) ** 2 * 10.0
