#!/usr/bin/env python3
"""
Primary and Secondary Schools Dataset Generator

Uses Google Places API directly with multiple queries to capture maximum schools:
- "escola basica" (primary schools)
- "escola secundaria" (secondary schools)
- And various related queries for better coverage
"""

import os
import json
import requests
import math
import time
from dotenv import load_dotenv

load_dotenv('../../.env')
API_KEY = os.environ['VITE_GOOGLE_MAPS_API_KEY']

print("🎓 Google Places API School Search (Enhanced)")
print("=" * 70)

def haversine_distance(lat1, lng1, lat2, lng2):
    """Calculate distance in km."""
    R = 6371
    dLat = math.radians(lat2 - lat1)
    dLng = math.radians(lng2 - lng1)
    a = math.sin(dLat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLng/2)**2
    c = 2 * math.asin(math.sqrt(a))
    return R * c

def search_google_places(query: str) -> dict:
    """Search Google Places using the Places Text Search API."""
    unique_places = {}
    
    print(f"\n🔍 Searching for '{query}'...")
    print("-" * 70)
    
    headers = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.types,places.rating,places.businessStatus'
    }
    
    # Try different query variations including all major municipalities
    # in the Lisbon Metropolitan Area
    queries = [
        f"{query} Lisboa Portugal",
        f"{query} Lisbon",
        f"{query} Cascais Portugal",
        f"{query} Sintra Portugal",
        f"{query} Loures Portugal",
        f"{query} Odivelas Portugal",
        f"{query} Amadora Portugal",
        f"{query} Oeiras Portugal",
        f"{query} Almada Portugal",
        f"{query} Seixal Portugal",
        f"{query} Barreiro Portugal",
        f"{query} Montijo Portugal",
        f"{query} Alcochete Portugal",
        f"{query} Moita Portugal",
        f"{query} Setúbal Portugal",
        query,
    ]
    
    for search_query in queries:
        payload = {
            "textQuery": search_query,
            "maxResultCount": 20,
            "languageCode": "pt"
        }
        
        try:
            print(f"   Query: '{search_query}'")
            response = requests.post(
                'https://places.googleapis.com/v1/places:searchText',
                headers=headers,
                json=payload,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                count_before = len(unique_places)
                
                if "places" in data:
                    for place in data["places"]:
                        place_id = place.get("id")
                        # Only include open or operating businesses
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
                                    "rating": place.get("rating", None)
                                }
                            }
                
                count_added = len(unique_places) - count_before
                print(f"      ✓ Found {count_added} new places ({len(unique_places)} total)")
            else:
                print(f"      ⚠️  Error {response.status_code}")
                
        except Exception as e:
            print(f"      ⚠️  Error: {e}")
        
        time.sleep(0.5)  # Rate limiting between requests
    
    return unique_places

# Search for primary schools with multiple queries
primary_queries = [
    "escola basica",
    "escolas primarias",
    "primary school",
]

print("\n📚 PRIMARY SCHOOLS SEARCH")
primary_places = {}
for q in primary_queries:
    results = search_google_places(q)
    primary_places.update(results)
    time.sleep(0.5)

print(f"\n✅ Primary schools aggregated: {len(primary_places)} unique places")

# Search for secondary schools
secondary_queries = [
    "escola secundaria",
    "secondary school",
    "escolas secundarias",
]

print("\n📚 SECONDARY SCHOOLS SEARCH")
secondary_places = {}
for q in secondary_queries:
    results = search_google_places(q)
    secondary_places.update(results)
    time.sleep(0.5)

print(f"\n✅ Secondary schools aggregated: {len(secondary_places)} unique places")

# Post-processing: Filter for actual schools
def is_actual_school(place: dict) -> bool:
    """Verify the place is actually a school."""
    props = place.get('properties', {})
    types = props.get('types', [])
    name = props.get('name', '').lower()
    address = props.get('address', '').lower()
    
    # Non-school keywords to exclude
    non_schools = [
        'university', 'universidade', 'faculdade', 'faculty',
        'training center', 'centro de formação', 'curso',
        'language school', 'english', 'idioma', 'línguas',
        'gym', 'fitness', 'yoga', 'dance studio',
        'library', 'biblioteca',
        'campus', 'faculdade',
        'kindergarten', 'creche', 'pré-escolar',
    ]
    
    # Check non-school keywords
    for kw in non_schools:
        if kw in name or kw in address:
            return False
    
    # Should have school-like types
    good_types = ['school', 'primary_school', 'secondary_school', 'education']
    has_good_type = any(any(gt in t.lower() for gt in good_types) for t in types)
    
    # If no good types, check if name contains "escola" or "school"
    has_good_name = 'escola' in name or 'school' in name or 'agrupamento' in name
    
    return has_good_type or has_good_name

