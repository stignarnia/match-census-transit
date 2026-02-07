#!/usr/bin/env python3
"""
Comprehensive Primary Schools Dataset Generator

Uses very broad criteria to catch all primary schools from Google Places.
Primary schools are more diverse in naming conventions than secondary schools.

Strategy:
- Include all "escola básica", "agrupamento", etc.
- Include schools without explicit level if they look like primary
- Only exclude obvious non-primary (universities, secondary-specific terms)
"""

import json
import os
import math

print("🏫 Comprehensive Primary Schools Generator")
print("=" * 70)

import argparse

# Load original Google Places data
ap = argparse.ArgumentParser(description="Generate primary schools from Google Places dump")
ap.add_argument("--input", "-i", dest="input_path", default='./secondary_school_google_places.json', help="Path to Google Places JSON (default: current directory)")
args = ap.parse_args()
google_json_path = args.input_path

if not os.path.exists(google_json_path):
    print(f"❌ Error: {google_json_path} not found")
    exit(1)

try:
    with open(google_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    features = data.get('features', [])
    print(f"📖 Loaded {len(features)} features from Google Places\n")
    
except Exception as e:
    print(f"❌ Error loading data: {e}")
    exit(1)

# PRIMARY school indicators - VERY BROAD
primary_indicators = [
    # Portuguese - Basic education
    'básica', 'basica', 'básico', 'basico',
    'eb ', 'eb1', 'eb2', 'eb 1', 'eb 2',
    '1º ciclo', '1 ciclo', 'primeiro ciclo',
    '2º ciclo', '2 ciclo', 'segundo ciclo',
    '1ºciclo', '1ciclo', '2ºciclo', '2ciclo',
    # General primary names
    'agrupamento', 'agrupamento de escolas',
    'escola de', 'escola ',
    'grupo escolar',
    # English
    'primary', 'elementary', 'basic',
    'grade school',
]

# SECONDARY-ONLY indicators - if present, exclude from primary
secondary_only = [
    'secundária', 'secundaria', 'secundário', 'secundario',
    '3º ciclo', '3 ciclo', 'terceiro ciclo',
    '3ºciclo', '3ciclo',
    'high school', 'gymnasium', 'lycée', 'ensino médio',
    'es ', 'e.s.', 'e.s ',
    # Specific grade indicators for secondary
    '10º', '11º', '12º', '10 ano', '11 ano', '12 ano',
    '10ºano', '11ºano', '12ºano',
]

# STRICT exclusions - non-schools
strict_exclude = [
    'university', 'universidade', 'faculdade', 'instituto de ensino',
    'language school', 'idioma',
    'dance', 'música', 'music school',
    'academy', 'academia',
    'gym', 'fitness', 'yoga', 'desportivo',
    'library', 'biblioteca', 'cultural center',
    'daycare', 'creche', 'infantário', 'pré-escolar', 'ama',
    'driving school', 'autoescola',
    'training center', 'centro de formação',
    'coaching', 'tutoring', 'explicações',
    'empresa', 'lda', 'ltd', 'ltda',
    'commercial', 'shopping',
    'hospital', 'clínica',
    'church', 'igreja',
    'sports', 'futebol', 'clube desportivo',
]

def haversine_distance(lat1, lng1, lat2, lng2):
    """Calculate distance in km."""
    R = 6371
    dLat = math.radians(lat2 - lat1)
    dLng = math.radians(lng2 - lng1)
    a = math.sin(dLat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLng/2)**2
    c = 2 * math.asin(math.sqrt(a))
    return R * c

# Process features
primary_schools = {}
excluded = 0
secondary_only_excluded = 0

for feature in features:
    props = feature.get('properties', {})
    name = props.get('name', '').lower()
    address = props.get('address', '').lower()
    full_text = name + ' ' + address
    coords = feature.get('geometry', {}).get('coordinates', [])
    
    # Basic validation
    if not coords or len(coords) < 2:
        excluded += 1
        continue
    
    # Check strict exclusions first
    if any(kw in full_text for kw in strict_exclude):
        excluded += 1
        continue
    
    # Check if it's secondary-only (exclude from primary)
    if any(kw in full_text for kw in secondary_only):
        secondary_only_excluded += 1
        continue
    
    # Must have school indicator
    if not ('school' in name or 'escola' in name or 'escol' in address):
        excluded += 1
        continue
    
    # Check for primary indicators
    has_primary = any(kw in full_text for kw in primary_indicators)
    
    if not has_primary:
        # Secondary fallback: if it's a school but not explicitly secondary and not explicitly primary,
        # it might be a primary school. Check for grade indicators
        has_lower_grades = any(f'{i}º' in full_text or f'{i} ano' in full_text for i in range(1, 7))
        if not has_lower_grades:
            excluded += 1
            continue
    
    # Found a primary school!
    feature_id = f"google_{hash(name + address) % 10**8}"
    
    processed_feature = {
        "type": "Feature",
        "geometry": feature.get('geometry'),
        "properties": {
            "name": props.get('name', 'Unknown'),
            "address": props.get('address', ''),
            "school_type": "primary",
            "sources": ["google"],
            "confidence": "medium"
        }
    }
    
    primary_schools[feature_id] = processed_feature

print(f"📊 Processing Results:")
print(f"   Strict exclusions: {excluded}")
print(f"   Secondary-only excluded: {secondary_only_excluded}")
print(f"   Primary schools found: {len(primary_schools)}")

# Deduplicate by coordinates
def haversine_distance(lat1, lng1, lat2, lng2):
    import math
    R = 6371
    dLat = math.radians(lat2 - lat1)
    dLng = math.radians(lng2 - lng1)
    a = math.sin(dLat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLng/2)**2
    c = 2 * math.asin(math.sqrt(a))
    return R * c

dedup_schools = {}
duplicates = 0

for feature_id, feature in primary_schools.items():
    coords = feature.get('geometry', {}).get('coordinates', [])
    
    if not coords or len(coords) < 2:
        continue
    
    lng, lat = coords[0], coords[1]
    name = feature['properties'].get('name', '').lower()
    
    is_duplicate = False
    for existing_id, existing_feature in dedup_schools.items():
        existing_coords = existing_feature.get('geometry', {}).get('coordinates', [])
        
        if existing_coords and len(existing_coords) >= 2:
            dist = haversine_distance(lat, lng, existing_coords[1], existing_coords[0])
            
            if dist < 0.05:  # 50 meters - almost certainly duplicate
                is_duplicate = True
                duplicates += 1
                break
            elif dist < 0.15:  # 150 meters
                existing_name = existing_feature['properties'].get('name', '').lower()
                # Same name = duplicate
                if name == existing_name:
                    is_duplicate = True
                    duplicates += 1
                    break
    
    if not is_duplicate:
        dedup_schools[feature_id] = feature

print(f"   After deduplication: {len(dedup_schools)} (removed {duplicates} duplicates)")

# Create output
output = {
    "type": "FeatureCollection",
    "features": list(dedup_schools.values()),
    "metadata": {
        "description": "Primary schools in Lisbon Metropolitan Area",
        "source": "Google Places (comprehensive filtering)",
        "count": len(dedup_schools),
        "generated": "2026-01-19"
    }
}

# Save
output_path = '../src/assets/primary_school.json'
os.makedirs(os.path.dirname(output_path), exist_ok=True)

with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print(f"\n✅ SUCCESS!")
print(f"   Primary schools: {len(dedup_schools)}")
print(f"   Saved to: {output_path}")
print("=" * 70)
