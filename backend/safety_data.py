# ── Safety Data Model for Andhra Pradesh ──────────────────────────────────────
import json
import os
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
import numpy as np
from datetime import datetime

@dataclass
class RoadSegment:
    """Represents a road segment with all safety attributes"""
    id: str
    lat: float
    lng: float
    end_lat: float
    end_lng: float
    road_name: str
    road_type: str  # highway, primary, secondary, residential, etc.
    
    # Safety attributes (0-100 scale)
    lighting_score: int = 50
    crowd_density: int = 50
    police_patrol: int = 50
    crime_reports: int = 50
    cctv_coverage: int = 50
    
    # Physical conditions
    road_condition: int = 80  # 0-100 (higher is better)
    accident_history: int = 0  # number of accidents
    isolation_score: int = 50  # how isolated (higher = more isolated)
    
    # Timestamp data
    last_updated: str = field(default_factory=lambda: datetime.now().isoformat())
    
    def safety_score(self, hour: int = None) -> float:
        """Calculate overall safety score for this segment"""
        # Base weights
        weights = {
            'lighting': 0.25,
            'crowd': 0.20,
            'patrol': 0.15,
            'crime': 0.20,
            'cctv': 0.10,
            'road_condition': 0.10
        }
        
        # Adjust lighting weight at night
        if hour and (hour < 6 or hour > 20):
            weights['lighting'] = 0.35
            weights['crowd'] = 0.15
        
        score = (
            self.lighting_score * weights['lighting'] +
            self.crowd_density * weights['crowd'] +
            self.police_patrol * weights['patrol'] +
            (100 - min(self.crime_reports * 5, 100)) * weights['crime'] +
            self.cctv_coverage * weights['cctv'] +
            self.road_condition * weights['road_condition']
        )
        
        # Penalty for accident history
        score -= min(self.accident_history * 2, 20)
        
        return max(0, min(100, score))


@dataclass
class SafetyDataset:
    """Complete safety dataset for Andhra Pradesh"""
    segments: List[RoadSegment] = field(default_factory=list)
    
    # Known high-risk areas
    high_risk_zones: List[Dict] = field(default_factory=list)
    known_accidents: List[Dict] = field(default_factory=list)
    police_stations: List[Dict] = field(default_factory=list)
    cctv_locations: List[Dict] = field(default_factory=list)
    
    def add_segment(self, segment: RoadSegment):
        self.segments.append(segment)
    
    def get_segment_at(self, lat: float, lng: float, radius: float = 0.001) -> Optional[RoadSegment]:
        """Find the nearest road segment"""
        min_dist = float('inf')
        nearest = None
        for seg in self.segments:
            dist = ((seg.lat - lat) ** 2 + (seg.lng - lng) ** 2) ** 0.5
            if dist < min_dist:
                min_dist = dist
                nearest = seg
        return nearest if min_dist < radius else None
    
    def to_dict(self) -> dict:
        return {
            'segments': [vars(s) for s in self.segments],
            'high_risk_zones': self.high_risk_zones,
            'known_accidents': self.known_accidents,
            'police_stations': self.police_stations,
            'cctv_locations': self.cctv_locations
        }
    
    def save(self, filepath: str):
        with open(filepath, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)
    
    @classmethod
    def load(cls, filepath: str) -> 'SafetyDataset':
        with open(filepath, 'r') as f:
            data = json.load(f)
        dataset = cls()
        for seg_data in data.get('segments', []):
            dataset.segments.append(RoadSegment(**seg_data))
        dataset.high_risk_zones = data.get('high_risk_zones', [])
        dataset.known_accidents = data.get('known_accidents', [])
        dataset.police_stations = data.get('police_stations', [])
        dataset.cctv_locations = data.get('cctv_locations', [])
        return dataset


