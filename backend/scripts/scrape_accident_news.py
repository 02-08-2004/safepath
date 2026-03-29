import requests
from bs4 import BeautifulSoup
import re
from datetime import datetime
import json
import os

def scrape_accident_news():
    """Scrape accident news from local sources"""
    os.makedirs('safety_data', exist_ok=True)
    
    news_sources = [
        "https://www.thehindu.com/news/national/andhra-pradesh/",
        "https://www.deccanchronicle.com/tag/andhra-pradesh"
    ]
    
    accidents = []
    
    for source in news_sources:
        try:
            # We mock User-Agent to prevent 403 Forbidden blocks
            headers = { 'User-Agent': 'Mozilla/5.0' }
            response = requests.get(source, headers=headers, timeout=10)
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Find articles with accident keywords
            keywords = ['accident', 'crash', 'collision', 'hit-and-run']
            
            for article in soup.find_all('article'):
                text = article.get_text().lower()
                
                if any(kw in text for kw in keywords):
                    # Extract location using regex
                    location_pattern = r'(in|at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)'
                    locations = re.findall(location_pattern, article.get_text())
                    
                    if locations:
                        accident = {
                            'date': datetime.now().strftime('%Y-%m-%d'),
                            'source': source,
                            'text': text[:500],
                            'location': locations[0][1],
                            'geocoded': False
                        }
                        accidents.append(accident)
            
            print(f"  Found {len(accidents)} accident reports from {source}")
            
        except Exception as e:
            print(f"  Error scraping {source}: {e}")
    
    # Save to file
    with open('safety_data/news_accidents.json', 'w') as f:
        json.dump(accidents, f, indent=2)
    
    return accidents

if __name__ == "__main__":
    scrape_accident_news()
