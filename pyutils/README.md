# Data Preparation

## Step 1: Generate Census GeoJSONs
Downloads INE BGRI 2021 data and converts it to Web-optimized GeoJSON (WGS84).
- **Input**: Automatically downloads `BGRI21_LISBOA.zip` from INE.
- **Output**: `data/census/geojson/*_wgs84.geojson` (Polygons) and `*_centroids_wgs84.geojson` (Centroids).

```bash
cd pyutils
uv run generate_census_geojson.py
```

## Step 2: Calculate Transit Density
Downloads GTFS feeds for major Lisbon operators, calculates daily frequency per stop, and aggregates it to the Census Blocks.
- **Input**: `BGRI21_LISBOA_centroids_wgs84.geojson` (from Step 1) + Online GTFS feeds.
- **Output**: Updates `BGRI21_LISBOA_centroids_wgs84.geojson` with a `TRANSIT_STOP_BY_FREQUENCIES` property.

```bash
uv run calculate_transit_density.py
```

## Step 3: Harvest Places (Optional)
Fetches specific categories of places from Google Maps. For the "Places" panel.
- **Requires**: `VITE_GOOGLE_MAPS_API_KEY` in `.env`.
- **Output**: `src/assets/<category>.json`.

```bash
# Example: Harvest hospitals and schools
uv run harvest.py hospital # You can put multiple categories in the same command but they will then be written in a single file, useful if you want a click on the interface to show multiple categories at once.
uv run schools.py
```