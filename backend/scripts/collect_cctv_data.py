import requests
import json
import pandas as pd
from bs4 import BeautifulSoup
import os

def collect_cctv_locations():
    """Collect CCTV camera locations from OSM and News arrays"""
    os.makedirs('safety_data', exist_ok=True)
    
    cctv_locations = []
    
    # Source 1: OpenStreetMap
    query = """
    [out:json];
    area["name"="Andhra Pradesh"]->.ap;
    (
      node["surveillance"="camera"](area.ap);
      node["man_made"="surveillance"](area.ap);
      node["camera:type"="fixed"](area.ap);
      node["highway"="traffic_signals"]["surveillance"="yes"](area.ap);
    );
    out center;
    """
    
    try:
        response = requests.post(
            "https://overpass-api.de/api/interpreter",
            data=query
        )
        
        if response.status_code == 200:
            data = response.json()
            for element in data.get('elements', []):
                if element['type'] == 'node':
                    lat = element.get('lat')
                    lng = element.get('lon')
                else:
                    lat = element.get('center', {}).get('lat')
                    lng = element.get('center', {}).get('lon')
                
                cctv = {
                    'source': 'OSM',
                    'lat': lat,
                    'lng': lng,
                    'type': element.get('tags', {}).get('surveillance:type', 'unknown'),
                    'status': element.get('tags', {}).get('surveillance:status', 'unknown')
                }
                cctv_locations.append(cctv)
            
            print(f"OSM: Found {len(cctv_locations)} CCTV locations")
    except Exception as e:
        print(f"OSM CCTV query failed: {e}")

    # Save to CSV
    df = pd.DataFrame(cctv_locations)
    df.to_csv('safety_data/cctv_locations.csv', index=False)
    
    return cctv_locations

if __name__ == "__main__":
    collect_cctv_locations()
