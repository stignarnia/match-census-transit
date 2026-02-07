#!/usr/bin/env python3
"""
Comprehensive Geographic School Search

Uses Google Places Nearby Search to systematically cover the Lisbon Metropolitan Area
with overlapping search circles to ensure complete coverage. Searches by location + type
rather than text queries to catch all schools regardless of naming.

This script is designed for completeness over speed - it may take 2-3 hours to run.
"""

import os
import json
import requests
import math
import time
from typing import Dict, List, Tuple
from dotenv import load_dotenv

load_dotenv('../../.env')
API_KEY = os.environ['VITE_GOOGLE_MAPS_API_KEY']

print("🎓 Comprehensive Geographic School Search")
print("=" * 80)
print("This will systematically search the entire Lisbon Metropolitan Area")
print("Expected duration: 2-3 hours")
print("=" * 80)

# Lisbon Metropolitan Area bounds (expanded)
AREA_BOUNDS = {
    'north': 39.05,   # North of Loures
    'south': 38.40,   # South of Setúbal
    'west': -9.50,    # West of Cascais
    'east': -8.65     # East of Montijo
}

# Search parameters
SEARCH_RADIUS_METERS = 2000  # 2km radius per search
GRID_SPACING_KM = 3.0        # 3km between search points (ensures overlap)

def haversine_distance(lat1, lng1, lat2, lng2):
    """Calculate distance in km."""
    R = 6371
    dLat = math.radians(lat2 - lat1)
    dLng = math.radians(lng2 - lng1)
    a = math.sin(dLat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLng/2)**2
    c = 2 * math.asin(math.sqrt(a))
    return R * c

def create_search_grid(bounds: dict, spacing_km: float) -> List[Tuple[float, float]]:
    """
    Create a grid of search points covering the area.
    Returns list of (lat, lng) tuples.
    """
    # Calculate approximate degrees per km
    lat_per_km = 1 / 111.0  # ~111km per degree latitude
    lng_per_km = 1 / (111.0 * math.cos(math.radians((bounds['north'] + bounds['south']) / 2)))
    
    lat_spacing = spacing_km * lat_per_km
    lng_spacing = spacing_km * lng_per_km
    
    points = []
    lat = bounds['south']
    while lat <= bounds['north']:
        lng = bounds['west']
        while lng <= bounds['east']:
            points.append((lat, lng))
            lng += lng_spacing
        lat += lat_spacing
    
    return points

