import requests
import json
import pandas as pd
import os

def collect_crowd_data():
    """Collect crowd density indicators from OSM and Google Places"""
    os.makedirs('safety_data', exist_ok=True)
    
    crowd_data = []
    
    # Source 1: OSM amenities that indicate crowds
    query = """
    [out:json];
    area["name"="Andhra Pradesh"]->.ap;
    (
      node["amenity"="market"](area.ap);
      node["amenity"="bus_station"](area.ap);
      node["amenity"="theatre"](area.ap);
      node["shop"="mall"](area.ap);
      node["amenity"="college"](area.ap);
      node["amenity"="university"](area.ap);
      node["railway"="station"](area.ap);
      node["amenity"="hospital"](area.ap);
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
                amenity_type = tags.get('amenity') or tags.get('shop') or tags.get('railway')
                
                # Assign crowd density score (0-100)
                density_scores = {
                    'market': 80,
                    'bus_station': 85,
                    'theatre': 75,
                    'mall': 70,
                    'college': 65,
                    'university': 70,
                    'station': 85,
                    'hospital': 60
                }
                
                crowd_data.append({
                    'source': 'OSM',
                    'lat': lat,
                    'lng': lng,
                    'type': amenity_type,
                    'name': tags.get('name', ''),
                    'density_score': density_scores.get(amenity_type, 50)
                })
            
            print(f"OSM: Found {len(crowd_data)} crowd-indicating locations")
    except Exception as e:
        print(f"OSM Crowd Density Fetch Error: {e}")
    
    # Source 2: Google Places API (optional, requires API key)
    GOOGLE_API_KEY = os.getenv('GOOGLE_PLACES_API_KEY')
    
    if GOOGLE_API_KEY:
        try:
            # Popular area centers in AP
            centers = [
                (16.5062, 80.6480, "Amaravati"),
                (16.3067, 80.4365, "Guntur"),
                (16.5165, 80.6479, "Vijayawada"),
                (17.6868, 83.2185, "Visakhapatnam")
            ]
            
            for lat, lng, city in centers:
                # Search for popular places
                url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
                params = {
                    'location': f"{lat},{lng}",
                    'radius': 2000,
                    'key': GOOGLE_API_KEY,
                    'type': 'tourist_attraction|shopping_mall|transit_station'
                }
                
                response = requests.get(url, params=params)
                if response.status_code == 200:
                    data = response.json()
                    for place in data.get('results', []):
                        crowd_data.append({
                            'source': 'Google Places',
                            'lat': place['geometry']['location']['lat'],
                            'lng': place['geometry']['location']['lng'],
                            'type': place['types'][0] if place['types'] else 'unknown',
                            'name': place.get('name', ''),
                            'popularity': place.get('rating', 3.5) * 20,  # Convert to 0-100 scale
                            'user_ratings_total': place.get('user_ratings_total', 0)
                        })
                
                print(f"Google Places: Added API places for {city}")
        except Exception as e:
            print(f"Google Places extraction failed: {e}")
            
    # Save to CSV
    df = pd.DataFrame(crowd_data)
    df.to_csv('safety_data/crowd_density.csv', index=False)
    
    return crowd_data

if __name__ == "__main__":
    collect_crowd_data()
