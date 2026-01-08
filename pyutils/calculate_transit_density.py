#!/usr/bin/env python3
"""
Calculates transit density for Lisbon Census Blocks (BGRI2021) using MULTIPLE GTFS feeds.

Feeds:
1. Carris Metropolitana (CMET)
2. Carris (Lisbon City)
3. Metropolitano de Lisboa (Metro)
4. CP (Urban Trains)

Transit Density is defined here as the "True Average Daily Frequency" of all stops within a block.
Methodology:
1. For each feed:
    a. Determine the full validity period (N days).
    b. For every trip, calculate active days (D).
    c. For every stop, sum D of visiting trips to get "Total Stop Events".
    d. Avg Daily Frequency = Total Stop Events / N.
    e. Spatially join stops to BGRI areas.
    f. Aggregate frequency by Area ID.
2. Sum densities across all feeds for each Area ID.
3. Export to GeoJSON.
"""

import os
import sys
import zipfile
import requests
import pandas as pd
import geopandas as gpd
from datetime import datetime, timedelta
import shutil

# Configuration
FEEDS = [
    {
        "name": "CMET",
        "url": "https://api.carrismetropolitana.pt/v2/gtfs",
        "dir": "../data/gtfs/CMET"
    },
    {
        "name": "Carris",
        "url": "https://gateway.carris.pt/gateway/gtfs/api/v2.11/GTFS",
        "dir": "../data/gtfs/Carris"
    },
    {
        "name": "Metro",
        "url": "https://www.metrolisboa.pt/google_transit/googleTransit.zip",
        "dir": "../data/gtfs/Metro"
    },
    {
        "name": "CP",
        "url": "https://publico.cp.pt/gtfs/gtfs.zip",
        "dir": "../data/gtfs/CP"
    }
]

AREAS_GEOJSON = "../census/geojson/BGRI21_LISBOA_wgs84.geojson"
OUTPUT_GEOJSON = "../census/geojson/BGRI21_LISBOA_transit_density.geojson"

