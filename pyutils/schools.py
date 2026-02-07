#!/usr/bin/env python3
"""
Unified Portuguese Schools Harvesting Pipeline

Merges all school-discovery scripts into a single file. Each pipeline step
is exposed as a function and orchestrated by main().

Pipeline order:
 1. harvest        – runs ../harvest.py (external) → secondary_school_google_places.json
 2. fetch          – OSM Overpass + Google dump parsing
 3. geographic     – systematic grid Nearby-Search (heavy, 2-3 h)
 4. direct         – text-search queries per municipality
 5. comprehensive  – broad primary-school extraction from Google dump
 6. find_missing   – targeted / numbered-school searches
 7. validate       – final dedup, cross-category cleanup, coord validation

Usage:
  python schools.py [--skip-harvest] [--skip-fetch] [--skip-geographic]
                    [--skip-direct] [--skip-comprehensive]
                    [--skip-find-missing] [--skip-validate]
                    [--dry-run] [--continue-on-error]
                    [--google-input FILE]
"""

import argparse
import hashlib
import json
import math
import os
import requests
import subprocess
import sys
import time
import unicodedata
from datetime import datetime
from typing import Dict, List, Tuple, Set, Any
from dotenv import load_dotenv
from requests.exceptions import RequestException

# ── paths ────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.normpath(os.path.join(BASE_DIR, ".."))
ASSETS_DIR = os.path.join(PROJECT_ROOT, "src", "assets")

load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

API_KEY = os.environ.get("VITE_GOOGLE_MAPS_API_KEY", "")
CENTER_LAT = float(os.environ.get("CENTER_LAT", "38.75"))
CENTER_LNG = float(os.environ.get("CENTER_LNG", "-9.15"))
SEARCH_RADIUS_KM = float(os.environ.get("TOTAL_SQUARE_KM", "50"))

# ── area bounds (Lisbon Metropolitan Area) ───────────────────────────────────
AREA_BOUNDS = {
    "south": 38.40,
    "north": 39.05,
    "west": -9.50,
    "east": -8.65,
}

# coordinate-validation box (derived from AREA_BOUNDS with symmetric padding)
_PAD = 0.05
VALID_LAT = (AREA_BOUNDS["south"] - _PAD, AREA_BOUNDS["north"] + _PAD)
VALID_LNG = (AREA_BOUNDS["west"] - _PAD, AREA_BOUNDS["east"] + _PAD)

# ── output file names ───────────────────────────────────────────────────────
PRIMARY_FILENAME = "primary_school.json"
SECONDARY_FILENAME = "secondary_school.json"
GOOGLE_DUMP_FILENAME = "secondary_school_google_places.json"

# coordinate key precision
COORD_PRECISION = 5

# =============================================================================
#  SHARED UTILITIES
# =============================================================================

def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance in km between two (lat, lng) points."""
    R = 6371
    dLat = math.radians(lat2 - lat1)
    dLng = math.radians(lng2 - lng1)
    a = (math.sin(dLat / 2) ** 2
         + math.cos(math.radians(lat1))
         * math.cos(math.radians(lat2))
         * math.sin(dLng / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))

def stable_id(name: str, address: str, prefix: str = "google") -> str:
    """Deterministic short id based on name+address."""
    n = normalize_text(str(name) or "")
    a = normalize_text(str(address) or "")
    h = hashlib.md5((n + "|" + a).encode("utf-8")).hexdigest()[:8]
    return f"{prefix}_{h}"

def coord_key(lat: float, lng: float, precision: int = COORD_PRECISION) -> str:
    return f"{lat:.{precision}f},{lng:.{precision}f}"

def normalize_text(s: str) -> str:
    """Normalize unicode, lowercase and strip non-alphanumeric for loose comparisons."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower()
    # keep letters and numbers only
    s = "".join(ch for ch in s if ch.isalnum())
    return s

# ── keyword lists ────────────────────────────────────────────────────────────
# Merged & de-duplicated from all original scripts.

EXCLUDE_KEYWORDS: List[str] = [
    # universities / higher education
    "university", "universidade", "faculdade", "faculty", "campus",
    "instituto de ensino",
    # driving
    "driving school", "auto escola", "autoescola", "escola de condução",
    "condução",
    # arts / sports / wellness
    "music school", "escola de música", "música", "conservatório",
    "dance", "dança", "ballet",
    "language school", "línguas", "idiomas", "english", "idioma",
    "cooking", "culinária",
    "swimming", "natação", "piscina", "swimming pool", "piscina publica",
    "gym", "ginásio", "fitness", "crossfit", "yoga", "pilates",
    "karate", "martial arts", "artes marciais",
    "diving", "mergulho", "dive school",
    "surfing", "surf",
    "tennis", "golf", "football", "soccer", "basketball",
    "sports club", "clube desportivo", "desportivo", "futebol",
    "club", "clube",
    # childcare-only
    "daycare", "creche", "infantário", "pré-escolar", "jardim de infância",
    "ama",
    # professional training
    "training center", "centro de formação",
    "professional training", "formação profissional",
    "curso", "coaching", "tutoring", "explicações",
    # commercial / other
    "library", "biblioteca", "cultural center", "cultural",
    "art", "museum",
    "empresa", "lda", "ltd", "ltda", "ltd.",
    "commercial", "shopping",
    "hospital", "clínica",
    "church", "igreja",
    "fme solutions", "solutions",
    "institute of technical education",
    "preschool",
    "lar",
    "academy", "academia",
]