# ── Andhra Pradesh Specific Data ──────────────────────────────────────────────
def create_ap_safety_dataset() -> SafetyDataset:
    """Create a comprehensive safety dataset for Andhra Pradesh"""
    dataset = SafetyDataset()
    
    # Known high-risk areas in AP
    dataset.high_risk_zones = [
        {"name": "NH-16 (Chennai-Kolkata Highway)", "lat": 16.45, "lng": 80.55, "radius": 0.05, "risk": "high"},
        {"name": "Guntur-Narasaraopet Road", "lat": 16.30, "lng": 80.45, "radius": 0.03, "risk": "moderate"},
        {"name": "Vijayawada City Center", "lat": 16.51, "lng": 80.64, "radius": 0.02, "risk": "high"},
        {"name": "Visakhapatnam Port Area", "lat": 17.70, "lng": 83.30, "radius": 0.04, "risk": "moderate"},
        {"name": "Tirupati Temple Road", "lat": 13.63, "lng": 79.42, "radius": 0.03, "risk": "high (crowded)"},
    ]
    
    # Police stations in Amaravati region
    dataset.police_stations = [
        {"name": "Mangalagiri Police Station", "lat": 16.4333, "lng": 80.5667, "patrol_range": 2},
        {"name": "Guntur Rural Police", "lat": 16.3067, "lng": 80.4365, "patrol_range": 3},
        {"name": "Amaravati Police Station", "lat": 16.5062, "lng": 80.6480, "patrol_range": 2},
        {"name": "Tadepalli Police Station", "lat": 16.4833, "lng": 80.6167, "patrol_range": 1.5},
    ]
    
    # CCTV locations in Amaravati region
    dataset.cctv_locations = [
        {"name": "SRM University Gate", "lat": 16.4624, "lng": 80.5064},
        {"name": "VIT University Gate", "lat": 16.4978, "lng": 80.5248},
        {"name": "Neerukonda Junction", "lat": 16.4817, "lng": 80.5114},
        {"name": "Mandadam Cross", "lat": 16.4938, "lng": 80.5217},
        {"name": "Mangalagiri Toll Plaza", "lat": 16.4333, "lng": 80.5667},
    ]
    
    # Known accident spots
    dataset.known_accidents = [
        {"lat": 16.445, "lng": 80.560, "date": "2024-01-15", "severity": 3, "description": "NH-16 curve"},
        {"lat": 16.470, "lng": 80.520, "date": "2024-02-20", "severity": 2, "description": "Neerukonda intersection"},
        {"lat": 16.490, "lng": 80.530, "date": "2024-03-10", "severity": 1, "description": "VIT Approach Road"},
    ]
    
    # Create road segments for key roads
    # NH-16 Segment (Guntur to Vijayawada)
    for i in range(20):
        t = i / 20
        lat = 16.3067 + (16.5062 - 16.3067) * t
        lng = 80.4365 + (80.6480 - 80.4365) * t
        
        segment = RoadSegment(
            id=f"NH16_{i}",
            lat=lat, lng=lng,
            end_lat=lat + 0.005, end_lng=lng + 0.005,
            road_name="NH-16",
            road_type="highway",
            lighting_score=70,
            crowd_density=60,
            police_patrol=65,
            crime_reports=3,
            cctv_coverage=55,
            road_condition=75,
            accident_history=2
        )
        dataset.add_segment(segment)
    
    # Amaravati Inner Ring Road
    for i in range(15):
        t = i / 15
        lat = 16.4624 + (16.4978 - 16.4624) * t
        lng = 80.5064 + (80.5248 - 80.5064) * t
        
        segment = RoadSegment(
            id=f"ARR_{i}",
            lat=lat, lng=lng,
            end_lat=lat + 0.003, end_lng=lng + 0.003,
            road_name="Amaravati Ring Road",
            road_type="primary",
            lighting_score=85,
            crowd_density=55,
            police_patrol=70,
            crime_reports=1,
            cctv_coverage=80,
            road_condition=90,
            accident_history=0
        )
        dataset.add_segment(segment)
    
    # Neerukonda to Mandadam Road
    for i in range(10):
        t = i / 10
        lat = 16.4817 + (16.4938 - 16.4817) * t
        lng = 80.5114 + (80.5217 - 80.5114) * t
        
        segment = RoadSegment(
            id=f"NRM_{i}",
            lat=lat, lng=lng,
            end_lat=lat + 0.002, end_lng=lng + 0.002,
            road_name="Neerukonda-Mandadam Road",
            road_type="secondary",
            lighting_score=75,
            crowd_density=65,
            police_patrol=60,
            crime_reports=2,
            cctv_coverage=70,
            road_condition=85,
            accident_history=1
        )
        dataset.add_segment(segment)
    
    return dataset


# ── ML-based Safety Predictor (Simplified) ────────────────────────────────────
class SafetyPredictor:
    """Predict safety scores based on historical data"""
    
    def __init__(self, dataset: SafetyDataset):
        self.dataset = dataset
        self._train_model()
    
    def _train_model(self):
        """Train a simple model on the dataset"""
        pass
    
    def predict(self, lat: float, lng: float, hour: int = None) -> dict:
        """Predict safety for a location"""
        segment = self.dataset.get_segment_at(lat, lng)
        
        if segment:
            score = segment.safety_score(hour)
            
            # Find nearby risk zones
            nearby_risks = []
            for zone in self.dataset.high_risk_zones:
                dist = ((lat - zone['lat']) ** 2 + (lng - zone['lng']) ** 2) ** 0.5
                if dist < zone.get('radius', 0.05):
                    nearby_risks.append(zone['name'])
            
            return {
                'safety_score': score,
                'lighting': segment.lighting_score,
                'crowd': segment.crowd_density,
                'patrol': segment.police_patrol,
                'crime': segment.crime_reports,
                'cctv': segment.cctv_coverage,
                'road_condition': segment.road_condition,
                'nearby_risks': nearby_risks,
                'is_isolated': segment.isolation_score > 70
            }
        
        return {
            'safety_score': 50,
            'lighting': 50,
            'crowd': 50,
            'patrol': 50,
            'crime': 0,
            'cctv': 50,
            'road_condition': 70,
            'nearby_risks': [],
            'is_isolated': False
        }
