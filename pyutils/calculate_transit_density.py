#!/usr/bin/env python3
"""
Extracts the area of operations (bounding box, convex hull, alpha shape) from CMET GTFS data.
Automatically downloads and unzips from official API if needed.
"""

import os
import sys
import zipfile
import requests
import pandas as pd
import geopandas as gpd
import argparse
from shapely.ops import unary_union

# Configuration
GTFS_URL = "https://api.carrismetropolitana.pt/v2/gtfs"
GTFS_ZIP = "../CMET.zip"
GTFS_DIR = "../CMET"
STOPS_FILE = os.path.join(GTFS_DIR, "stops.txt")
SHAPES_FILE = os.path.join(GTFS_DIR, "shapes.txt")
LISBON_CRS = "EPSG:32629"  # UTM Zone 29N for accurate area calculations


def download_gtfs(force=False):
    """Download GTFS zip from API if not exists or forced."""
    if os.path.exists(GTFS_ZIP) and not force:
        print(f"✓ GTFS zip already exists: {GTFS_ZIP}")
        return

    print("Downloading CMET GTFS from API...")
    try:
        response = requests.get(GTFS_URL, stream=True, timeout=30)
        response.raise_for_status()
        with open(GTFS_ZIP, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"✓ Downloaded {GTFS_ZIP} ({os.path.getsize(GTFS_ZIP) / 1e6:.1f} MB)")
    except Exception as e:
        print(f"✗ Download failed: {e}")
        sys.exit(1)


def unzip_gtfs(force=False):
    """Unzip GTFS to folder if folder doesn't exist or forced."""
    if os.path.exists(GTFS_DIR) and not force:
        print(f"✓ GTFS folder already exists: {GTFS_DIR}")
        return

    if not os.path.exists(GTFS_ZIP):
        print("✗ GTFS zip not found. Run download first.")
        sys.exit(1)

    print(f"Unzipping {GTFS_ZIP} to {GTFS_DIR}...")
    try:
        # Remove existing dir if force
        if os.path.exists(GTFS_DIR):
            import shutil

            shutil.rmtree(GTFS_DIR)
        with zipfile.ZipFile(GTFS_ZIP, "r") as zip_ref:
            zip_ref.extractall(GTFS_DIR)
        print(f"✓ Unzipped to {GTFS_DIR}")
    except Exception as e:
        print(f"✗ Unzip failed: {e}")
        sys.exit(1)


def load_stops():
    """Load stops.txt as GeoDataFrame."""
    if not os.path.exists(STOPS_FILE):
        print("✗ stops.txt not found. Check GTFS extraction.")
        sys.exit(1)

    stops = pd.read_csv(STOPS_FILE)
    required_cols = ["stop_lat", "stop_lon"]
    if not all(col in stops.columns for col in required_cols):
        print(f"✗ Missing columns in stops.txt: {required_cols}")
        sys.exit(1)

    # Filter valid coordinates
    stops = stops[
        (stops["stop_lat"].between(-90, 90))
        & (stops["stop_lon"].between(-180, 180))
    ]

    gdf = gpd.GeoDataFrame(
        stops,
        geometry=gpd.points_from_xy(stops.stop_lon, stops.stop_lat),
        crs="EPSG:4326",
    )
    print(f"Loaded {len(gdf)} valid stops")
    return gdf


def include_shapes(stops_gdf, use_shapes=True):
    """Optionally include shapes.txt for better coverage."""
    if not use_shapes or not os.path.exists(SHAPES_FILE):
        print("Using stops only")
        return stops_gdf

    shapes = pd.read_csv(SHAPES_FILE)
    required_cols = ["shape_pt_lat", "shape_pt_lon"]
    if not all(col in shapes.columns for col in required_cols):
        print("✗ Missing lat/lon in shapes.txt, using stops only")
        return stops_gdf

    # Filter valid coordinates
    shapes = shapes[
        (shapes["shape_pt_lat"].between(-90, 90))
        & (shapes["shape_pt_lon"].between(-180, 180))
    ]

    shapes_gdf = gpd.GeoDataFrame(
        shapes,
        geometry=gpd.points_from_xy(shapes.shape_pt_lon, shapes.shape_pt_lat),
        crs="EPSG:4326",
    )

    combined = pd.concat([stops_gdf, shapes_gdf], ignore_index=True)

    # Remove exact duplicate coordinates using x/y instead of geometry hash
    combined["x"] = combined.geometry.x
    combined["y"] = combined.geometry.y
    initial_count = len(combined)
    combined = combined.drop_duplicates(subset=["x", "y"]).drop(columns=["x", "y"])
    print(
        f"Added {len(shapes_gdf)} shape points. "
        f"Total: {len(combined)} (removed {initial_count - len(combined)} duplicates)"
    )
    return combined


def compute_bounding_box(points_gdf):
    """Compute axis-aligned bounding box with accurate area."""
    projected = points_gdf.to_crs(LISBON_CRS)
    bounds = projected.total_bounds  # [minx, miny, maxx, maxy] in meters
    bbox_geom = gpd.GeoSeries(
        [projected.geometry.union_all().envelope], crs=LISBON_CRS
    )
    area_m2 = bbox_geom.area.iloc[0]
    return {
        "type": "Bounding Box",
        "bounds_meters": bounds,
        "area_km2": area_m2 / 1e6,
    }


def compute_convex_hull(points_gdf):
    """Compute convex hull polygon with accurate projected area."""
    projected = points_gdf.to_crs(LISBON_CRS)
    hull_projected = projected.geometry.union_all().convex_hull
    bounds = hull_projected.bounds
    return {
        "type": "Convex Hull",
        "geometry": hull_projected,
        "bounds": bounds,
        "area_km2": hull_projected.area / 1e6,
    }