PRIMARY_INDICATORS: List[str] = [
    "básica", "basica", "básico", "basico",
    "eb ", "eb1", "eb2", "eb 1", "eb 2",
    "1º ciclo", "1 ciclo", "primeiro ciclo",
    "2º ciclo", "2 ciclo", "segundo ciclo",
    "1ºciclo", "1ciclo", "2ºciclo", "2ciclo",
    "agrupamento", "agrupamento de escolas",
    "escola de", "escola ",
    "grupo escolar",
    "primary", "elementary", "basic", "grade school",
    "primária", "primaria",
    "esc. básica", "esc. basica",
]

SECONDARY_INDICATORS: List[str] = [
    "secundária", "secundaria", "secundário", "secundario",
    "3º ciclo", "3 ciclo", "terceiro ciclo",
    "3ºciclo", "3ciclo",
    "high school", "gymnasium", "lycée", "ensino médio",
    "liceu",
    "es ", "e.s.", "e.s ",
    "10º", "11º", "12º", "10 ano", "11 ano", "12 ano",
    "10ºano", "11ºano", "12ºano",
    "esc. secundária", "esc. secundaria",
]

SCHOOL_INCLUSION_KEYWORDS: List[str] = [
    "escola básica", "escola basica", "eb ", "eb1", "eb2", "eb3",
    "escola secundária", "escola secundaria",
    "agrupamento de escolas", "agrupamento",
    "colégio", "liceu",
    "escola primária", "escola primaria",
    "esc. básica", "esc. basica",
    "esc. secundária", "esc. secundaria",
    "escola municipal", "escola estadual",
]

def is_actual_school(place: dict) -> bool:
    """Return True if the place looks like a real primary/secondary school."""
    props = place.get("properties", {}) or {}
    name = str(props.get("name", "") or "")
    address = str(props.get("address", "") or "")
    name_l = name.lower()
    address_l = address.lower()
    types = [t.lower() for t in props.get("types", []) if isinstance(t, str)]
    full_text = name_l + " " + address_l

    # hard exclusions
    for kw in EXCLUDE_KEYWORDS:
        if kw in full_text:
            return False

    # strong inclusion by name
    for kw in SCHOOL_INCLUSION_KEYWORDS:
        if kw in name_l:
            return True

    # inclusion by Google type
    good_types = {"school", "primary_school", "secondary_school", "education"}
    if good_types & set(types):
        return True

    # fallback: name contains generic "escola" / "school"
    if "escola" in name_l or "school" in name_l:
        return True

    return False

def determine_school_type(place: dict) -> str:
    """Classify a place as 'primary' or 'secondary'."""
    props = place.get("properties", {}) or {}
    name = str(props.get("name", "") or "").lower()
    types = [t.lower() for t in (props.get("types") or []) if isinstance(t, str)]
    primary_type = str(props.get("primary_type", "") or "").lower()

    primary_score = sum(1 for ind in PRIMARY_INDICATORS if ind in name)
    secondary_score = sum(1 for ind in SECONDARY_INDICATORS if ind in name)

    if "primary_school" in types or "primary_school" in primary_type:
        primary_score += 2
    if "secondary_school" in types or "secondary_school" in primary_type:
        secondary_score += 2

    # EB 2,3 → primary
    if any(tok in name for tok in ("eb 2", "eb2", "eb 3", "eb3")):
        primary_score += 2

    return "secondary" if secondary_score > primary_score else "primary"

# ── deduplication ────────────────────────────────────────────────────────────

def deduplicate_by_proximity(
    schools: Dict[str, dict],
    radius_km: float = 0.15,
    prefer_source: str = "osm",
) -> Dict[str, dict]:
    """
    Remove duplicates within *radius_km*.
    When two schools collide, keep the one whose ``sources`` list contains
    *prefer_source*; otherwise keep the first encountered.
    """
    deduped: Dict[str, dict] = {}
    removed = 0

    def _normalize_sources(s: Any) -> Set[str]:
        if not s:
            return set()
        if isinstance(s, str):
            return {s}
        try:
            return set(str(x) for x in s)
        except Exception:
            return set()

    for key, school in schools.items():
        coords = school.get("geometry", {}).get("coordinates", [])
        if not coords or len(coords) < 2:
            continue
        lng, lat = coords[0], coords[1]
        name = (school.get("properties", {}).get("name", "") or "").lower()

        is_dup = False
        for ex_key, existing in list(deduped.items()):
            ex_coords = existing.get("geometry", {}).get("coordinates", [])
            if not ex_coords or len(ex_coords) < 2:
                continue
            dist = haversine_distance(lat, lng, ex_coords[1], ex_coords[0])

            existing_sources = _normalize_sources(existing.get("properties", {}).get("sources"))
            current_sources = _normalize_sources(school.get("properties", {}).get("sources"))

            # very close -> almost certainly same place
            if dist < 0.05:
                is_dup = True
                removed += 1
                # prefer current if it contains prefer_source and existing does not
                if prefer_source in current_sources and prefer_source not in existing_sources:
                    deduped[ex_key] = school
                # else keep existing
                break
            # within radius: prefer identical names or preferred source
            elif dist < radius_km:
                ex_name = (existing.get("properties", {}).get("name", "") or "").lower()
                if name == ex_name or (prefer_source in current_sources and prefer_source not in existing_sources):
                    is_dup = True
                    removed += 1
                    if prefer_source in current_sources and prefer_source not in existing_sources:
                        deduped[ex_key] = school
                    break

        if not is_dup:
            deduped[key] = school

    if removed:
        print(f"   Removed {removed} duplicates (radius {radius_km} km)")
    return deduped

