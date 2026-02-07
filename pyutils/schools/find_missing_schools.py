#!/usr/bin/env python3
"""
Targeted Missing Schools Hunter

Uses multiple search strategies to find schools that might be missed:
1. Numbered schools (EB No. 2, EB 2, etc.)
2. Neighborhood-specific queries for known school areas
3. Alternative naming patterns
4. Direct address searches for known schools

This script is specifically designed to catch schools like "Escola Básica No. 2 de Camarate"
"""

import os
import json
import requests
import math
import time
from typing import Dict
from dotenv import load_dotenv

load_dotenv('../../.env')
API_KEY = os.environ['VITE_GOOGLE_MAPS_API_KEY']

print("🎯 Targeted Missing Schools Hunter")
print("=" * 80)

def haversine_distance(lat1, lng1, lat2, lng2):
    """Calculate distance in km."""
    R = 6371
    dLat = math.radians(lat2 - lat1)
    dLng = math.radians(lng2 - lng1)
    a = math.sin(dLat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLng/2)**2
    c = 2 * math.asin(math.sqrt(a))
    return R * c

def text_search(query: str) -> Dict:
    """Search using Google Places Text Search API."""
    unique_places = {}
    
    headers = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.types,places.rating,places.businessStatus'
    }
    
    payload = {
        "textQuery": query,
        "maxResultCount": 20,
        "languageCode": "pt"
    }
    
    try:
        response = requests.post(
            'https://places.googleapis.com/v1/places:searchText',
            headers=headers,
            json=payload,
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
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
                                "rating": place.get("rating", None)
                            }
                        }
        return unique_places
    except Exception as e:
        return {}

def is_actual_school(place: dict) -> bool:
    """Filter for actual schools."""
    name = place['properties']['name'].lower()
    address = place['properties']['address'].lower()
    types = [t.lower() for t in place['properties'].get('types', [])]
    
    # Strong exclusion keywords
    exclusions = [
        'universidade', 'university', 'faculdade', 'faculty',
        'driving school', 'auto escola', 'condução',
        'music school', 'música', 'conservatório',
        'dance', 'dança', 'ballet',
        'language', 'línguas', 'idiomas',
        'cooking', 'culinária',
        'swimming', 'natação', 'piscina',
        'gym', 'ginásio', 'fitness', 'crossfit',
        'creche only', 'daycare',
        'training center', 'centro de formação',
        'professional training', 'formação profissional',
        'diving', 'mergulho', 'dive school',
        'surfing', 'surf',
        'karate', 'martial arts', 'artes marciais',
        'yoga', 'pilates',
        'sports club', 'clube desportivo',
        'swimming pool', 'piscina publica',
        'tennis', 'golf',
        'football', 'soccer',
        'basketball',
        'club', 'clube',
        'institute of technical education'
    ]
    
    for kw in exclusions:
        if kw in name or kw in address:
            return False
    
    # Strong inclusion keywords
    inclusions = [
        'escola básica', 'escola basica', 'eb ', 'eb1', 'eb2', 'eb3',
        'escola secundária', 'escola secundaria',
        'agrupamento de escolas', 'agrupamento',
        'colégio', 'liceu',
        'escola primária', 'escola primaria',
        'esc. básica', 'esc. basica',
        'esc. secundária', 'esc. secundaria',
        'escola municipal', 'escola estadual'
    ]
    
    for kw in inclusions:
        if kw in name.lower():
            return True
    
    # Check types
    school_types = ['school', 'primary_school', 'secondary_school']
    if any(st in types for st in school_types):
        # But double-check it's not clearly not a school
        if not any(excl in name for excl in ['diving', 'swim', 'sports', 'gym', 'fitness', 'yoga', 'pilates']):
            return True
    
    return False

def determine_school_type(place: dict) -> str:
    """Determine primary vs secondary."""
    name = place['properties']['name'].lower()
    
    primary_indicators = ['básica', 'basica', 'primária', 'primaria', 'eb1', 'eb 1', 'eb ', '1º ciclo', 'primary']
    secondary_indicators = ['secundária', 'secundaria', 'liceu', 'secondary']
    
    primary_score = sum(1 for ind in primary_indicators if ind in name)
    secondary_score = sum(1 for ind in secondary_indicators if ind in name)
    
    if secondary_score > primary_score:
        return 'secondary'
    return 'primary'

# Load existing schools to avoid duplicates
print("\n📂 Loading existing school datasets...")
existing_coords = set()

primary_path = os.path.join('../../', 'src', 'assets', 'primary_school.json')
secondary_path = os.path.join('../../', 'src', 'assets', 'secondary_school.json')

for path in [primary_path, secondary_path]:
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            for feature in data.get('features', []):
                coords = feature['geometry']['coordinates']
                # Round to 4 decimals (roughly 11m precision) for matching
                key = (round(coords[1], 4), round(coords[0], 4))
                existing_coords.add(key)

print(f"   Loaded {len(existing_coords)} existing school locations")

# Define search queries for missing schools
# Focus on numbered schools and neighborhood-specific searches
queries = []

# 1. Numbered schools (EB 1, 2, 3, etc.)
for i in range(1, 6):
    queries.append(f"Escola Básica No. {i} Portugal")
    queries.append(f"EB No. {i} Portugal")
    queries.append(f"EB{i} Portugal")
    queries.append(f"Escola Básica {i} Portugal")

# 2. Neighborhood-specific searches (known to have schools)
neighborhoods = [
    'Camarate', 'Olivais', 'Marvila', 'Parque das Nações',
    'Belém', 'Alcântara', 'Alvalade', 'Lumiar',
    'Santa Apolónia', 'São Jorge', 'Penha de França',
    'Esteves', 'Xabregas', 'Calvário',
    'Branqueira', 'Encarnação', 'Sobreda',
    'Telhal', 'Cacém', 'Agualva',
    'Caparica', 'Tejo', 'Sesimbra'
]

