import requests
import json
import os

def collect_road_data():
    """Collect complete road network for Andhra Pradesh"""
    
    # Split AP into bounding boxes for manageable chunks
    regions = [
        {"name": "Amaravati", "bbox": "16.2,80.4,16.8,80.8"},
        {"name": "Guntur", "bbox": "16.2,80.3,16.5,80.6"},
        {"name": "Vijayawada", "bbox": "16.4,80.5,16.6,80.7"},
        {"name": "Visakhapatnam", "bbox": "17.6,83.1,17.8,83.3"},
        {"name": "Tirupati", "bbox": "13.5,79.3,13.7,79.5"}
    ]
    
    all_roads = []
    
    # Ensure dir exists safely
    os.makedirs('safety_data', exist_ok=True)
    
    for region in regions:
        print(f"Collecting roads for {region['name']}...")
        
        # Overpass query for roads in bounding box
        query = f"""
        [out:json];
        (
          way["highway"]({region['bbox']});
          way["highway"="motorway"]({region['bbox']});
          way["highway"="trunk"]({region['bbox']});
          way["highway"="primary"]({region['bbox']});
          way["highway"="secondary"]({region['bbox']});
          way["highway"="tertiary"]({region['bbox']});
          way["highway"="residential"]({region['bbox']});
        );
        out body;
        >;
        out skel qt;
        """
        
        try:
            response = requests.post(
                "https://overpass-api.de/api/interpreter",
                data=query,
                timeout=60
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Extract road features
                for element in data.get('elements', []):
                    if element['type'] == 'way':
                        road = {
                            'id': element['id'],
                            'type': element.get('tags', {}).get('highway', 'unknown'),
                            'name': element.get('tags', {}).get('name', ''),
                            'lit': element.get('tags', {}).get('lit', 'unknown'),
                            'surface': element.get('tags', {}).get('surface', ''),
                            'lanes': element.get('tags', {}).get('lanes', ''),
                            'maxspeed': element.get('tags', {}).get('maxspeed', ''),
                            'oneway': element.get('tags', {}).get('oneway', 'no'),
                            'nodes': element.get('nodes', [])
                        }
                        all_roads.append(road)
                
                print(f"  Collected {len(data.get('elements', []))} road elements")
        except Exception as e:
             print(f"  Failed for {region['name']}: {e}")
             
    # Save to file
    with open('safety_data/roads.json', 'w') as f:
        json.dump(all_roads, f)
    
    print(f"✅ Total roads collected: {len(all_roads)}")
    return all_roads

if __name__ == "__main__":
    collect_road_data()