# ── I/O helpers ──────────────────────────────────────────────────────────────

def _asset_path(filename: str) -> str:
    return os.path.join(ASSETS_DIR, filename)

def load_school_dataset(filename: str) -> Dict[str, dict]:
    """Load a GeoJSON school file keyed by ``lat,lng`` string."""
    path = _asset_path(filename)
    schools: Dict[str, dict] = {}
    if not os.path.exists(path):
        return schools
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    for feat in data.get("features", []):
        coords = feat.get("geometry", {}).get("coordinates", [])
        if coords and len(coords) >= 2:
            key = coord_key(coords[1], coords[0])
            schools[key] = feat
    return schools

def save_school_dataset(
    filename: str,
    schools: Dict[str, dict],
    description: str = "",
    method: str = "",
) -> None:
    os.makedirs(ASSETS_DIR, exist_ok=True)
    features = sorted(schools.values(), key=lambda x: x["properties"].get("name", ""))
    output = {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "description": description,
            "count": len(features),
            "generated": datetime.now().isoformat(),
            "method": method,
        },
    }
    with open(_asset_path(filename), "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"   💾 Saved {len(features)} schools → {filename}")

# ── HTTP helpers with retries ─────────────────────────────────────────────────

def _post_with_retries(url: str, max_retries: int = 3, backoff: float = 1.0, **kwargs) -> requests.Response:
    """POST with simple retry/backoff for 429/5xx and network errors."""
    attempt = 0
    while True:
        attempt += 1
        try:
            resp = requests.post(url, **kwargs)
        except RequestException as e:
            print(f"    HTTP request failed (attempt {attempt}): {e}")
            resp = None
        if resp is not None:
            if resp.status_code == 200:
                return resp
            # retry on server errors / rate limits
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < max_retries:
                wait = backoff * (2 ** (attempt - 1))
                print(f"    Received {resp.status_code}; retrying after {wait:.1f}s (attempt {attempt})")
                time.sleep(wait)
                continue
            # no more retries -> return response for caller to inspect
            return resp
        else:
            if attempt >= max_retries:
                print("    Exceeded max retries for HTTP request")
                return None
            wait = backoff * (2 ** (attempt - 1))
            time.sleep(wait)

# ── Google Places helpers ───────────────────────────────────────────────────

def _google_headers() -> dict:
    return {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.location,"
            "places.formattedAddress,places.types,places.rating,"
            "places.businessStatus,places.primaryType"
        ),
    }

def google_nearby_search(
    lat: float, lng: float, radius: int, included_types: List[str]
) -> Dict[str, dict]:
    """Google Places Nearby Search (v1)."""
    if not API_KEY:
        print("   ⚠️  Missing VITE_GOOGLE_MAPS_API_KEY; skipping Google Nearby Search")
        return {}

    payload = {
        "includedTypes": included_types,
        "maxResultCount": 20,
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": radius,
            }
        },
    }
    try:
        resp = _post_with_retries(
            "https://places.googleapis.com/v1/places:searchNearby",
            headers=_google_headers(),
            json=payload,
            timeout=10,
        )
        if resp is None or resp.status_code != 200:
            code = resp.status_code if resp is not None else "no-response"
            text = resp.text if resp is not None else ""
            print(f"    ⚠️  Google Nearby failed: {code} {text[:200]}")
            return {}
        data = resp.json()
    except Exception as e:
        print(f"    ⚠️  Google Nearby exception: {e}")
        return {}

    places: Dict[str, dict] = {}
    for p in data.get("places", []):
        pid = p.get("id")
        if not pid or p.get("businessStatus") == "CLOSED_PERMANENTLY":
            continue
        if pid in places:
            continue
        loc = p.get("location", {})
        places[pid] = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [loc.get("longitude", 0), loc.get("latitude", 0)],
            },
            "properties": {
                "name": p.get("displayName", {}).get("text", "Unknown"),
                "address": p.get("formattedAddress", ""),
                "types": p.get("types", []),
                "primary_type": p.get("primaryType", ""),
                "rating": p.get("rating"),
                "sources": ["google_api"],
            },
        }
    return places

def google_text_search(query: str) -> Dict[str, dict]:
    """Google Places Text Search (v1)."""
    if not API_KEY:
        print("   ⚠️  Missing VITE_GOOGLE_MAPS_API_KEY; skipping Google Text Search")
        return {}

    headers = _google_headers()
    payload = {
        "textQuery": query,
        "maxResultCount": 20,
        "languageCode": "pt",
    }
    try:
        resp = _post_with_retries(
            "https://places.googleapis.com/v1/places:searchText",
            headers=headers,
            json=payload,
            timeout=10,
        )
        if resp is None or resp.status_code != 200:
            code = resp.status_code if resp is not None else "no-response"
            text = resp.text if resp is not None else ""
            print(f"    ⚠️  Google Text Search failed: {code} {text[:200]}")
            return {}
        data = resp.json()
    except Exception as e:
        print(f"    ⚠️  Google Text Search exception: {e}")
        return {}

    places: Dict[str, dict] = {}
    for p in data.get("places", []):
        pid = p.get("id")
        if not pid or p.get("businessStatus") == "CLOSED_PERMANENTLY":
            continue
        if pid in places:
            continue
        loc = p.get("location", {})
        places[pid] = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [loc.get("longitude", 0), loc.get("latitude", 0)],
            },
            "properties": {
                "name": p.get("displayName", {}).get("text", "Unknown"),
                "address": p.get("formattedAddress", ""),
                "types": p.get("types", []),
                "rating": p.get("rating"),
                "sources": ["google_api"],
            },
        }
    return places