for neighborhood in neighborhoods:
    queries.append(f"Escola Básica {neighborhood} Portugal")
    queries.append(f"Agrupamento {neighborhood} Portugal")
    queries.append(f"Colégio {neighborhood} Portugal")

# 3. Alternative naming patterns
patterns = [
    "Escola Primária",
    "Escola Municipal", 
    "Escola Pública",
    "Escola da Carreira",
    "Escola Rural"
]

for pattern in patterns:
    queries.append(f"{pattern} Portugal")

# 4. Common school names (that might be missed)
specific_schools = [
    "Escola Básica No. 2 Camarate",
    "Escola Artística António Arroio",
    "Escola D. Afonso Henriques",
    "Escola do Bairro da Encarnação",
    "Colégio da Carrasqueira"
]

for school in specific_schools:
    queries.append(school)

# Remove duplicates
queries = list(set(queries))

print(f"\n🔍 Running {len(queries)} targeted searches...")
print("-" * 80)

all_found = {}
search_count = 0

for i, query in enumerate(queries, 1):
    results = text_search(query)
    all_found.update(results)
    search_count += 1
    
    if i % 10 == 0:
        print(f"   Progress: {i}/{len(queries)} | Unique schools found: {len(all_found)}")
    
    time.sleep(0.5)  # Rate limiting

print(f"\n✅ Found {len(all_found)} total places from targeted searches")

# Filter for actual schools
print("\n🔍 Filtering results...")
valid_schools = {}
for place_id, place in all_found.items():
    if is_actual_school(place):
        valid_schools[place_id] = place

print(f"   Valid schools: {len(valid_schools)}")

# Find new schools not in existing dataset
print("\n🆕 Identifying new schools...")
new_schools = {}
for place_id, place in valid_schools.items():
    coords = place['geometry']['coordinates']
    key = (round(coords[1], 4), round(coords[0], 4))
    
    if key not in existing_coords:
        new_schools[place_id] = place

print(f"   New schools found: {len(new_schools)}")

if new_schools:
    print(f"\n📍 Sample of new schools found:")
    for i, place in enumerate(list(new_schools.values())[:20], 1):
        school_type = determine_school_type(place)
        print(f"   {i}. {place['properties']['name']} ({school_type})")
        print(f"      📍 {place['properties']['address']}")

# Merge with existing datasets
print("\n🔄 Merging with existing datasets...")

primary_path = os.path.join('../../', 'src', 'assets', 'primary_school.json')
secondary_path = os.path.join('../../', 'src', 'assets', 'secondary_school.json')

with open(primary_path, 'r', encoding='utf-8') as f:
    primary_data = json.load(f)
    all_primary = {f"{f['geometry']['coordinates'][1]:.4f},{f['geometry']['coordinates'][0]:.4f}": f for f in primary_data.get('features', [])}

with open(secondary_path, 'r', encoding='utf-8') as f:
    secondary_data = json.load(f)
    all_secondary = {f"{f['geometry']['coordinates'][1]:.4f},{f['geometry']['coordinates'][0]:.4f}": f for f in secondary_data.get('features', [])}

# Add new schools
primary_added = 0
secondary_added = 0

for place_id, place in new_schools.items():
    school_type = determine_school_type(place)
    coords = place['geometry']['coordinates']
    key = f"{coords[1]:.4f},{coords[0]:.4f}"
    
    if school_type == 'primary':
        if key not in all_primary:
            all_primary[key] = place
            primary_added += 1
    else:
        if key not in all_secondary:
            all_secondary[key] = place
            secondary_added += 1

print(f"   Added {primary_added} new primary schools")
print(f"   Added {secondary_added} new secondary schools")

# Save updated datasets
print("\n💾 Saving updated datasets...")

primary_output = {
    "type": "FeatureCollection",
    "features": sorted(list(all_primary.values()), key=lambda x: x['properties']['name']),
    "metadata": {
        "description": "Primary schools in Lisbon Metropolitan Area",
        "source": "Google Places API - Geographic + Targeted Search",
        "count": len(all_primary),
        "generated": "2026-01-20",
        "method": "Comprehensive geographic search + targeted numbered/neighborhood searches"
    }
}

secondary_output = {
    "type": "FeatureCollection",
    "features": sorted(list(all_secondary.values()), key=lambda x: x['properties']['name']),
    "metadata": {
        "description": "Secondary schools in Lisbon Metropolitan Area",
        "source": "Google Places API - Geographic + Targeted Search",
        "count": len(all_secondary),
        "generated": "2026-01-20",
        "method": "Comprehensive geographic search + targeted numbered/neighborhood searches"
    }
}

assets_dir = os.path.join('../../', 'src', 'assets')
os.makedirs(assets_dir, exist_ok=True)

with open(os.path.join(assets_dir, 'primary_school.json'), 'w', encoding='utf-8') as f:
    json.dump(primary_output, f, indent=2, ensure_ascii=False)

with open(os.path.join(assets_dir, 'secondary_school.json'), 'w', encoding='utf-8') as f:
    json.dump(secondary_output, f, indent=2, ensure_ascii=False)

print("\n" + "=" * 80)
print("✅ TARGETED SEARCH COMPLETE!")
print("=" * 80)
print(f"Total Primary Schools: {len(all_primary)} (+{primary_added} new)")
print(f"Total Secondary Schools: {len(all_secondary)} (+{secondary_added} new)")
print(f"Grand Total: {len(all_primary) + len(all_secondary)} schools")
print("=" * 80)
