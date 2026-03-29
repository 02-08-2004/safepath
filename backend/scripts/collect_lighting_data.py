import requests
import json
import pandas as pd
import os

def collect_lighting_data():
    """Collect street lighting data from OSM and surveys"""
    os.makedirs('safety_data', exist_ok=True)
    
    lighting_data = []
    
    # Source 1: OSM lit tags
    query = """
    [out:json];
    area["name"="Andhra Pradesh"]->.ap;
    (
      way["highway"]["lit"="yes"](area.ap);
      way["highway"]["lit"="no"](area.ap);
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
                if element['type'] == 'way':
                    lat = element.get('center', {}).get('lat')
                    lng = element.get('center', {}).get('lon')
                    lit = element.get('tags', {}).get('lit', 'unknown')
                    
                    lighting_data.append({
                        'source': 'OSM',
                        'lat': lat,
                        'lng': lng,
                        'lit': lit,
                        'road_name': element.get('tags', {}).get('name', '')
                    })
            
            print(f"OSM: Found {len(lighting_data)} lighting records")
    except Exception as e:
        print(f"OSM Lighting query failed: {e}")
    
    # Source 3: Manual survey points
    manual_points = [
        {'lat': 16.4624, 'lng': 80.5064, 'lit': 'yes', 'description': 'SRM University Entrance - Well lit'},
        {'lat': 16.4817, 'lng': 80.5114, 'lit': 'yes', 'description': 'Neerukonda Junction - Well lit'},
        {'lat': 16.4938, 'lng': 80.5217, 'lit': 'partial', 'description': 'Mandadam - Partially lit'},
        {'source': 'Manual', 'road_name': 'Survey A'}
    ]
    
    lighting_data.extend(manual_points)
    print(f"Manual: Added {len(manual_points)} survey points")
    
    # Save to CSV
    df = pd.DataFrame(lighting_data)
    df.to_csv('safety_data/lighting.csv', index=False)
    
    return lighting_data

if __name__ == "__main__":
    collect_lighting_data()
