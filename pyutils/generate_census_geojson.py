import os
import zipfile
import urllib.request
import geopandas as gpd
import pyogrio

# Ensure pyogrio is used for I/O
gpd.options.io_engine = "pyogrio"

# Paths
data_dir = r"../census"
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

    # Reproject to WGS84 (EPSG:4326) so Mapbox accepts the GeoJSON
    if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
        print(f"Reprojecting layer {layer} from {gdf.crs} to EPSG:4326")
        gdf = gdf.to_crs(epsg=4326)

    # Safe filename from layer name
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in layer)
    out_path = os.path.join(output_dir, f"{safe_name}_wgs84.geojson")

    print(f"Writing {len(gdf)} features to {out_path}")
    gdf.to_file(out_path, driver="GeoJSON")

print("Done.")