# Filter results
print("\n🔍 Filtering results...")

filtered_primary = {}
for pid, place in primary_places.items():
    if is_actual_school(place):
        filtered_primary[pid] = {
            "type": "Feature",
            "geometry": place['geometry'],
            "properties": {
                "name": place['properties']['name'],
                "address": place['properties']['address'],
                "school_type": "primary",
                "rating": place['properties'].get('rating'),
                "sources": ["google_places_api"],
                "confidence": "high"
            }
        }

filtered_secondary = {}
for sid, place in secondary_places.items():
    if is_actual_school(place):
        filtered_secondary[sid] = {
            "type": "Feature",
            "geometry": place['geometry'],
            "properties": {
                "name": place['properties']['name'],
                "address": place['properties']['address'],
                "school_type": "secondary",
                "rating": place['properties'].get('rating'),
                "sources": ["google_places_api"],
                "confidence": "high"
            }
        }

print(f"   Primary schools (after filtering): {len(filtered_primary)}")
print(f"   Secondary schools (after filtering): {len(filtered_secondary)}")

# Deduplicate by coordinates
def deduplicate_schools(schools_dict, radius_km=0.15):
    """Remove schools within radius_km of each other."""
    dedup = {}
    removed = 0
    
    for sid, school in schools_dict.items():
        coords = school.get('geometry', {}).get('coordinates', [])
        if not coords or len(coords) < 2:
            continue
        
        lng, lat = coords[0], coords[1]
        
        is_dup = False
        for existing_id, existing in dedup.items():
            ex_coords = existing.get('geometry', {}).get('coordinates', [])
            if ex_coords and len(ex_coords) >= 2:
                dist = haversine_distance(lat, lng, ex_coords[1], ex_coords[0])
                if dist < radius_km:
                    is_dup = True
                    removed += 1
                    break
        
        if not is_dup:
            dedup[sid] = school
    
    return dedup, removed

primary_dedup, primary_removed = deduplicate_schools(filtered_primary, radius_km=0.15)
secondary_dedup, secondary_removed = deduplicate_schools(filtered_secondary, radius_km=0.15)

print(f"\n🔄 Deduplication:")
print(f"   Primary: removed {primary_removed} duplicates → {len(primary_dedup)} final")
print(f"   Secondary: removed {secondary_removed} duplicates → {len(secondary_dedup)} final")

# Create output
primary_output = {
    "type": "FeatureCollection",
    "features": sorted(list(primary_dedup.values()), key=lambda x: x['properties']['name']),
    "metadata": {
        "description": "Primary schools in Lisbon Metropolitan Area",
        "source": "Google Places API",
        "queries": primary_queries,
        "count": len(primary_dedup),
        "generated": "2026-01-20",
        "quality": "high",
        "method": "Direct API search for 'escola basica'"
    }
}

secondary_output = {
    "type": "FeatureCollection",
    "features": sorted(list(secondary_dedup.values()), key=lambda x: x['properties']['name']),
    "metadata": {
        "description": "Secondary schools in Lisbon Metropolitan Area",
        "source": "Google Places API",
        "queries": secondary_queries,
        "count": len(secondary_dedup),
        "generated": "2026-01-20",
        "quality": "high",
        "method": "Direct API search for 'escola secundaria'"
    }
}

# Save
assets_dir = os.path.join('../../', 'src', 'assets')
os.makedirs(assets_dir, exist_ok=True)

primary_path = os.path.join(assets_dir, 'primary_school.json')
secondary_path = os.path.join(assets_dir, 'secondary_school.json')

with open(primary_path, 'w', encoding='utf-8') as f:
    json.dump(primary_output, f, indent=2, ensure_ascii=False)

with open(secondary_path, 'w', encoding='utf-8') as f:
    json.dump(secondary_output, f, indent=2, ensure_ascii=False)

print("\n" + "=" * 70)
print("✅ DATASETS GENERATED SUCCESSFULLY!")
print("=" * 70)
print(f"Primary Schools: {len(primary_dedup)} schools")
print(f"Secondary Schools: {len(secondary_dedup)} schools")
print(f"Total: {len(primary_dedup) + len(secondary_dedup)} schools")
print("=" * 70)

# Show sample schools
if primary_dedup:
    print("\n📍 Sample Primary Schools:")
    for i, school in enumerate(list(primary_dedup.values())[:3]):
        print(f"   - {school['properties']['name']}")

if secondary_dedup:
    print("\n📍 Sample Secondary Schools:")
    for i, school in enumerate(list(secondary_dedup.values())[:3]):
        print(f"   - {school['properties']['name']}")