def grid_thin(coords, cell_size):
    """
    Grid-based thinning: keep at most one point per cell of size `cell_size` (meters).
    This preserves overall shape while reducing point count.
    """
    cells = {}
    inv = 1.0 / cell_size
    for x, y in coords:
        key = (int(x * inv), int(y * inv))
        if key not in cells:
            cells[key] = (x, y)
    return list(cells.values())


def compute_alpha_shape(points_gdf, alpha=None):
    """
    Compute alpha shape (concave hull) with proper coordinate handling.

    alpha semantics:
      - alpha is the parameter used by alphashape (1/r in Delaunay terms), NOT meters.
      - If alpha is None or <= 0, a default of 0.0002 is used.
    """
    try:
        from alphashape import alphashape

        # Project to meters first so grid_thin makes sense
        projected = points_gdf.to_crs(LISBON_CRS)
        coords_m = [(pt.x, pt.y) for pt in projected.geometry]

        # Remove exact duplicate coordinates
        coords_m = list(dict.fromkeys(coords_m))

        # Grid-based thinning to preserve boundary shape while reducing density
        coords_m = grid_thin(coords_m, cell_size=250)

        if len(coords_m) < 4:
            print("Not enough points for alpha shape")
            return None

        # Default alpha if requested
        if alpha is None or alpha <= 0:
            print("Using default alpha: 0.0002")
            alpha = 0.0002

        print(f"Computing alpha shape on {len(coords_m)} points with α={alpha} ...")
        alpha_shape_m = alphashape(coords_m, alpha)

        if alpha_shape_m.is_empty or alpha_shape_m.area == 0:
            print("✗ Alpha shape degenerate, using convex hull instead")
            return None

        # Preserve concave outline; if MultiPolygon, dissolve rather than convex-hull it
        if alpha_shape_m.geom_type == "MultiPolygon":
            alpha_shape_m = unary_union(alpha_shape_m)

        bounds = alpha_shape_m.bounds
        return {
            "type": f"Alpha Shape (α={alpha:.4g})",
            "geometry": alpha_shape_m,
            "bounds": bounds,
            "area_km2": alpha_shape_m.area / 1e6,
        }
    except ImportError:
        print("alphashape not installed. Install with: pip install alphashape")
        return None
    except Exception as e:
        print(f"Alpha shape failed: {e}")
        return None


def format_bounds(bounds):
    """Format bounds array [minx, miny, maxx, maxy] to string."""
    return f"[{bounds[0]:.0f}, {bounds[1]:.0f}, {bounds[2]:.0f}, {bounds[3]:.0f}]m"


def main(args):
    print("CMET GTFS Area of Operations Extractor")
    print("=" * 50)

    # Setup GTFS data
    download_gtfs(force=args.force)
    unzip_gtfs(force=args.force)

    # Load and process data
    stops_gdf = load_stops()
    points_gdf = include_shapes(stops_gdf, use_shapes=args.shapes)

    # Compute areas (using projected CRS for accuracy)
    bbox = compute_bounding_box(points_gdf)
    hull = compute_convex_hull(points_gdf)
    alpha_param = None if args.alpha <= 0 else args.alpha
    alpha = compute_alpha_shape(points_gdf, alpha=alpha_param)

    # Results table
    print("\nRESULTS (accurate areas using UTM29N projection):")
    print("-" * 60)
    print(f"{'Method':<20} {'Bounds (UTM29N)':<32} {'Area (km²)':<12}")
    print("-" * 60)
    print(
        f"{bbox['type']:<20} {format_bounds(bbox['bounds_meters']):<32} {bbox['area_km2']:<12.2f}"
    )
    print(
        f"{hull['type']:<20} {format_bounds(hull['bounds']):<32} {hull['area_km2']:<12.2f}"
    )

    if alpha:
        print(
            f"{alpha['type']:<20} {format_bounds(alpha['bounds']):<32} {alpha['area_km2']:<12.2f}"
        )
        best_shape = alpha["geometry"]
        best_label = alpha["type"]
    else:
        print("Warning: alpha shape unavailable; using convex hull (coarse).")
        best_shape = hull["geometry"]
        best_label = hull["type"]

    # Save GeoJSON for GIS use (best available shape in WGS84)
    output_file = "../src/assets/cmet_service_areas.json"

    # best_shape is in LISBON_CRS; compute area there, store geometry in WGS84
    best_shape_proj = best_shape
    best_shape_wgs84 = (
        gpd.GeoSeries([best_shape_proj], crs=LISBON_CRS)
        .to_crs("EPSG:4326")
        .iloc[0]
    )

    areas_gdf = gpd.GeoDataFrame(
        [{"method": best_label, "area_km2": best_shape_proj.area / 1e6}],
        geometry=[best_shape_wgs84],
        crs="EPSG:4326",
    )
    areas_gdf.to_file(output_file, driver="GeoJSON")

    print(f"\n✓ GeoJSON saved: {output_file}")
    print("Use QGIS/ArcGIS to visualize.")
    print(
        f"Best shape: {areas_gdf['method'].iloc[0]} "
        f"({areas_gdf['area_km2'].iloc[0]:.2f} km²)"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract CMET service areas from GTFS")
    parser.add_argument("--force", action="store_true", help="Redownload/unzip GTFS")
    parser.add_argument(
        "--no-shapes",
        dest="shapes",
        action="store_false",
        help="Exclude shapes.txt points",
        default=True,
    )
    parser.add_argument(
        "--alpha",
        type=float,
        default=0.0002,
        help=(
            "Alpha parameter for alphashape. "
            "Use <= 0 for default (0.0002); typical useful values are 0.001–0.1."
        ),
    )
    args = parser.parse_args()
    main(args)
