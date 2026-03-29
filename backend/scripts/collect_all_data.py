import os
import json
import time
from datetime import datetime

# Load env variables
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

def collect_all_data():
    """Run all data collection scripts"""
    
    print("=" * 50)
    print("SafePath Data Collection Pipeline")
    print("=" * 50)
    print(f"Started at: {datetime.now()}")
    
    # Create data directory
    os.makedirs('safety_data', exist_ok=True)
    
    # Track collection results
    results = {}
    
    # 1. Road Network
    print("\n📊 Collecting Road Network Data...")
    try:
        from collect_road_data import collect_road_data
        results['roads'] = len(collect_road_data())
        print(f"✅ Collected {results['roads']} road segments")
    except Exception as e:
        print(f"❌ Failed: {e}")
        results['roads'] = 0
    
    # 2. Accident Data
    print("\n📊 Collecting Accident Data...")
    try:
        from collect_accident_data import collect_accident_data
        results['accidents'] = len(collect_accident_data())
        print(f"✅ Collected {results['accidents']} accident records")
    except Exception as e:
        print(f"❌ Failed: {e}")
        results['accidents'] = 0
    
    # 3. Police Stations
    print("\n📊 Collecting Police Station Data...")
    try:
        from collect_police_data import collect_police_stations
        results['police'] = len(collect_police_stations())
        print(f"✅ Collected {results['police']} police stations")
    except Exception as e:
        print(f"❌ Failed: {e}")
        results['police'] = 0
    
    # 4. CCTV Locations
    print("\n📊 Collecting CCTV Data...")
    try:
        from collect_cctv_data import collect_cctv_locations
        results['cctv'] = len(collect_cctv_locations())
        print(f"✅ Collected {results['cctv']} CCTV locations")
    except Exception as e:
        print(f"❌ Failed: {e}")
        results['cctv'] = 0
    
    # 5. Street Lighting
    print("\n📊 Collecting Street Lighting Data...")
    try:
        from collect_lighting_data import collect_lighting_data
        results['lighting'] = len(collect_lighting_data())
        print(f"✅ Collected {results['lighting']} lighting records")
    except Exception as e:
        print(f"❌ Failed: {e}")
        results['lighting'] = 0
    
    # 6. Crowd Density
    print("\n📊 Collecting Crowd Density Data...")
    try:
        from collect_crowd_data import collect_crowd_data
        results['crowd'] = len(collect_crowd_data())
        print(f"✅ Collected {results['crowd']} crowd indicators")
    except Exception as e:
        print(f"❌ Failed: {e}")
        results['crowd'] = 0
        
    # NOTE: Weather data explicitly excluded per user instruction!
    
    # 7. Emergency Facilities
    print("\n📊 Collecting Emergency Facility Data...")
    try:
        from collect_emergency_data import collect_emergency_data
        results['emergency'] = len(collect_emergency_data())
        print(f"✅ Collected {results['emergency']} emergency facilities")
    except Exception as e:
        print(f"❌ Failed: {e}")
        results['emergency'] = 0
    
    # Save summary
    summary = {
        'timestamp': datetime.now().isoformat(),
        'results': results
    }
    
    with open('safety_data/collection_summary.json', 'w') as f:
        json.dump(summary, f, indent=2)
    
    print("\n" + "=" * 50)
    print("Collection Complete!")
    print(f"Total records: {sum(results.values())}")
    print("=" * 50)
    
    return results

if __name__ == "__main__":
    collect_all_data()
