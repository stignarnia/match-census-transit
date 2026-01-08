import os
import zipfile
import urllib.request
import geopandas as gpd
import pyogrio

# Ensure pyogrio is used for I/O
gpd.options.io_engine = "pyogrio"

# Paths
data_dir = r"../data/census"
zip_path = os.path.join(data_dir, "BGRI21_LISBOA.zip")
gpkg_path = os.path.join(data_dir, "BGRI21_LISBOA.gpkg")
output_dir = os.path.join(data_dir, "geojson")

# URL to download if needed
url = "https://mapas.ine.pt/download/filesGPG/2021/nuts2/BGRI21_LISBOA.zip"

os.makedirs(data_dir, exist_ok=True)
os.makedirs(output_dir, exist_ok=True)

# Download ZIP only if GPKG does not exist
if not os.path.exists(gpkg_path):
    if not os.path.exists(zip_path):
        print(f"Downloading {url} -> {zip_path}")
        urllib.request.urlretrieve(url, zip_path)
        print("Download complete.")
    else:
        print(f"ZIP already exists at {zip_path}, skipping download.")

    # Extract GPKG from ZIP (if not already extracted)
    print(f"Extracting {zip_path}")
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(data_dir)
    print("Extraction complete.")
else:
    print(f"GPKG already exists at {gpkg_path}, skipping download and extraction.")

# List layers with pyogrio
layers = pyogrio.list_layers(gpkg_path)
# pyogrio.list_layers returns a list of (name, geometry_type, crs) tuples
layer_names = [l[0] for l in layers]

print("Found layers:", layer_names)

for layer in layer_names:
    print(f"Reading layer: {layer}")
    gdf = gpd.read_file(gpkg_path, layer=layer, engine="pyogrio")

    # --- 1. Process CENTROIDS (Chonky: All attributes + AREA_M2) ---
    print(f"Processing layer {layer} for centroids...")
    
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in layer)

    # Work in projected CRS (EPSG:3763) for correct area and centroid calculation
    gdf_proj = gdf.to_crs(epsg=3763)
    
    # Calculate Area in square meters
    gdf_proj["AREA_M2"] = gdf_proj.geometry.area
    
    # Create centroids
    gdf_centroids_proj = gdf_proj.copy()
    gdf_centroids_proj["geometry"] = gdf_centroids_proj.geometry.centroid
    
    # Project back to WGS84 for Mapbox
    gdf_centroids_wgs84 = gdf_centroids_proj.to_crs(epsg=4326)
    
    centroid_out_path = os.path.join(output_dir, f"{safe_name}_centroids_wgs84.geojson")
    print(f"Writing {len(gdf_centroids_wgs84)} rich centroid features (with AREA_M2) to {centroid_out_path}")
    gdf_centroids_wgs84.to_file(centroid_out_path, driver="GeoJSON")

    # --- 2. Process POLYGONS (Lean: Only ID + Geometry) ---
    print(f"Processing layer {layer} for polygons...")
    
    # Keep only the ID column 'BGRI2021' and the geometry
    columns_to_keep = ["BGRI2021", "geometry"]
    
    # Filter columns on the original GDF (which is in source CRS, likely EPSG:3763)
    gdf_lean = gdf[columns_to_keep].copy()
    
    # Project to WGS84
    gdf_lean_wgs84 = gdf_lean.to_crs(epsg=4326)
    
    poly_out_path = os.path.join(output_dir, f"{safe_name}_wgs84.geojson")
    print(f"Writing {len(gdf_lean_wgs84)} lean polygon features to {poly_out_path}")
    gdf_lean_wgs84.to_file(poly_out_path, driver="GeoJSON")

print("Done.")