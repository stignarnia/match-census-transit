#!/usr/bin/env python3
"""
Fetches Portuguese schools from multiple reliable sources:
1. OSM (Overpass API) - Community-curated data
2. Portuguese Ministry of Education (DGEEC) - Official registry (if available via dados.gov.pt)
3. Google Places - As supplementary data with filtering

This script prioritizes quality and official data over completeness.
"""

import os
import json
import requests
from typing import Dict, Tuple
from dotenv import load_dotenv

load_dotenv('../../.env')
CENTER_LAT = float(os.environ['CENTER_LAT'])
CENTER_LNG = float(os.environ['CENTER_LNG'])
SEARCH_RADIUS_KM = float(os.environ['TOTAL_SQUARE_KM'])

# OSM Query bounds (expanded to cover full Lisbon Metropolitan Area)
# Includes: Lisbon, Cascais, Sintra, Loures, Odivelas, Amadora, Oeiras,
# Almada, Seixal, Barreiro, Moita, Montijo, Alcochete, and northern Setúbal
OSM_BOUNDS = {
    "south": 38.45,  # Expanded south to include Setúbal area
    "north": 39.0,   # Expanded north to include Sintra, Loures
    "west": -9.5,    # Expanded west to include Cascais, Sintra
    "east": -8.7     # Expanded east to include Montijo, Alcochete
}

print("🎓 Portuguese Schools Data Fetcher")
print("=" * 60)

# ==============================================================================
# 1. FETCH FROM OPENSTREETMAP (OVERPASS API)
# ==============================================================================
def fetch_osm_schools() -> Dict[str, dict]:
    """
    Fetch schools from OpenStreetMap using Overpass API.
    Queries in chunks to avoid timeouts on large areas.
    """
    print("\n📍 Fetching from OpenStreetMap (Overpass API)...")
    
    osm_schools = {}
    
    try:
        overpass_url = "https://overpass-api.de/api/interpreter"
        
        # Split the large area into 4 quadrants to avoid timeout
        mid_lat = (OSM_BOUNDS['south'] + OSM_BOUNDS['north']) / 2
        mid_lng = (OSM_BOUNDS['west'] + OSM_BOUNDS['east']) / 2
        
        quadrants = [
            {"name": "NW", "south": mid_lat, "north": OSM_BOUNDS['north'], "west": OSM_BOUNDS['west'], "east": mid_lng},
            {"name": "NE", "south": mid_lat, "north": OSM_BOUNDS['north'], "west": mid_lng, "east": OSM_BOUNDS['east']},
            {"name": "SW", "south": OSM_BOUNDS['south'], "north": mid_lat, "west": OSM_BOUNDS['west'], "east": mid_lng},
            {"name": "SE", "south": OSM_BOUNDS['south'], "north": mid_lat, "west": mid_lng, "east": OSM_BOUNDS['east']},
        ]
        
        for quad in quadrants:
            print(f"  Querying {quad['name']} quadrant...")
            
            query = f"""
            [bbox:{quad['south']},{quad['west']},{quad['north']},{quad['east']}];
            (
                node["amenity"="school"];
                way["amenity"="school"];
            );
            out center;
            """
            
            try:
                response = requests.post(overpass_url, data=query, timeout=60)
                response.raise_for_status()
                data = response.json()
                
                for element in data.get('elements', []):
                    osm_id = f"osm_{element.get('id')}"
                    
                    # Skip if already added (from another quadrant)
                    if osm_id in osm_schools:
                        continue
                    
                    # Extract coordinates (use 'center' for ways)
                    if 'center' in element:
                        lat, lng = element['center']['lat'], element['center']['lon']
                    elif 'lat' in element:
                        lat, lng = element['lat'], element['lon']
                    else:
                        continue
                    
                    tags = element.get('tags', {})
                    name = tags.get('name', 'Unknown School')
                    address = tags.get('addr:street', '') + ', ' + tags.get('addr:city', 'Lisbon')
                    
                    # Try to determine school type from tags
                    level = tags.get('school:level', '').lower()
                    if 'primary' in level or 'basic' in level or 'elementary' in level:
                        school_type = "primary"
                    elif 'secondary' in level or 'high' in level or 'middle' in level:
                        school_type = "secondary"
                    else:
                        # Default to secondary
                        school_type = "secondary"
                    
                    osm_schools[osm_id] = {
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [lng, lat]
                        },
                        "properties": {
                            "name": name,
                            "address": address.strip(),
                            "school_type": school_type,
                            "sources": ["osm"],
                            "confidence": "high",
                            "osm_id": element.get('id')
                        }
                    }
                
                print(f"    ✓ Found {len([s for s in osm_schools.values() if s['geometry']['coordinates'][1] >= quad['south'] and s['geometry']['coordinates'][1] <= quad['north']])} schools in {quad['name']}")
                
            except Exception as quad_e:
                print(f"    ⚠️  Error in {quad['name']} quadrant: {quad_e}")
                continue
        
        print(f"✅ OSM: Total {len(osm_schools)} schools")
        return osm_schools
        
    except Exception as e:
        print(f"⚠️  Error fetching from OSM: {e}")
        return osm_schools


