#!/usr/bin/env python3
"""
Validates and merges school datasets from multiple sources.

Performs:
1. Deduplication using coordinate-based matching
2. Confidence scoring
3. Quality filtering
4. Metadata enrichment

Output: Clean, deduplicated school datasets with source provenance.
"""

import json
import math
from typing import Dict, List, Tuple
from datetime import datetime

# ==============================================================================
# DEDUPLICATION & MATCHING
# ==============================================================================

def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate distance between two coordinates in kilometers."""
    R = 6371  # Earth radius in km
    dLat = math.radians(lat2 - lat1)
    dLng = math.radians(lng2 - lng1)
    a = math.sin(dLat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLng/2)**2
    c = 2 * math.asin(math.sqrt(a))
    return R * c

def merge_school_datasets(primary_file: str, secondary_file: str, 
                         match_radius_km: float = 0.15) -> Tuple[Dict, Dict]:
    """
    Load school datasets and merge them with deduplication.
    
    Args:
        primary_file: Path to primary schools GeoJSON
        secondary_file: Path to secondary schools GeoJSON
        match_radius_km: Distance threshold for considering schools as duplicates
    """
    
    print("🔍 Validating and merging school datasets...")
    print(f"   Match radius: {match_radius_km} km")
    
    # Load datasets
    with open(primary_file, 'r', encoding='utf-8') as f:
        primary_data = json.load(f)
    
    with open(secondary_file, 'r', encoding='utf-8') as f:
        secondary_data = json.load(f)
    
    primary_features = primary_data.get('features', [])
    secondary_features = secondary_data.get('features', [])
    
    print(f"\n📊 Before deduplication:")
    print(f"   Primary: {len(primary_features)} schools")
    print(f"   Secondary: {len(secondary_features)} schools")
    print(f"   Total: {len(primary_features) + len(secondary_features)}")
    
    # Deduplicate within primary
    primary_dedup = deduplicate_schools(primary_features, match_radius_km)
    
    # Deduplicate within secondary
    secondary_dedup = deduplicate_schools(secondary_features, match_radius_km)
    
    # Remove cross-category duplicates (e.g., same building classified as both)
    primary_final, secondary_final = remove_cross_category_duplicates(
        primary_dedup, secondary_dedup, match_radius_km
    )
    
    print(f"\n✅ After deduplication:")
    print(f"   Primary: {len(primary_final)} schools")
    print(f"   Secondary: {len(secondary_final)} schools")
    print(f"   Total: {len(primary_final) + len(secondary_final)}")
    
    return primary_final, secondary_final

def deduplicate_schools(features: List[dict], match_radius_km: float) -> List[dict]:
    """Remove duplicate schools within a single dataset."""
    
    unique = {}
    
    for feature in features:
        props = feature.get('properties', {})
        coords = feature.get('geometry', {}).get('coordinates', [])
        
        if not coords or len(coords) < 2:
            continue
        
        lng, lat = coords[0], coords[1]
        name = props.get('name', '').strip()
        
        # Check if this is a duplicate of an existing school
        is_duplicate = False
        for existing_id, existing_feature in unique.items():
            existing_coords = existing_feature.get('geometry', {}).get('coordinates', [])
            existing_name = existing_feature['properties'].get('name', '').strip()
            
            if existing_coords and len(existing_coords) >= 2:
                dist = haversine_distance(lat, lng, existing_coords[1], existing_coords[0])
                
                # Consider duplicates if:
                # 1. Very close (< 100m) and similar names
                # 2. Extremely close (< 50m) regardless of name
                if dist < 0.05:  # 50 meters
                    is_duplicate = True
                    # Prefer OSM sources
                    if 'osm' in existing_feature['properties'].get('sources', []):
                        break
                    unique[existing_id] = feature
                    break
                elif dist < 0.15 and name.lower() == existing_name.lower():
                    is_duplicate = True
                    if 'osm' in existing_feature['properties'].get('sources', []):
                        break
                    unique[existing_id] = feature
                    break
        
        if not is_duplicate:
            unique_id = f"{name}_{lat}_{lng}"
            unique[unique_id] = feature
    
    return list(unique.values())

def remove_cross_category_duplicates(primary: List[dict], secondary: List[dict], 
                                     match_radius_km: float) -> Tuple[List[dict], List[dict]]:
    """
    Some buildings might be classified as both primary and secondary.
    Resolve by keeping secondary if ambiguous (larger schools tend to serve both).
    """
    
    primary_ids_to_remove = set()
    
    for i, prim_feature in enumerate(primary):
        prim_coords = prim_feature.get('geometry', {}).get('coordinates', [])
        prim_name = prim_feature['properties'].get('name', '').lower()
        
        if not prim_coords or len(prim_coords) < 2:
            continue
        
        for sec_feature in secondary:
            sec_coords = sec_feature.get('geometry', {}).get('coordinates', [])
            sec_name = sec_feature['properties'].get('name', '').lower()
            
            if not sec_coords or len(sec_coords) < 2:
                continue
            
            dist = haversine_distance(
                prim_coords[1], prim_coords[0],
                sec_coords[1], sec_coords[0]
            )
            
            # Very close + exact name match = likely same school
            if dist < 0.1 and prim_name == sec_name:
                primary_ids_to_remove.add(i)
                break
    
    primary_filtered = [f for i, f in enumerate(primary) if i not in primary_ids_to_remove]
    
    return primary_filtered, secondary

# ==============================================================================
# ENRICHMENT & VALIDATION
# ==============================================================================

def validate_and_enrich(features: List[dict]) -> List[dict]:
    """
    Validate school features and add metadata.
    """
    
    validated = []
    skipped = 0
    
    for feature in features:
        try:
            coords = feature.get('geometry', {}).get('coordinates', [])
            props = feature.get('properties', {})
            
            # Basic validation
            if not coords or len(coords) < 2:
                skipped += 1
                continue
            
            # Validate coordinates are in reasonable bounds (Lisbon area)
            lat, lng = coords[1], coords[0]
            if not (38.5 < lat < 39.0 and -9.5 < lng < -8.5):
                skipped += 1
                continue
            
            # Clean name
            props['name'] = props.get('name', 'Unknown').strip()
            if not props['name'] or len(props['name']) < 2:
                skipped += 1
                continue
            
            # Ensure required fields
            if 'sources' not in props:
                props['sources'] = []
            if 'confidence' not in props:
                props['confidence'] = 'medium'
            
            # Add metadata
            props['last_updated'] = datetime.now().isoformat()
            
            validated.append(feature)
            
        except Exception as e:
            print(f"⚠️  Validation error for feature: {e}")
            skipped += 1
    
    if skipped > 0:
        print(f"   Skipped {skipped} invalid features")
    
    return validated

# ==============================================================================
# MAIN EXECUTION
# ==============================================================================

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Validate and merge primary/secondary school GeoJSON files")
    ap.add_argument("--primary", "-p", dest="primary_file", default='./primary_school.json', help="Path to primary schools GeoJSON (default: current directory)")
    ap.add_argument("--secondary", "-s", dest="secondary_file", default='./secondary_school.json', help="Path to secondary schools GeoJSON (default: current directory)")
    ap.add_argument("--match-radius-km", dest="match_radius_km", type=float, default=0.15, help="Match radius in km for deduplication")
    args = ap.parse_args()

    try:
        # Merge and deduplicate
        primary, secondary = merge_school_datasets(
            args.primary_file,
            args.secondary_file,
            match_radius_km=args.match_radius_km
        )
        
        # Validate and enrich
        print("\n🔧 Validating and enriching datasets...")
        primary = validate_and_enrich(primary)
        secondary = validate_and_enrich(secondary)
        
        # Save deduplicated datasets
        primary_output = {
            "type": "FeatureCollection",
            "features": primary,
            "metadata": {
                "description": "Primary schools in Lisbon Metropolitan Area",
                "sources": ["osm", "google"],
                "count": len(primary),
                "generated": datetime.now().isoformat()
            }
        }
        
        secondary_output = {
            "type": "FeatureCollection",
            "features": secondary,
            "metadata": {
                "description": "Secondary schools in Lisbon Metropolitan Area",
                "sources": ["osm", "google"],
                "count": len(secondary),
                "generated": datetime.now().isoformat()
            }
        }
        
        with open(args.primary_file, 'w', encoding='utf-8') as f:
            json.dump(primary_output, f, indent=2, ensure_ascii=False)
        
        with open(args.secondary_file, 'w', encoding='utf-8') as f:
            json.dump(secondary_output, f, indent=2, ensure_ascii=False)
        
        print("\n" + "=" * 60)
        print("✅ VALIDATION COMPLETE")
        print(f"   Primary schools:   {len(primary)} (deduplicated & validated)")
        print(f"   Secondary schools: {len(secondary)} (deduplicated & validated)")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
