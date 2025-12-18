import os
import sys
import json
import math
import requests
from dotenv import load_dotenv

# 1. Configuration & Paths
load_dotenv('../.env')
API_KEY = os.getenv('VITE_GOOGLE_MAPS_API_KEY')
API_URL = 'https://places.googleapis.com/v1/places:searchNearby'

CENTER_LAT = 38.72
CENTER_LNG = -9.15
TOTAL_SQUARE_KM = 50
LENS_SIZE_KM = 4 # 4km x 4km sub-sections

if not API_KEY:
    print("Error: VITE_GOOGLE_MAPS_API_KEY not found in ../.env")
    sys.exit(1)

if len(sys.argv) < 2:
    print("Usage: python harvest.py <category> (e.g., python harvest.py hospital)")
    sys.exit(1)

CATEGORY = sys.argv[1]
OUTPUT_PATH = f'../src/assets/{CATEGORY}.json'

# 2. Grid Calculation Logic
# 1 degree lat ~ 111km
# 1 degree lng ~ 111km * cos(lat)
lat_step = LENS_SIZE_KM / 111.0
lng_step = LENS_SIZE_KM / (111.0 * math.cos(math.radians(CENTER_LAT)))

steps = int(TOTAL_SQUARE_KM / LENS_SIZE_KM)
start_lat = CENTER_LAT - ((steps / 2) * lat_step)
start_lng = CENTER_LNG - ((steps / 2) * lng_step)

def harvest_grid():
    unique_places = {}
    print(f"🚀 Starting harvest for category: '{CATEGORY}'")
    print(f"📍 Center: {CENTER_LAT}, {CENTER_LNG} | Area: 50x50km")

    for i in range(steps + 1):
        for j in range(steps + 1):
            current_lat = start_lat + (i * lat_step)
            current_lng = start_lng + (j * lng_step)
            
            headers = {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': API_KEY,
                'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress'
            }
            
            payload = {
                "includedTypes": [CATEGORY],
                "maxResultCount": 20,
                "locationRestriction": {
                    "circle": {
                        "center": {
                            "latitude": current_lat,
                            "longitude": current_lng
                        },
                        "radius": (LENS_SIZE_KM * 1000) / 2 # Radius for a 4km coverage
                    }
                }
            }

            try:
                response = requests.post(API_URL, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()

                if "places" in data:
                    for place in data["places"]:
                        p_id = place["id"]
                        if p_id not in unique_places:
                            unique_places[p_id] = {
                                "id": p_id,
                                "name": place.get("displayName", {}).get("text", "Unknown"),
                                "address": place.get("formattedAddress", ""),
                                "geometry": {
                                    "type": "Point",
                                    "coordinates": [
                                        place["location"]["longitude"],
                                        place["location"]["latitude"]
                                    ]
                                }
                            }
                
                print(f"Scanned grid {i},{j} | Found: {len(data.get('places', []))} | Total unique: {len(unique_places)}")

            except Exception as e:
                print(f"⚠️ Error at {current_lat}, {current_lng}: {e}")

    # 3. Save as GeoJSON FeatureCollection
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": p["geometry"],
                "properties": {
                    "name": p["name"],
                    "address": p["address"],
                    "category": CATEGORY
                }
            } for p in unique_places.values()
        ]
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ Done! Saved {len(unique_places)} unique places to {OUTPUT_PATH}")

if __name__ == "__main__":
    harvest_grid()