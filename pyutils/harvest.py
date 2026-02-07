import os
import sys
import json
import math
import requests
import argparse
from dotenv import load_dotenv

# 1. Configuration & Paths
load_dotenv('../.env')
API_KEY = os.environ['VITE_GOOGLE_MAPS_API_KEY']
API_URL = 'https://places.googleapis.com/v1/places:searchNearby'

CENTER_LAT = float(os.environ['CENTER_LAT'])
CENTER_LNG = float(os.environ['CENTER_LNG'])
TOTAL_SQUARE_KM = float(os.environ['TOTAL_SQUARE_KM'])
LENS_SIZE_KM = float(os.environ['LENS_SIZE_KM'])

if not API_KEY:
    print("Error: VITE_GOOGLE_MAPS_API_KEY not found in ../.env")
    sys.exit(1)

parser = argparse.ArgumentParser(description="Harvest Google Places into a GeoJSON file.")
parser.add_argument('categories', nargs='+', help='One or more place categories to harvest')
parser.add_argument('-o', '--output', dest='output_path', default='../src/assets', help='Output directory path (default: ../src/assets)')
args = parser.parse_args()

CATEGORIES = args.categories
OUTPUT_FILENAME = f"{CATEGORIES[0]}_google_places.json"
OUTPUT_PATH = os.path.join(args.output_path, OUTPUT_FILENAME)

# 2. Grid Logic
lat_step = LENS_SIZE_KM / 111.0
lng_step = LENS_SIZE_KM / (111.0 * math.cos(math.radians(CENTER_LAT)))
steps = int(TOTAL_SQUARE_KM / LENS_SIZE_KM)
start_lat = CENTER_LAT - ((steps / 2) * lat_step)
start_lng = CENTER_LNG - ((steps / 2) * lng_step)

def run_multi_harvest():
    unique_places = {}
    scan_radius_meters = (LENS_SIZE_KM * 1000) * 0.70 # Optimized overlap

    print(f"🚀 Starting Multi-Category Harvest")
    print(f"🏷️  Target Categories: {', '.join(CATEGORIES)}")

    for i in range(steps + 1):
        for j in range(steps + 1):
            curr_lat = start_lat + (i * lat_step)
            curr_lng = start_lng + (j * lng_step)
            
            # Since searchNearby only accepts 1 type, we loop the categories for THIS tile
            for category in CATEGORIES:
                headers = {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': API_KEY,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress'
                }
                
                payload = {
                    "includedTypes": [category], # MUST be a single-item list
                    "maxResultCount": 20,
                    "locationRestriction": {
                        "circle": {
                            "center": {"latitude": curr_lat, "longitude": curr_lng},
                            "radius": scan_radius_meters
                        }
                    }
                }

                try:
                    response = requests.post(API_URL, headers=headers, json=payload)
                    if response.status_code == 400:
                        # Catch specific case where a type might not be supported in SearchNearby
                        print(f"\n⚠️ Category '{category}' might be invalid for SearchNearby.")
                        continue
                        
                    response.raise_for_status()
                    data = response.json()

                    if "places" in data:
                        for p in data["places"]:
                            p_id = p["id"]
                            if p_id not in unique_places:
                                unique_places[p_id] = {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [p["location"]["longitude"], p["location"]["latitude"]]
                                    },
                                    "properties": {
                                        "name": p.get("displayName", {}).get("text", "Unknown"),
                                        "address": p.get("formattedAddress", ""),
                                        "harvest_category": category
                                    }
                                }
                except Exception as e:
                    print(f"\n❌ Error at {curr_lat}, {curr_lng} for {category}: {e}")

            sys.stdout.write(f"\rGrid {i},{j} done. Total unique found: {len(unique_places)}")
            sys.stdout.flush()

    # 3. Save as Single GeoJSON
    geojson = {
        "type": "FeatureCollection",
        "features": list(unique_places.values())
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, indent=2, ensure_ascii=False)
    
    print(f"\n\n✅ SUCCESS: {len(unique_places)} places saved to {OUTPUT_PATH}")

if __name__ == "__main__":
    run_multi_harvest()