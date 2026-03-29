import requests
import json
import re
import pandas as pd
import os
from bs4 import BeautifulSoup

def collect_police_stations():
    """Collect police station locations from multiple sources"""
    os.makedirs('safety_data', exist_ok=True)
    
    # Source 1: OpenStreetMap
    query = """
    [out:json];
    area["name"="Andhra Pradesh"]->.ap;
    (
      node["amenity"="police"](area.ap);
      way["amenity"="police"](area.ap);
      node["police"="yes"](area.ap);
    );
    out center;
    """
    
    response = requests.post(
        "https://overpass-api.de/api/interpreter",
        data=query
    )
    
    police_stations = []
    
    if response.status_code == 200:
        data = response.json()
        
        for element in data.get('elements', []):
            if element['type'] == 'node':
                lat = element.get('lat')
                lon = element.get('lon')
            else:
                lat = element.get('center', {}).get('lat')
                lon = element.get('center', {}).get('lon')
            
            station = {
                'source': 'OSM',
                'name': element.get('tags', {}).get('name', 'Unknown'),
                'lat': lat,
                'lng': lon,
                'phone': element.get('tags', {}).get('phone', ''),
                'website': element.get('tags', {}).get('website', '')
            }
            police_stations.append(station)
        
        print(f"OSM: Found {len(police_stations)} police stations")
    
    # Source 2: AP Police Website
    try:
        response = requests.get("https://appolice.gov.in/station_list", timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Find police station listings
        for station in soup.find_all('div', class_='station'):
            name = station.find('h3').text.strip()
            address = station.find('p', class_='address').text.strip()
            phone = station.find('p', class_='phone').text.strip()
            
            # Geocode address to coordinates
            lat, lng = geocode_address(address)
            
            police_stations.append({
                'source': 'AP Police',
                'name': name,
                'address': address,
                'lat': lat,
                'lng': lng,
                'phone': phone
            })
        
        print(f"AP Police: Found {len(police_stations)} stations directly via site")
        
    except Exception as e:
        print(f"Error scraping AP Police site: {e}")
    
    # Save to CSV
    df = pd.DataFrame(police_stations)
    df.to_csv('safety_data/police_stations.csv', index=False)
    
    return police_stations

def geocode_address(address):
    """Convert address to coordinates using Nominatim"""
    import time
    time.sleep(1)  # Respect rate limits
    
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        'q': address + ", Andhra Pradesh, India",
        'format': 'json',
        'limit': 1
    }
    
    try:
        headers = { 'User-Agent': 'SafePath/1.0' }
        response = requests.get(url, params=params, headers=headers, timeout=5)
        data = response.json()
        if data:
            return float(data[0]['lat']), float(data[0]['lon'])
    except:
        pass
    
    return None, None

if __name__ == "__main__":
    collect_police_stations()
