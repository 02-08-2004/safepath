import requests
import pandas as pd
import time
import os

def collect_accident_data():
    """Collect accident data from NCRB and data.gov.in"""
    
    # Your data.gov.in API key
    API_KEY = os.getenv('DATA_GOV_API_KEY')
    os.makedirs('safety_data', exist_ok=True)
    
    # Dataset IDs for accidents
    datasets = [
        # Traffic Accidents in India
        "9ef84268-d588-465a-a308-a864a43d0070",
        # Road Accidents by Classification
        "14f23112-30a9-4487-9a0e-f3e63e71886d"
    ]
    
    all_accidents = []
    
    for dataset_id in datasets:
        url = f"https://api.data.gov.in/resource/{dataset_id}"
        params = {
            "api-key": API_KEY,
            "format": "json",
            "limit": 1000,
            "offset": 0
        }
        
        while True:
            try:
                response = requests.get(url, params=params)
                if response.status_code != 200:
                    break
                    
                data = response.json()
                records = data.get('records', [])
                
                if not records:
                    break
                    
                # Filter for Andhra Pradesh
                for record in records:
                    if 'Andhra Pradesh' in str(record):
                        all_accidents.append(record)
                
                print(f"  Collected {len(records)} records (total: {len(all_accidents)})")
                
                # Check if there are more records
                if len(records) < params['limit']:
                    break
                params['offset'] += params['limit']
                time.sleep(1)  # Respect rate limits
            except Exception as e:
                print(f"  Exception querying api.data.gov.in: {e}")
                break
    
    # Save to CSV
    df = pd.DataFrame(all_accidents)
    df.to_csv('safety_data/accidents.csv', index=False)
    print(f"✅ Total accident records: {len(all_accidents)}")
    
    return all_accidents

if __name__ == "__main__":
    collect_accident_data()