# ── grid helper ──────────────────────────────────────────────────────────────

def create_search_grid(
    bounds: dict, spacing_km: float
) -> List[Tuple[float, float]]:
    """Return list of (lat, lng) covering *bounds* with *spacing_km*."""
    lat_per_km = 1 / 111.0
    mid_lat = (bounds["north"] + bounds["south"]) / 2
    lng_per_km = 1 / (111.0 * math.cos(math.radians(mid_lat)))

    lat_step = spacing_km * lat_per_km
    lng_step = spacing_km * lng_per_km

    points: List[Tuple[float, float]] = []
    lat = bounds["south"]
    while lat <= bounds["north"]:
        lng = bounds["west"]
        while lng <= bounds["east"]:
            points.append((lat, lng))
            lng += lng_step
        lat += lat_step
    return points

# =============================================================================
#  PIPELINE STEPS
# =============================================================================

# ─── step 1: harvest (external) ─────────────────────────────────────────────

def step_harvest(dry_run: bool = False) -> int:
    """Run ../harvest.py to produce the Google Places dump."""
    harvest_script = os.path.normpath(os.path.join(BASE_DIR, "harvest.py"))
    if not os.path.isfile(harvest_script):
        print(f"⚠️  harvest.py not found at {harvest_script}")
        return 1

    cmd = [sys.executable, harvest_script, "secondary_school", "-o", "."]
    print(f"→ Running: {cmd}")
    if dry_run:
        return 0
    proc = subprocess.run(cmd, cwd=BASE_DIR)
    return proc.returncode

# ─── step 2: fetch (OSM + Google dump parse) ────────────────────────────────

def _fetch_osm_schools() -> Dict[str, dict]:
    """Fetch schools from OpenStreetMap Overpass API (chunked into quadrants)."""
    print("\n📍 Fetching from OpenStreetMap (Overpass API)...")
    osm_schools: Dict[str, dict] = {}
    overpass_url = "https://overpass-api.de/api/interpreter"

    mid_lat = (AREA_BOUNDS["south"] + AREA_BOUNDS["north"]) / 2
    mid_lng = (AREA_BOUNDS["west"] + AREA_BOUNDS["east"]) / 2

    quadrants = [
        ("NW", mid_lat, AREA_BOUNDS["north"], AREA_BOUNDS["west"], mid_lng),
        ("NE", mid_lat, AREA_BOUNDS["north"], mid_lng, AREA_BOUNDS["east"]),
        ("SW", AREA_BOUNDS["south"], mid_lat, AREA_BOUNDS["west"], mid_lng),
        ("SE", AREA_BOUNDS["south"], mid_lat, mid_lng, AREA_BOUNDS["east"]),
    ]

    for name, south, north, west, east in quadrants:
        print(f"  Querying {name} quadrant...")
        query = (
            f"[bbox:{south},{west},{north},{east}];"
            '(node["amenity"="school"];way["amenity"="school"];);'
            "out center;"
        )
        try:
            resp = _post_with_retries(overpass_url, data=query, timeout=60)
            if resp is None or resp.status_code != 200:
                code = resp.status_code if resp is not None else "no-response"
                text = resp.text[:200] if resp is not None else ""
                print(f"    ⚠️  Overpass failed: {code} {text}")
                continue
            data = resp.json()
        except Exception as e:
            print(f"    ⚠️  {name}: {e}")
            continue

        for el in data.get("elements", []):
            osm_id = f"osm_{el.get('id')}"
            if osm_id in osm_schools:
                continue

            if "center" in el:
                lat, lng = el["center"]["lat"], el["center"]["lon"]
            elif "lat" in el:
                lat, lng = el["lat"], el["lon"]
            else:
                continue

            tags = el.get("tags", {}) or {}
            level = (tags.get("school:level", "") or "").lower()
            if any(k in level for k in ("primary", "basic", "elementary")):
                stype = "primary"
            elif any(k in level for k in ("secondary", "high", "middle")):
                stype = "secondary"
            else:
                stype = "unknown"

            addr = (tags.get("addr:street", "") + ", " + tags.get("addr:city", "Lisbon")).strip(", ")
            osm_schools[osm_id] = {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lng, lat]},
                "properties": {
                    "name": tags.get("name", "Unknown School"),
                    "address": addr,
                    "school_type": stype,
                    "sources": ["osm"],
                    "confidence": ("low" if stype == "unknown" else "high"),
                    "osm_id": el.get("id"),
                },
            }

        count = sum(
            1 for s in osm_schools.values()
            if south <= s["geometry"]["coordinates"][1] <= north
        )
        print(f"    ✓ {count} schools in {name}")

    print(f"✅ OSM total: {len(osm_schools)} schools")
    return osm_schools