def search_nearby_schools(lat: float, lng: float, radius: int, included_types: List[str]) -> Dict:
    """
    Search for schools near a specific location using Google Places Nearby Search (v1).
    """
    headers = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.types,places.rating,places.businessStatus,places.primaryType'
    }
    
    payload = {
        "includedTypes": included_types,
        "maxResultCount": 20,
        "locationRestriction": {
            "circle": {
                "center": {
                    "latitude": lat,
                    "longitude": lng
                },
                "radius": radius
            }
        }
    }
    
    try:
        response = requests.post(
            'https://places.googleapis.com/v1/places:searchNearby',
            headers=headers,
            json=payload,
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            unique_places = {}
            
            if "places" in data:
                for place in data["places"]:
                    place_id = place.get("id")
                    status = place.get("businessStatus", "OPERATIONAL")
                    
                    if status == "CLOSED_PERMANENTLY":
                        continue
                    
                    if place_id and place_id not in unique_places:
                        coords = place.get("location", {})
                        unique_places[place_id] = {
                            "type": "Feature",
                            "geometry": {
                                "type": "Point",
                                "coordinates": [
                                    coords.get("longitude", 0),
                                    coords.get("latitude", 0)
                                ]
                            },
                            "properties": {
                                "name": place.get("displayName", {}).get("text", "Unknown"),
                                "address": place.get("formattedAddress", ""),
                                "types": place.get("types", []),
                                "primary_type": place.get("primaryType", ""),
                                "rating": place.get("rating", None)
                            }
                        }
            
            return unique_places
        else:
            return {}
            
    except Exception as e:
        return {}

def is_actual_school(place: dict) -> bool:
    """Filter out non-schools like universities, driving schools, etc."""
    name = place['properties']['name'].lower()
    address = place['properties']['address'].lower()
    types = [t.lower() for t in place['properties'].get('types', [])]
    
    # Exclude keywords
    non_schools = [
        'universidade', 'university', 'faculdade', 'faculty',
        'driving school', 'escola de condução', 'auto escola',
        'music school', 'escola de música', 'conservatório',
        'dance', 'dança', 'ballet',
        'language school', 'línguas',
        'cooking', 'culinária',
        'swimming', 'natação', 'piscina',
        'gym', 'ginásio', 'fitness',
        'kindergarten only', 'creche', 'jardim de infância',
        'training center', 'centro de formação',
        'professional training', 'formação profissional'
    ]
    
    for kw in non_schools:
        if kw in name or kw in address:
            return False
    
    # Good indicators
    good_keywords = [
        'escola básica', 'escola secundária', 'eb ', 'eb1', 'eb2', 'eb3',
        'agrupamento', 'colégio', 'liceu', 'escola primária'
    ]
    
    for kw in good_keywords:
        if kw in name.lower():
            return True
    
    # Check types
    school_types = ['school', 'primary_school', 'secondary_school']
    if any(st in types for st in school_types):
        return True
    
    return False

def determine_school_type(place: dict) -> str:
    """Determine if school is primary or secondary."""
    name = place['properties']['name'].lower()
    types = place['properties'].get('types', [])
    primary_type = place['properties'].get('primary_type', '').lower()
    
    # Check primary indicators
    primary_indicators = ['básica', 'basica', 'primária', 'primaria', 'eb1', 'eb 1', '1º ciclo', 'primary']
    secondary_indicators = ['secundária', 'secundaria', 'liceu', 'secondary']
    
    primary_score = sum(1 for ind in primary_indicators if ind in name)
    secondary_score = sum(1 for ind in secondary_indicators if ind in name)
    
    if 'primary_school' in types or 'primary_school' in primary_type:
        primary_score += 2
    if 'secondary_school' in types or 'secondary_school' in primary_type:
        secondary_score += 2
    
    # EB 2,3 or "Básica 2,3" -> primary
    if 'eb 2' in name or 'eb2' in name or 'eb 3' in name or 'eb3' in name:
        primary_score += 2
    
    if secondary_score > primary_score:
        return 'secondary'
    else:
        return 'primary'  # Default to primary if unclear

# Load existing datasets
print("\n📂 Loading existing school datasets...")
existing_primary = {}
existing_secondary = {}

primary_path = os.path.join('../../', 'src', 'assets', 'primary_school.json')
secondary_path = os.path.join('../../', 'src', 'assets', 'secondary_school.json')

if os.path.exists(primary_path):
    with open(primary_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        for feature in data.get('features', []):
            # Use coordinates as a rough key
            coords = feature['geometry']['coordinates']
            key = f"{coords[1]:.5f},{coords[0]:.5f}"
            existing_primary[key] = feature
    print(f"   Loaded {len(existing_primary)} existing primary schools")

if os.path.exists(secondary_path):
    with open(secondary_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        for feature in data.get('features', []):
            coords = feature['geometry']['coordinates']
            key = f"{coords[1]:.5f},{coords[0]:.5f}"
            existing_secondary[key] = feature
    print(f"   Loaded {len(existing_secondary)} existing secondary schools")

# Create search grid
print("\n📍 Creating search grid...")
search_points = create_search_grid(AREA_BOUNDS, GRID_SPACING_KM)
print(f"   Generated {len(search_points)} search points")
print(f"   Each point searches {SEARCH_RADIUS_METERS}m radius")
print(f"   Estimated API calls: {len(search_points)}")
print(f"   Estimated time: {len(search_points) * 0.7 / 60:.1f} minutes\n")

# Search each grid point
all_found_schools = {}
search_count = 0
start_time = time.time()

print("🔍 Starting systematic search...")
print("-" * 80)

for i, (lat, lng) in enumerate(search_points, 1):
    # Search for schools (catches all types)
    results = search_nearby_schools(lat, lng, SEARCH_RADIUS_METERS, ["school"])
    
    for place_id, place in results.items():
        if place_id not in all_found_schools:
            all_found_schools[place_id] = place
    
    search_count += 1
    
    # Progress update every 10 searches
    if i % 10 == 0:
        elapsed = time.time() - start_time
        rate = i / elapsed
        remaining = (len(search_points) - i) / rate if rate > 0 else 0
        print(f"   Progress: {i}/{len(search_points)} ({i*100//len(search_points)}%) | "
              f"Found: {len(all_found_schools)} schools | "
              f"ETA: {remaining/60:.1f} min")
    
    # Rate limiting
    time.sleep(0.7)  # ~85 requests per minute (well under 100 limit)

print(f"\n✅ Search complete! Found {len(all_found_schools)} total schools")

# Filter and categorize
print("\n🔍 Filtering and categorizing schools...")
filtered_schools = {}
for place_id, place in all_found_schools.items():
    if is_actual_school(place):
        filtered_schools[place_id] = place

print(f"   After filtering: {len(filtered_schools)} valid schools")

# Categorize into primary and secondary
new_primary = {}
new_secondary = {}

for place_id, place in filtered_schools.items():
    school_type = determine_school_type(place)
    
    coords = place['geometry']['coordinates']
    coord_key = f"{coords[1]:.5f},{coords[0]:.5f}"
    
    # Check if already exists
    if school_type == 'primary':
        if coord_key not in existing_primary:
            new_primary[place_id] = place
    else:
        if coord_key not in existing_secondary:
            new_secondary[place_id] = place

print(f"   New primary schools: {len(new_primary)}")
print(f"   New secondary schools: {len(new_secondary)}")

# Merge with existing
print("\n🔄 Merging with existing datasets...")
all_primary = {**existing_primary}
all_secondary = {**existing_secondary}

# Add new schools with place_id as keys
for place_id, place in new_primary.items():
    coords = place['geometry']['coordinates']
    key = f"{coords[1]:.5f},{coords[0]:.5f}"
    if key not in all_primary:
        all_primary[key] = place

for place_id, place in new_secondary.items():
    coords = place['geometry']['coordinates']
    key = f"{coords[1]:.5f},{coords[0]:.5f}"
    if key not in all_secondary:
        all_secondary[key] = place

# Deduplicate by proximity
print("\n🔄 Deduplicating by proximity...")

def deduplicate_by_proximity(schools: dict, radius_km: float = 0.05) -> dict:
    """Remove duplicates within radius_km."""
    deduped = {}
    removed = 0
    
    for key, school in schools.items():
        coords = school['geometry']['coordinates']
        lat, lng = coords[1], coords[0]
        
        is_dup = False
        for existing_key, existing in deduped.items():
            ex_coords = existing['geometry']['coordinates']
            dist = haversine_distance(lat, lng, ex_coords[1], ex_coords[0])
            if dist < radius_km:
                is_dup = True
                removed += 1
                break
        
        if not is_dup:
            deduped[key] = school
    
    print(f"   Removed {removed} duplicates")
    return deduped

all_primary = deduplicate_by_proximity(all_primary, 0.05)
all_secondary = deduplicate_by_proximity(all_secondary, 0.05)

# Create final output
primary_output = {
    "type": "FeatureCollection",
    "features": sorted(list(all_primary.values()), key=lambda x: x['properties']['name']),
    "metadata": {
        "description": "Primary schools in Lisbon Metropolitan Area",
        "source": "Google Places API - Geographic Search",
        "count": len(all_primary),
        "generated": "2026-01-20",
        "method": "Systematic geographic grid search with 2km radius"
    }
}

secondary_output = {
    "type": "FeatureCollection",
    "features": sorted(list(all_secondary.values()), key=lambda x: x['properties']['name']),
    "metadata": {
        "description": "Secondary schools in Lisbon Metropolitan Area",
        "source": "Google Places API - Geographic Search",
        "count": len(all_secondary),
        "generated": "2026-01-20",
        "method": "Systematic geographic grid search with 2km radius"
    }
}

# Save
print("\n💾 Saving datasets...")
assets_dir = os.path.join('../../', 'src', 'assets')
os.makedirs(assets_dir, exist_ok=True)

with open(os.path.join(assets_dir, 'primary_school.json'), 'w', encoding='utf-8') as f:
    json.dump(primary_output, f, indent=2, ensure_ascii=False)

with open(os.path.join(assets_dir, 'secondary_school.json'), 'w', encoding='utf-8') as f:
    json.dump(secondary_output, f, indent=2, ensure_ascii=False)

print("\n" + "=" * 80)
print("✅ COMPREHENSIVE SEARCH COMPLETE!")
print("=" * 80)
print(f"Total Primary Schools: {len(all_primary)} (+{len(new_primary)} new)")
print(f"Total Secondary Schools: {len(all_secondary)} (+{len(new_secondary)} new)")
print(f"Grand Total: {len(all_primary) + len(all_secondary)} schools")
print(f"Search points covered: {len(search_points)}")
print(f"Total time: {(time.time() - start_time) / 60:.1f} minutes")
print("=" * 80)

if new_primary or new_secondary:
    print("\n📍 Sample of newly discovered schools:")
    if new_primary:
        print("\n   New Primary Schools:")
        for i, place in enumerate(list(new_primary.values())[:5]):
            print(f"      • {place['properties']['name']}")
    if new_secondary:
        print("\n   New Secondary Schools:")
        for i, place in enumerate(list(new_secondary.values())[:5]):
            print(f"      • {place['properties']['name']}")
