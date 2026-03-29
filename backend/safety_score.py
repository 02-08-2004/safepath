# ── Safety Score Calculation with AP Dataset Integration ──────────────────────
from dataclasses import dataclass
from typing import Optional
import os
import json
import logging
from datetime import datetime

log = logging.getLogger(__name__)

# Try to load the safety dataset
try:
    from safety_data import SafetyDataset, SafetyPredictor, create_ap_safety_dataset
    
    # Load or create dataset
    DATASET_PATH = os.path.join(os.path.dirname(__file__), 'safety_data.json')
    if os.path.exists(DATASET_PATH):
        dataset = SafetyDataset.load(DATASET_PATH)
    else:
        dataset = create_ap_safety_dataset()
        dataset.save(DATASET_PATH)
    
    predictor = SafetyPredictor(dataset)
    HAS_DATASET = True
    log.info("✅ Safety dataset loaded successfully")
except ImportError:
    HAS_DATASET = False
    log.warning("⚠️ Safety dataset not available, using basic scoring")


@dataclass
class SegmentFactors:
    lighting: float
    crime_incidents: int
    crowd_density: float
    has_cctv: bool
    has_patrol: bool
    time_of_day: int
    lat: Optional[float] = None
    lng: Optional[float] = None
    near_hospital: bool = False


def calculate_safety_score(factors: SegmentFactors) -> float:
    """Calculate safety score with AP dataset integration"""
    
    # Try to get enhanced score from dataset if available
    if HAS_DATASET and factors.lat and factors.lng:
        try:
            prediction = predictor.predict(factors.lat, factors.lng, factors.time_of_day)
            
            # Blend dataset score with real-time factors
            dataset_score = prediction['safety_score']
            
            # Real-time factors (from OSM and DB)
            realtime_score = (
                factors.lighting * 0.25 +
                (100 - min(factors.crime_incidents * 5, 100)) * 0.25 +
                factors.crowd_density * 0.20 +
                (100 if factors.has_cctv else 0) * 0.15 +
                (100 if factors.has_patrol else 0) * 0.15
            )
            
            if factors.near_hospital:
                realtime_score += 5
                
            # Weighted blend: 70% dataset, 30% realtime
            final_score = dataset_score * 0.7 + realtime_score * 0.3
            
            # Night time adjustment
            if factors.time_of_day < 6 or factors.time_of_day > 20:
                final_score = final_score * 0.85
            
            return min(100, max(0, final_score))
            
        except Exception as e:
            log.error(f"Dataset prediction error: {e}")
    
    # Fallback to basic scoring
    score = (
        factors.lighting * 0.30 +
        (100 - min(factors.crime_incidents * 5, 100)) * 0.25 +
        factors.crowd_density * 0.25 +
        (100 if factors.has_cctv else 0) * 0.20
    )
    
    if factors.time_of_day < 6 or factors.time_of_day > 20:
        score = score * 0.7
    
    return min(100, max(0, score))


def score_to_cost(score: float) -> float:
    """Convert safety score to pathfinding cost (higher score = lower cost)"""
    safety_ratio = score / 100.0
    return 1.0 + (1.0 - safety_ratio) ** 2 * 10.0


# ── Additional helper functions for route enrichment ──────────────────────────
def get_road_safety_summary(lat: float, lng: float) -> dict:
    """Get detailed safety summary for a location"""
    if not HAS_DATASET:
        return {'status': 'dataset_not_available'}
    
    try:
        return predictor.predict(lat, lng)
    except Exception as e:
        return {'error': str(e)}
