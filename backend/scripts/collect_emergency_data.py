import requests
import json
import pandas as pd
import os

def collect_emergency_data():
    """Collect hospitals and emergency services data"""
    os.makedirs('safety_data', exist_ok=True)
    
    emergency_data = []
    
    # Source 1: OSM Hospitals
    query = """
    [out:json];
    area["name"="Andhra Pradesh"]->.ap;
    (
      node["amenity"="hospital"](area.ap);
      node["amenity"="clinic"](area.ap);
      node["amenity"="doctors"](area.ap);
      node["emergency"="yes"](area.ap);
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
                
                tags = element.get('tags', {})
                amenity = tags.get('amenity', '')
                
                emergency_data.append({
                    'source': 'OSM',
                    'name': tags.get('name', ''),
                    'type': amenity,
                    'lat': lat,
                    'lng': lng,
                    'phone': tags.get('phone', ''),
                    'emergency': tags.get('emergency', 'no'),
                    '24h': tags.get('opening_hours', '').find('24/7') != -1
                })
            
            print(f"OSM: Found {len(emergency_data)} emergency facilities")
    except Exception as e:
        print(f"Emergency Data Extraction failed: {e}")
    
    # Save to CSV
    df = pd.DataFrame(emergency_data)
    df.to_csv('safety_data/emergency_facilities.csv', index=False)
    
    return emergency_data

if __name__ == "__main__":
    collect_emergency_data()