def download_and_unzip(feed_config):
    """Download and unzip GTFS for a specific feed, with caching."""
    name = feed_config["name"]
    url = feed_config["url"]
    feed_dir = feed_config["dir"]
    zip_path = f"{feed_dir}.zip"

    # Create parent dir if needed
    os.makedirs(os.path.dirname(feed_dir), exist_ok=True)

    # 1. Check if folder exists
    if os.path.exists(feed_dir) and os.path.isdir(feed_dir):
        if os.listdir(feed_dir):
            print(f"[{name}] Folder exists ({feed_dir}). Skipping download/unzip.")
            return True

    # 2. Check if zip exists
    if os.path.exists(zip_path):
        print(f"[{name}] Zip exists ({zip_path}). Skipping download.")
    else:
        # Download
        print(f"[{name}] Downloading from {url}...")
        try:
            response = requests.get(url, stream=True, timeout=60)
            response.raise_for_status()
            with open(zip_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
        except Exception as e:
            print(f"[{name}] ✗ Download failed: {e}")
            return False

    # 3. Unzip
    print(f"[{name}] Unzipping to {feed_dir}...")
    try:
        if os.path.exists(feed_dir):
            shutil.rmtree(feed_dir)
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(feed_dir)
        return True
    except Exception as e:
        print(f"[{name}] ✗ Unzip failed: {e}")
        return False

def parse_gtfs_date(date_str):
    """Parses YYYYMMDD string to datetime object."""
    try:
        return datetime.strptime(str(date_str).split('.')[0], "%Y%m%d")
    except ValueError:
        return None

def get_service_active_days(calendar_df, calendar_dates_df):
    """
    Returns a dictionary mapping service_id -> number of active days.
    """
    dates_sources = []
    if calendar_df is not None and not calendar_df.empty:
        dates_sources.append(parse_gtfs_date(calendar_df['start_date'].min()))
        dates_sources.append(parse_gtfs_date(calendar_df['end_date'].max()))
        
    if not calendar_dates_df.empty:
        dates_sources.append(parse_gtfs_date(calendar_dates_df['date'].min()))
        dates_sources.append(parse_gtfs_date(calendar_dates_df['date'].max()))
        
    dates_sources = [d for d in dates_sources if d is not None]
        
    if not dates_sources:
        print("  Error: No valid date information found.")
        return {}, 1
        
    min_date = min(dates_sources)
    max_date = max(dates_sources)
        
    total_days = (max_date - min_date).days + 1
    print(f"  Validity: {min_date.date()} to {max_date.date()} ({total_days} days)")

    service_days_count = {}

    # Pre-process calendar_dates
    exceptions = {}
    if not calendar_dates_df.empty:
        for _, row in calendar_dates_df.iterrows():
            sid = row['service_id']
            date = parse_gtfs_date(row['date'])
            if date is None: continue
            etype = row['exception_type']
            if sid not in exceptions: exceptions[sid] = {}
            exceptions[sid][date] = etype

    # Process calendar.txt
    if calendar_df is not None:
        days_cols = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        for _, row in calendar_df.iterrows():
            sid = row['service_id']
            start = parse_gtfs_date(row['start_date'])
            end = parse_gtfs_date(row['end_date'])
            if start is None or end is None: continue
            
            weekdays = [row[day] == 1 for day in days_cols]
            
            count = 0
            current = start
            while current <= end:
                is_active = weekdays[current.weekday()]
                if sid in exceptions and current in exceptions[sid]:
                    is_active = (exceptions[sid][current] == 1)
                
                if is_active:
                    count += 1
                current += timedelta(days=1)
            service_days_count[sid] = count

    # Only calendar_dates services
    for sid, exc_dates in exceptions.items():
        if sid not in service_days_count:
             count = sum(1 for etype in exc_dates.values() if etype == 1)
             service_days_count[sid] = count

    return service_days_count, total_days

def process_feed(feed_config, areas_gdf):
    """
    Process a single GTFS feed and return a DataFrame of transit density per BGRI area.
    """
    name = feed_config["name"]
    feed_dir = feed_config["dir"]
    
    print(f"\nProcessing {name}...")
    
    # Check required files
    active_files = os.listdir(feed_dir)
    # Some zips put files in a subdirectory (e.g. nested folder). Check depth 1.
    # Simple check: if no stops.txt, look in subdirs
    if "stops.txt" not in active_files:
        for item in active_files:
            subpath = os.path.join(feed_dir, item)
            if os.path.isdir(subpath) and "stops.txt" in os.listdir(subpath):
                feed_dir = subpath
                print(f"  Found GTFS root in subdirectory: {item}")
                break

    try:
        stops = pd.read_csv(os.path.join(feed_dir, "stops.txt"))
        trips = pd.read_csv(os.path.join(feed_dir, "trips.txt"))
        stop_times = pd.read_csv(os.path.join(feed_dir, "stop_times.txt"), dtype={'stop_id': str})
        
        # Ensure ID columns are strings to match
        stops['stop_id'] = stops['stop_id'].astype(str)
        trips['trip_id'] = trips['trip_id'].astype(str)
        trips['service_id'] = trips['service_id'].astype(str)
        stop_times['trip_id'] = stop_times['trip_id'].astype(str)
        
        calendar = None
        if os.path.exists(os.path.join(feed_dir, "calendar.txt")):
            calendar = pd.read_csv(os.path.join(feed_dir, "calendar.txt"), dtype={'service_id': str})

        calendar_dates = pd.DataFrame(columns=['service_id', 'date', 'exception_type'])
        if os.path.exists(os.path.join(feed_dir, "calendar_dates.txt")):
            calendar_dates = pd.read_csv(os.path.join(feed_dir, "calendar_dates.txt"), dtype={'service_id': str})
    
    except Exception as e:
        print(f"  ✗ Error loading GTFS CSVs: {e}")
        return pd.DataFrame()

    # Calculate frequencies
    service_day_counts, total_feed_days = get_service_active_days(calendar, calendar_dates)
    
    if total_feed_days <= 0:
        print("  ✗ Invalid feed duration.")
        return pd.DataFrame()

    trips['active_days'] = trips['service_id'].map(service_day_counts).fillna(0)
    
    print("  Calculating stop events...")
    stop_events = stop_times[['stop_id', 'trip_id']].merge(
        trips[['trip_id', 'active_days']], 
        on='trip_id', 
        how='left'
    )
    
    stop_total = stop_events.groupby('stop_id')['active_days'].sum().reset_index()
    stop_total.rename(columns={'active_days': 'total_events'}, inplace=True)
    stop_total['avg_daily_freq'] = stop_total['total_events'] / total_feed_days
    
    # Filter stops with no service
    stop_total = stop_total[stop_total['avg_daily_freq'] > 0]
    print(f"  {len(stop_total)} active stops found.")
    
    # Merge to Geometry
    stops_gdf = gpd.GeoDataFrame(
        stops,
        geometry=gpd.points_from_xy(stops.stop_lon, stops.stop_lat),
        crs="EPSG:4326"
    )
    stops_gdf = stops_gdf.merge(stop_total[['stop_id', 'avg_daily_freq']], on='stop_id', how='inner')
    
    # Spatial Join
    print("  Spatial join to areas (using EPSG:3763 for distance calculation)...")
    # Project to EPSG:3763 (meters) for accurate nearest neighbor distance
    stops_proj = stops_gdf.to_crs(epsg=3763)
    areas_proj = areas_gdf.to_crs(epsg=3763)
        
    joined = gpd.sjoin_nearest(stops_proj, areas_proj[['BGRI2021', 'geometry']], how="inner", distance_col="dist")
    
    # Aggregate
    agg = joined.groupby("BGRI2021").agg(
        transit_density=("avg_daily_freq", "sum"),
        stop_count=("stop_id", "count")
    ).reset_index()

    print(f"  Matched {len(agg)} areas.")
    return agg


def main():
    print("Multi-Feed Transit Density Calculator")
    print("=" * 60)

    # Load Areas
    print(f"Loading BGRI areas from {AREAS_GEOJSON}...")
    if not os.path.exists(AREAS_GEOJSON):
        print("Error: Areas GeoJSON not found.")
        sys.exit(1)
        
    areas_gdf = gpd.read_file(AREAS_GEOJSON)
    # Ensure ID is string
    areas_gdf['BGRI2021'] = areas_gdf['BGRI2021'].astype(str)

    results = []
    
    # Process Feeds
    for feed in FEEDS:
        if download_and_unzip(feed):
            df = process_feed(feed, areas_gdf)
            if not df.empty:
                results.append(df)
        else:
            print(f"Skipping {feed['name']} due to errors.")
            
    if not results:
        print("No data calculated from any feed. Exiting.")
        sys.exit(1)
        
    print("\nAggregating all feeds...")
    # Concatenate all results
    combined_df = pd.concat(results, ignore_index=True)
    
    # Sum by BGRI2021
    final_stats = combined_df.groupby("BGRI2021").sum().reset_index()
    
    # Merge back to geometry
    final_gdf = areas_gdf.merge(final_stats, on="BGRI2021", how="left")
    
    # Fill zeros
    final_gdf["transit_density"] = final_gdf["transit_density"].fillna(0)
    final_gdf["stop_count"] = final_gdf["stop_count"].fillna(0)
    
    # Save
    print(f"Saving to {OUTPUT_GEOJSON}...")
    final_gdf.to_file(OUTPUT_GEOJSON, driver="GeoJSON")
    
    print("\nFinal Summary:")
    print(f"  Max Density: {final_gdf['transit_density'].max():.2f}")
    print(f"  Mean Density: {final_gdf['transit_density'].mean():.2f}")
    print(f"  Areas with Service: {len(final_gdf[final_gdf['transit_density'] > 0])}")

if __name__ == "__main__":
    main()