def _parse_google_dump(google_json_path: str) -> Tuple[Dict[str, dict], Dict[str, dict]]:
    """Parse & filter the Google Places dump into primary / secondary dicts."""
    print(f"\n🗺️  Parsing Google Places dump: {google_json_path}")
    primary: Dict[str, dict] = {}
    secondary: Dict[str, dict] = {}

    if not os.path.exists(google_json_path):
        print(f"⚠️  {google_json_path} not found")
        return primary, secondary

    with open(google_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    for feat in data.get("features", []):
        props = feat.get("properties", {}) or {}
        name = str(props.get("name", "") or "").lower()
        address = str(props.get("address", "") or "").lower()
        full = name + " " + address

        if props.get("harvest_category", "").lower() == "university":
            continue
        if any(kw in full for kw in EXCLUDE_KEYWORDS):
            continue

        stype = determine_school_type(feat)
        fid = stable_id(name, address, prefix="google")
        processed = {
            "type": "Feature",
            "geometry": feat.get("geometry"),
            "properties": {
                "name": props.get("name", "Unknown"),
                "address": props.get("address", ""),
                "school_type": stype,
                "sources": ["google_dump"],
                "confidence": "medium",
            },
        }
        if stype == "primary":
            primary[fid] = processed
        else:
            secondary[fid] = processed

    print(f"✅ Google dump: {len(primary)} primary + {len(secondary)} secondary")
    return primary, secondary

def step_fetch(google_input: str) -> Tuple[Dict[str, dict], Dict[str, dict]]:
    """Step 2 – combine OSM schools + parsed Google dump."""
    osm = _fetch_osm_schools()
    g_primary, g_secondary = _parse_google_dump(google_input)

    all_primary = {**g_primary}
    all_primary.update({k: v for k, v in osm.items() if v.get("properties", {}).get("school_type") == "primary"})

    all_secondary = {**g_secondary}
    all_secondary.update({k: v for k, v in osm.items() if v.get("properties", {}).get("school_type") == "secondary"})

    save_school_dataset(PRIMARY_FILENAME, all_primary,
                        "Primary schools – OSM + Google dump", "fetch")
    save_school_dataset(SECONDARY_FILENAME, all_secondary,
                        "Secondary schools – OSM + Google dump", "fetch")

    print(f"✅ Fetch complete: {len(all_primary)} primary, {len(all_secondary)} secondary")
    return all_primary, all_secondary

# ─── step 3: geographic grid search ─────────────────────────────────────────

def step_geographic() -> None:
    """Systematic grid-based Nearby-Search across the metro area."""
    SEARCH_RADIUS_METERS = 2000
    GRID_SPACING_KM = 3.0

    print("\n🎓 Comprehensive Geographic School Search")
    print("=" * 80)

    existing_primary = load_school_dataset(PRIMARY_FILENAME)
    existing_secondary = load_school_dataset(SECONDARY_FILENAME)
    print(f"   Existing: {len(existing_primary)} primary, {len(existing_secondary)} secondary")

    points = create_search_grid(AREA_BOUNDS, GRID_SPACING_KM)
    print(f"   Grid points: {len(points)} | radius {SEARCH_RADIUS_METERS}m")
    print(f"   Estimated time: {len(points) * 0.7 / 60:.1f} min\n")

    all_found: Dict[str, dict] = {}
    t0 = time.time()

    for i, (lat, lng) in enumerate(points, 1):
        results = google_nearby_search(lat, lng, SEARCH_RADIUS_METERS, ["school"])
        for pid, place in results.items():
            if pid not in all_found:
                all_found[pid] = place

        if i % 10 == 0:
            elapsed = time.time() - t0
            rate = i / elapsed if elapsed else 1
            eta = (len(points) - i) / rate
            print(
                f"   {i}/{len(points)} ({100*i//len(points)}%) | "
                f"found {len(all_found)} | ETA {eta/60:.1f} min"
            )
        time.sleep(0.7)

    print(f"\n✅ Search done: {len(all_found)} raw results")

    # filter + categorise
    new_primary: Dict[str, dict] = {}
    new_secondary: Dict[str, dict] = {}

    for pid, place in all_found.items():
        if not is_actual_school(place):
            continue
        stype = determine_school_type(place)
        coords = place.get("geometry", {}).get("coordinates", [])
        if not coords or len(coords) < 2:
            continue
        ckey = coord_key(coords[1], coords[0])
        if stype == "primary":
            if ckey not in existing_primary:
                new_primary[ckey] = place
        else:
            if ckey not in existing_secondary:
                new_secondary[ckey] = place

    print(f"   New primary: {len(new_primary)}, new secondary: {len(new_secondary)}")

    merged_primary = {**existing_primary, **new_primary}
    merged_secondary = {**existing_secondary, **new_secondary}

    merged_primary = deduplicate_by_proximity(merged_primary, 0.05)
    merged_secondary = deduplicate_by_proximity(merged_secondary, 0.05)

    save_school_dataset(PRIMARY_FILENAME, merged_primary,
                        "Primary schools – geographic search",
                        "Systematic grid search 2 km radius")
    save_school_dataset(SECONDARY_FILENAME, merged_secondary,
                        "Secondary schools – geographic search",
                        "Systematic grid search 2 km radius")

    print(f"✅ Geographic step done: {len(merged_primary)} primary, {len(merged_secondary)} secondary")

# ─── step 4: direct API text queries ────────────────────────────────────────

def step_direct() -> None:
    """Text-search queries per municipality for both primary & secondary."""
    print("\n🎓 Google Places API Text Search")
    print("=" * 70)

    municipalities = [
        "Lisboa", "Lisbon", "Cascais", "Sintra", "Loures", "Odivelas",
        "Amadora", "Oeiras", "Almada", "Seixal", "Barreiro", "Montijo",
        "Alcochete", "Moita", "Setúbal",
    ]

    primary_base = ["escola basica", "escolas primarias", "primary school"]
    secondary_base = ["escola secundaria", "secondary school", "escolas secundarias"]

    def _run_queries(base_queries: List[str]) -> Dict[str, dict]:
        places: Dict[str, dict] = {}
        for q in base_queries:
            for muni in municipalities:
                full_q = f"{q} {muni} Portugal"
                results = google_text_search(full_q)
                places.update(results)
                time.sleep(0.5)
            # also bare query
            results = google_text_search(q)
            places.update(results)
            time.sleep(0.5)
        return places

    print("\n📚 Searching primary...")
    raw_primary = _run_queries(primary_base)
    print(f"   Raw: {len(raw_primary)}")

    print("\n📚 Searching secondary...")
    raw_secondary = _run_queries(secondary_base)
    print(f"   Raw: {len(raw_secondary)}")

    # filter
    filtered_primary = {
        pid: {
            "type": "Feature",
            "geometry": p["geometry"],
            "properties": {
                "name": p["properties"]["name"],
                "address": p["properties"]["address"],
                "school_type": "primary",
                "rating": p["properties"].get("rating"),
                "sources": ["google_api"],
                "confidence": "high",
            },
        }
        for pid, p in raw_primary.items()
        if is_actual_school(p)
    }
    filtered_secondary = {
        pid: {
            "type": "Feature",
            "geometry": p["geometry"],
            "properties": {
                "name": p["properties"]["name"],
                "address": p["properties"]["address"],
                "school_type": "secondary",
                "rating": p["properties"].get("rating"),
                "sources": ["google_api"],
                "confidence": "high",
            },
        }
        for pid, p in raw_secondary.items()
        if is_actual_school(p)
    }

    print(f"   Filtered primary: {len(filtered_primary)}, secondary: {len(filtered_secondary)}")

    primary_dedup = deduplicate_by_proximity(filtered_primary, 0.15, prefer_source="google_api")
    secondary_dedup = deduplicate_by_proximity(filtered_secondary, 0.15, prefer_source="google_api")

    save_school_dataset(PRIMARY_FILENAME, primary_dedup,
                        "Primary schools – direct API", "Text search per municipality")
    save_school_dataset(SECONDARY_FILENAME, secondary_dedup,
                        "Secondary schools – direct API", "Text search per municipality")

    print(f"✅ Direct step done: {len(primary_dedup)} primary, {len(secondary_dedup)} secondary")

# ─── step 5: comprehensive primary extraction ───────────────────────────────

def step_comprehensive(google_input: str) -> None:
    """Broad filtering of Google dump for primary schools."""
    print("\n🏫 Comprehensive Primary Schools Generator")
    print("=" * 70)

    if not os.path.exists(google_input):
        print(f"❌ {google_input} not found")
        return

    with open(google_input, "r", encoding="utf-8") as f:
        data = json.load(f)
    features = data.get("features", [])
    print(f"📖 Loaded {len(features)} features")

    # secondary-only indicators → exclude from primary
    secondary_only = [
        "secundária", "secundaria", "secundário", "secundario",
        "3º ciclo", "3 ciclo", "terceiro ciclo", "3ºciclo", "3ciclo",
        "high school", "gymnasium", "lycée", "ensino médio",
        "es ", "e.s.", "e.s ",
        "10º", "11º", "12º", "10 ano", "11 ano", "12 ano",
        "10ºano", "11ºano", "12ºano",
    ]

    primary_schools: Dict[str, dict] = {}
    excluded = 0

    for feat in features:
        props = feat.get("properties", {}) or {}
        name = str(props.get("name", "") or "").lower()
        address = str(props.get("address", "") or "").lower()
        full = name + " " + address
        coords = feat.get("geometry", {}).get("coordinates", [])

        if not coords or len(coords) < 2:
            excluded += 1
            continue
        if any(kw in full for kw in EXCLUDE_KEYWORDS):
            excluded += 1
            continue
        if any(kw in full for kw in secondary_only):
            continue
        if not ("school" in name or "escola" in name or "escol" in address):
            excluded += 1
            continue

        has_primary = any(kw in full for kw in PRIMARY_INDICATORS)
        if not has_primary:
            has_lower = any(f"{i}º" in full or f"{i} ano" in full for i in range(1, 7))
            if not has_lower:
                excluded += 1
                continue

        fid = stable_id(name, address, prefix="google")
        primary_schools[fid] = {
            "type": "Feature",
            "geometry": feat.get("geometry"),
            "properties": {
                "name": props.get("name", "Unknown"),
                "address": props.get("address", ""),
                "school_type": "primary",
                "sources": ["google_dump"],
                "confidence": "medium",
            },
        }

    print(f"   Candidates: {len(primary_schools)}, excluded: {excluded}")
    dedup = deduplicate_by_proximity(primary_schools, 0.05, prefer_source="google_dump")

    save_school_dataset(PRIMARY_FILENAME, dedup,
                        "Primary schools – comprehensive", "Google dump broad filter")
    print(f"✅ Comprehensive step done: {len(dedup)} primary schools")

# ─── step 6: find missing (targeted searches) ───────────────────────────────

def step_find_missing() -> None:
    """Targeted text searches for numbered / neighbourhood schools."""
    print("\n🎯 Targeted Missing Schools Hunter")
    print("=" * 80)

    # build coordinate set of existing schools
    existing_coords: set = set()
    for fname in (PRIMARY_FILENAME, SECONDARY_FILENAME):
        path = _asset_path(fname)
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        for feat in data.get("features", []):
            c = feat.get("geometry", {}).get("coordinates")
            if not c or len(c) < 2:
                continue
            existing_coords.add((round(c[1], COORD_PRECISION), round(c[0], COORD_PRECISION)))
    print(f"   Existing locations: {len(existing_coords)}")

    # assemble queries
    queries: List[str] = []

    # numbered schools
    for i in range(1, 6):
        queries += [
            f"Escola Básica No. {i} Portugal",
            f"EB No. {i} Portugal",
            f"EB{i} Portugal",
            f"Escola Básica {i} Portugal",
        ]

    # neighbourhood-specific
    neighbourhoods = [
        "Camarate", "Olivais", "Marvila", "Parque das Nações",
        "Belém", "Alcântara", "Alvalade", "Lumiar",
        "Santa Apolónia", "São Jorge", "Penha de França",
        "Esteves", "Xabregas", "Calvário",
        "Branqueira", "Encarnação", "Sobreda",
        "Telhal", "Cacém", "Agualva",
        "Caparica", "Tejo", "Sesimbra",
    ]
    for nb in neighbourhoods:
        queries += [
            f"Escola Básica {nb} Portugal",
            f"Agrupamento {nb} Portugal",
            f"Colégio {nb} Portugal",
        ]

    # alternative patterns
    for pat in ["Escola Primária", "Escola Municipal", "Escola Pública",
                "Escola da Carreira", "Escola Rural"]:
        queries.append(f"{pat} Portugal")

    # specific known schools
    queries += [
        "Escola Básica No. 2 Camarate",
        "Escola Artística António Arroio",
        "Escola D. Afonso Henriques",
        "Escola do Bairro da Encarnação",
        "Colégio da Carrasqueira",
    ]

    queries = list(set(queries))
    print(f"   Running {len(queries)} targeted searches...")

    all_found: Dict[str, dict] = {}
    for i, q in enumerate(queries, 1):
        results = google_text_search(q)
        all_found.update(results)
        if i % 10 == 0:
            print(f"   {i}/{len(queries)} | unique: {len(all_found)}")
        time.sleep(0.5)

    print(f"   Raw results: {len(all_found)}")

    # filter & identify new
    new_schools: Dict[str, dict] = {}
    for pid, place in all_found.items():
        if not is_actual_school(place):
            continue
        c = place.get("geometry", {}).get("coordinates", [])
        if not c or len(c) < 2:
            continue
        key = (round(c[1], COORD_PRECISION), round(c[0], COORD_PRECISION))
        if key not in existing_coords:
            # annotate source if missing
            props = place.setdefault("properties", {})
            props.setdefault("sources", ["google_api"])
            new_schools[pid] = place

    print(f"   New schools: {len(new_schools)}")

    # merge into datasets
    all_primary = load_school_dataset(PRIMARY_FILENAME)
    all_secondary = load_school_dataset(SECONDARY_FILENAME)

    pa, sa = 0, 0
    for pid, place in new_schools.items():
        stype = determine_school_type(place)
        c = place.get("geometry", {}).get("coordinates", [])
        if not c or len(c) < 2:
            continue
        ckey = coord_key(c[1], c[0])
        if stype == "primary":
            if ckey not in all_primary:
                all_primary[ckey] = place
                pa += 1
        else:
            if ckey not in all_secondary:
                all_secondary[ckey] = place
                sa += 1

    print(f"   Added {pa} primary, {sa} secondary")

    save_school_dataset(PRIMARY_FILENAME, all_primary,
                        "Primary schools – after targeted search",
                        "Geographic + targeted numbered/neighbourhood")
    save_school_dataset(SECONDARY_FILENAME, all_secondary,
                        "Secondary schools – after targeted search",
                        "Geographic + targeted numbered/neighbourhood")

    print(f"✅ Find-missing done: {len(all_primary)} primary, {len(all_secondary)} secondary")

# ─── step 7: validate & merge ───────────────────────────────────────────────

def _remove_cross_category_dups(
    primary: List[dict], secondary: List[dict], radius_km: float
) -> Tuple[List[dict], List[dict]]:
    """Remove schools that appear in both categories (keep secondary)."""
    remove_idx: Set[int] = set()
    for i, pf in enumerate(primary):
        pc = pf.get("geometry", {}).get("coordinates", [])
        pn = (pf.get("properties", {}).get("name", "") or "").lower()
        if not pc or len(pc) < 2:
            continue
        for sf in secondary:
            sc = sf.get("geometry", {}).get("coordinates", [])
            sn = (sf.get("properties", {}).get("name", "") or "").lower()
            if not sc or len(sc) < 2:
                continue
            dist = haversine_distance(pc[1], pc[0], sc[1], sc[0])
            # use normalized names for comparison
            if dist < radius_km and normalize_text(pn) == normalize_text(sn):
                remove_idx.add(i)
                break
    return [f for i, f in enumerate(primary) if i not in remove_idx], secondary

def step_validate(match_radius_km: float = 0.15) -> None:
    """Final dedup, cross-category cleanup, coordinate validation."""
    print("\n🔍 Validating and merging school datasets...")
    print(f"   Match radius: {match_radius_km} km")

    p_path = _asset_path(PRIMARY_FILENAME)
    s_path = _asset_path(SECONDARY_FILENAME)

    if not os.path.exists(p_path):
        print(f"   ⚠️ {PRIMARY_FILENAME} not found — assuming empty")
        p_data = {"features": []}
    else:
        with open(p_path, "r", encoding="utf-8") as f:
            p_data = json.load(f)

    if not os.path.exists(s_path):
        print(f"   ⚠️ {SECONDARY_FILENAME} not found — assuming empty")
        s_data = {"features": []}
    else:
        with open(s_path, "r", encoding="utf-8") as f:
            s_data = json.load(f)

    pf = p_data.get("features", [])
    sf = s_data.get("features", [])
    print(f"   Before: {len(pf)} primary, {len(sf)} secondary")

    # intra-category dedup
    def _dedup_list(features: List[dict], radius: float) -> List[dict]:
        d: Dict[str, dict] = {}
        for feat in features:
            c = feat.get("geometry", {}).get("coordinates", [])
            if not c or len(c) < 2:
                continue
            key = coord_key(c[1], c[0], precision=COORD_PRECISION)
            d[key] = feat
        return list(deduplicate_by_proximity(d, radius).values())

    pf = _dedup_list(pf, match_radius_km)
    sf = _dedup_list(sf, match_radius_km)

    # cross-category
    pf, sf = _remove_cross_category_dups(pf, sf, match_radius_km)

    # validate coords & names
    def _validate(features: List[dict]) -> List[dict]:
        valid = []
        for feat in features:
            c = feat.get("geometry", {}).get("coordinates", [])
            p = feat.get("properties", {})
            if not c or len(c) < 2:
                continue
            lat, lng = c[1], c[0]
            if not (VALID_LAT[0] < lat < VALID_LAT[1] and VALID_LNG[0] < lng < VALID_LNG[1]):
                continue
            name = (p.get("name", "") or "").strip()
            if not name or len(name) < 2:
                continue
            p.setdefault("sources", [])
            p.setdefault("confidence", "medium")
            p["last_updated"] = datetime.now().isoformat()
            valid.append(feat)
        return valid

    pf = _validate(pf)
    sf = _validate(sf)

    print(f"   After: {len(pf)} primary, {len(sf)} secondary")

    # save
    for fname, feats, desc in [
        (PRIMARY_FILENAME, pf, "Primary schools – validated"),
        (SECONDARY_FILENAME, sf, "Secondary schools – validated"),
    ]:
        output = {
            "type": "FeatureCollection",
            "features": feats,
            "metadata": {
                "description": desc,
                "sources": ["osm", "google"],
                "count": len(feats),
                "generated": datetime.now().isoformat(),
            },
        }
        with open(_asset_path(fname), "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        print(f"   💾 {fname}: {len(feats)} schools")

    print("✅ Validation complete")

# =============================================================================
#  MAIN ORCHESTRATOR
# =============================================================================

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Unified Portuguese Schools Harvesting Pipeline"
    )
    ap.add_argument("--skip-harvest", action="store_true")
    ap.add_argument("--skip-fetch", action="store_true")
    ap.add_argument("--skip-geographic", action="store_true")
    ap.add_argument("--skip-direct", action="store_true")
    ap.add_argument("--skip-comprehensive", action="store_true")
    ap.add_argument("--skip-find-missing", action="store_true")
    ap.add_argument("--skip-validate", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--continue-on-error", action="store_true")
    ap.add_argument(
        "--google-input",
        default=os.path.join(BASE_DIR, GOOGLE_DUMP_FILENAME),
        help="Path to secondary_school_google_places.json",
    )
    args = ap.parse_args()

    if not API_KEY:
        print("⚠️  VITE_GOOGLE_MAPS_API_KEY not set — Google-based steps will be skipped or return empty results")

    steps = [
        ("harvest",       args.skip_harvest,       lambda: step_harvest(args.dry_run)),
        ("fetch",         args.skip_fetch,          lambda: step_fetch(args.google_input)),
        ("geographic",    args.skip_geographic,     step_geographic),
        ("direct",        args.skip_direct,         step_direct),
        ("comprehensive", args.skip_comprehensive,  lambda: step_comprehensive(args.google_input)),
        ("find_missing",  args.skip_find_missing,   step_find_missing),
        ("validate",      args.skip_validate,       step_validate),
    ]

    summary: List[Tuple[str, str]] = []

    for name, skip, func in steps:
        if skip:
            print(f"\n⏭  Skipping {name}")
            summary.append((name, "skipped"))
            continue

        print("\n" + "=" * 60)
        print(f"▶  Step: {name}")
        print("=" * 60)

        if args.dry_run and name != "harvest":
            print("   (dry-run — skipped)")
            summary.append((name, "dry-run"))
            continue

        try:
            result = func()
            # step_harvest returns an int exit-code; others return None or tuples
            if isinstance(result, int) and result != 0:
                raise RuntimeError(f"exit code {result}")
            summary.append((name, "ok"))
        except Exception as exc:
            print(f"✗ {name} failed: {exc}")
            summary.append((name, f"failed: {exc}"))
            if not args.continue_on_error:
                sys.exit(1)

    print("\n" + "=" * 60)
    print("Pipeline summary:")
    for name, status in summary:
        print(f"  {name}: {status}")
    print("=" * 60)

if __name__ == "__main__":
    main()