# ==============================================================================
# 2. PARSE GOOGLE MAPS DATASET WITH FILTERING
# ==============================================================================
def filter_google_schools() -> Tuple[Dict[str, dict], Dict[str, dict]]:
    """
    Parse the existing Google Maps secondary_school.json and filter it.
    Apply heuristics to separate primary from secondary and remove obvious non-schools.
    """
    print("\n🗺️  Parsing existing Google Places dataset...")
    
    primary_schools = {}
    secondary_schools = {}
    
    # Default: look for the harvest output in the current directory
    google_json_path = './secondary_school_google_places.json'
    
    if not os.path.exists(google_json_path):
        print(f"⚠️  {google_json_path} not found")
        return {}, {}
    
    try:
        with open(google_json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        features = data.get('features', [])
        
        # Keywords to EXCLUDE (non-schools)
        exclude_keywords = [
            'university', 'faculdade', 'universidade', 'technical',
            'training center', 'centro de formação', 'language school',
            'dance', 'music', 'yoga', 'gym', 'fitness', 'academy',
            'driving school', 'auto school', 'academia', 'instituto',
            'library', 'biblioteca', 'cultural', 'art', 'museum',
            'preschool', 'daycare', 'creche', 'infantário',
            'lar', 'lda', 'ltd', 'ltd.', 'empresa', 'empresa',
            'fme solutions', 'solutions', 'tutoring', 'coaching'
        ]
        
        # Keywords that indicate PRIMARY schools
        primary_keywords = [
            'básica', 'basica', 'primary', 'elementary', 'grundschule',
            '1º ciclo', '1 ciclo', 'primeiro ciclo', '2º ciclo', '2 ciclo'
        ]
        
        # Keywords that indicate SECONDARY schools
        secondary_keywords = [
            'secundária', 'secundaria', 'secondary', '3º ciclo', '3 ciclo', 'high school',
            'gymnasium', 'lycée', 'mittelschule'
        ]
        
        for feature in features:
            props = feature.get('properties', {})
            name = props.get('name', '').lower()
            address = props.get('address', '').lower()
            category = props.get('harvest_category', '').lower()
            
            # Skip if matches exclude keywords
            if any(kw in name or kw in address for kw in exclude_keywords):
                continue
            
            # Skip universities explicitly
            if category == 'university':
                continue
            
            # Determine school type based on keywords
            school_type = None
            if any(kw in name or kw in address for kw in primary_keywords):
                school_type = "primary"
            elif any(kw in name or kw in address for kw in secondary_keywords):
                school_type = "secondary"
            else:
                # Default to secondary if unclear (less conservative)
                school_type = "secondary"
            
            # Create standardized feature
            feature_id = f"google_{hash(name + address) % 10**8}"
            
            processed_feature = {
                "type": "Feature",
                "geometry": feature.get('geometry'),
                "properties": {
                    "name": props.get('name', 'Unknown'),
                    "address": props.get('address', ''),
                    "school_type": school_type,
                    "sources": ["google"],
                    "confidence": "medium"
                }
            }
            
            if school_type == "primary":
                primary_schools[feature_id] = processed_feature
            else:
                secondary_schools[feature_id] = processed_feature
        
        print(f"✅ Google Places: Filtered {len(primary_schools)} primary + {len(secondary_schools)} secondary")
        return primary_schools, secondary_schools
        
    except Exception as e:
        print(f"⚠️  Error parsing Google dataset: {e}")
        return {}, {}


# ==============================================================================
# 3. MAIN EXECUTION
# ==============================================================================
if __name__ == "__main__":
    try:
        osm_schools = fetch_osm_schools()
        primary_from_google, secondary_from_google = filter_google_schools()
        
        # Combine OSM + filtered Google (prioritize OSM for duplicates)
        all_primary = {**primary_from_google}
        all_primary.update({k: v for k, v in osm_schools.items() 
                           if v['properties']['school_type'] == 'primary'})
        
        all_secondary = {**secondary_from_google}
        all_secondary.update({k: v for k, v in osm_schools.items() 
                             if v['properties']['school_type'] == 'secondary'})
        
        # Save primary schools
        primary_output = {
            "type": "FeatureCollection",
            "features": list(all_primary.values())
        }
        
        os.makedirs('../src/assets', exist_ok=True)
        with open('../src/assets/primary_school.json', 'w', encoding='utf-8') as f:
            json.dump(primary_output, f, indent=2, ensure_ascii=False)
        
        # Save secondary schools
        secondary_output = {
            "type": "FeatureCollection",
            "features": list(all_secondary.values())
        }
        
        with open('../src/assets/secondary_school.json', 'w', encoding='utf-8') as f:
            json.dump(secondary_output, f, indent=2, ensure_ascii=False)
        
        print("\n" + "=" * 60)
        print(f"✅ SUCCESS!")
        print(f"   Primary schools:   {len(all_primary)} schools → primary_school.json")
        print(f"   Secondary schools: {len(all_secondary)} schools → secondary_school.json")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
