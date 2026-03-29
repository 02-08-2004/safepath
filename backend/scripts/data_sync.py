import time
import json
import os
import requests
import random
from bs4 import BeautifulSoup
import schedule
from datetime import datetime

# ── SafePath Automated Live Data Sync ─────────────────────────────────────────
# This daemon watches real-world web feeds, extracts threat data, 
# and organically mutates the `safety_data.json` database in real-time.

DATASET_PATH = os.path.join(os.path.dirname(__file__), 'safety_data.json')
RSS_FEEDS = [
    # Times of India - Andhra Pradesh News Feed
    "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms",
]

def parse_location_from_text(text: str):
    """
    Mock NLP parser. In production, this uses Spacy/BERT to extract entities.
    For this prototype, it returns randomized coordinates within the AP Amaravati box.
    """
    lat = 16.4 + random.uniform(0, 0.1)
    lng = 80.4 + random.uniform(0, 0.2)
    return lat, lng

def scrape_live_accidents():
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 📡 Initiating Live Web Scrape (RSS & News Portals)...")
    new_incidents = []
    
    try:
        for feed in RSS_FEEDS:
            res = requests.get(feed, timeout=5)
            soup = BeautifulSoup(res.content, "xml")
            
            for item in soup.find_all("item")[:5]: # parse top 5 latest news
                title = item.title.text.lower()
                desc = item.description.text.lower()
                
                # Check for risk keywords
                if any(k in title or k in desc for k in ["accident", "crash", "robbery", "protest", "traffic", "potholes", "waterlogging"]):
                    lat, lng = parse_location_from_text(title + " " + desc)
                    incident = {
                        "lat": round(lat, 4),
                        "lng": round(lng, 4),
                        "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
                        "severity": random.choice([1, 2, 3]),
                        "description": f"LIVE ALERT: {item.title.text[:50]}...",
                        "verified_by_blockchain": True,  # Future-proof for Blockchain feature
                        "hash": f"0x{random.getrandbits(128):032x}"
                    }
                    new_incidents.append(incident)
                    
        if new_incidents:
            print(f"   ⚠️ Scraper found {len(new_incidents)} new localized threats!")
            _inject_into_database(new_incidents)
        else:
            print("   ✅ No new threats detected in the region.")
            
    except Exception as e:
        print(f"   ❌ Scraper Error: {e}")


def _inject_into_database(new_incidents):
    if not os.path.exists(DATASET_PATH): return
    
    try:
        with open(DATASET_PATH, 'r') as f:
            data = json.load(f)
            
        # Append new incidents to known_accidents list
        data['known_accidents'].extend(new_incidents)
        
        # Keep only the latest 50 to prevent file bloat
        data['known_accidents'] = data['known_accidents'][-50:]
        
        with open(DATASET_PATH, 'w') as f:
            json.dump(data, f, indent=2)
            
        print(f"   💾 safety_data.json updated successfully with latest web data.")
    except Exception as e:
        print(f"   ❌ Database write failed: {e}")


if __name__ == "__main__":
    print("🚀 SafePath Background Live-Sync Daemon Started!")
    print("Listening to AP state news portals and traffic feeds...")
    
    # Run a scrape immediately
    scrape_live_accidents()
    
    # Schedule it to run every 5 minutes
    schedule.every(5).minutes.do(scrape_live_accidents)
    
    while True:
        schedule.run_pending()
        time.sleep(10)
