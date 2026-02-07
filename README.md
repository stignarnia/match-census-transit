# Match Census Transit

Access gaps in public transit vs. population density and points of interest in Lisbon.

An interactive map to visualize the relationship between population density and public transport presence in the Lisbon Metropolitan Area. It is designed to expose the **"Transit Gap"**, areas with high density but poor service.

## Core Features

- **⏱️ Interactive Transit vs. Car Comparison**: Click on any two census blocks on the map to instantly calculate the travel time difference.
    -   **Green Line**: Transit is competitive with driving.
    -   **Red Line**: Transit is significantly slower than driving (e.g., 200%+ longer).
    -   **Percentage Label**: Shows exactly how much longer the transit trip takes compared to a car.
- **👥 Population Density Heatmap**: Visualizes BGRI 2021 census data to identify population centers. Can filter for elderly (65+) and young (0-24) population.
- **📍 Places of Interest**: Overlays key amenities (for now just hospitals and schools) harvested via Google Places API to see what services are accessible.
- **Transit Density Analysis**: Calculates avg. daily trip frequency per census block using multiple GTFS feeds (Carris, Metro, CP, etc.).

## Prerequisites

- **Node.js**
- **uv** (Fast Python package installer and resolver)
- **Mapbox Account** (for hosting tilesets)
- **Google Maps `Places API (New)` Key** (for harvesting new places & routing)

To generate the data, run the scripts in the following order using `uv run`.

## Prepare the data before running

### Step 1: Generate Census GeoJSONs
Downloads INE BGRI 2021 data and converts it to Web-optimized GeoJSON (WGS84).
- **Input**: Automatically downloads `BGRI21_LISBOA.zip` from INE.
- **Output**: `data/census/geojson/*_wgs84.geojson` (Polygons) and `*_centroids_wgs84.geojson` (Centroids).

```bash
cd pyutils
uv run generate_census_geojson.py
```

### Step 2: Calculate Transit Density
Downloads GTFS feeds for major Lisbon operators, calculates daily frequency per stop, and aggregates it to the Census Blocks.
- **Input**: `BGRI21_LISBOA_centroids_wgs84.geojson` (from Step 1) + Online GTFS feeds.
- **Output**: Updates `BGRI21_LISBOA_centroids_wgs84.geojson` with a `TRANSIT_STOP_BY_FREQUENCIES` property.

```bash
uv run calculate_transit_density.py
```

### Step 3: Harvest Places (Optional)
Fetches specific categories of places from Google Maps. For the "Places" panel.
- **Requires**: `VITE_GOOGLE_MAPS_API_KEY` in `.env`.
- **Output**: `src/assets/<category>.json`.

```bash
# Example: Harvest hospitals and secondary schools
uv run harvest.py hospital
uv run harvest.py secondary_school
```

You can put multiple categories in the same command but they will then be written in a single file, useful if you want a click on the interface to show multiple categories at once.

## Mapbox Setup

This project relies on Mapbox Tilesets for performance. If you update the data (Steps 1 & 2), you must update Mapbox:

1.  **Log in to Mapbox Studio**.
2.  **Go to Data Manager (v2)** -> **Upload**.
3.  **Upload the files** generated in `data/census/geojson/`:
    *   Upload `BGRI21_LISBOA_centroids_wgs84.geojson` (The Centroids with Transit and Population Data).
    *   Click `Publish` in the top right corner.
    *   Click on advanced configuration (the `</>` button at the bottom of the left panel).
    *   Paste the following:
        ```json
        {
            "source": "This will be already populated, note it down",
            "minzoom": 0,
            "maxzoom": 16,
            "features": {
                "simplification": 0
            }
        }
        ```
    *   Click `Process tileset`
    *   Upload `BGRI21_LISBOA_wgs84.geojson` (The Polygons).
    *   Repeat the steps above.
4.  **Copy the Tileset IDs** (in the home page of the Data Manager (v2) click the three dots) and **Sources** (the ones you noted before).
5.  **Get your default public token** from the top right part of the Mapbox Studio homepage.
6.  **Update your `.env` file**:

```
VITE_MAPBOX_ACCESS_TOKEN=defaultpublictoken
VITE_GOOGLE_MAPS_API_KEY=googlemapsplacesnewapikey
VITE_TILESET_URL_HEATMAP=mapbox://mapboxusername.tilesetid1
VITE_SOURCE_LAYER_HEATMAP=source1
VITE_TILESET_URL_BGRI=mapbox://mapboxusername.tilesetid2
VITE_SOURCE_LAYER_BGRI=source2
CENTER_LAT=38.72
CENTER_LNG=-9.15
TOTAL_SQUARE_KM=50
LENS_SIZE_KM=4
```

## Running the App

```bash
npm install
npm run dev
```