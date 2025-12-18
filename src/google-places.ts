import { getFromCache, saveToCache, generatePlacesCacheKey } from './api-cache';
import { MAP_CENTER_LNG, MAP_CENTER_LAT } from './constants';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const API_URL = 'https://places.googleapis.com/v1/places:searchNearby';

export interface PlaceFeature {
    type: 'Feature';
    geometry: {
        type: 'Point';
        coordinates: [number, number];
    };
    properties: {
        name: string;
        address: string;
        place_type: string;
    };
}

export interface PlaceResult {
    places: {
        displayName: { text: string };
        formattedAddress: string;
        location: { latitude: number; longitude: number };
    }[];
}

export async function fetchNearbyPlaces(type: string): Promise<FeatureCollection> {
    const cacheKey = generatePlacesCacheKey(type);
    const cached = getFromCache<FeatureCollection>(cacheKey);

    if (cached) {
        console.log(`Serving ${type} places from cache`);
        return cached;
    }

    if (!API_KEY) {
        console.error('VITE_GOOGLE_MAPS_API_KEY is missing!');
        return { type: 'FeatureCollection', features: [] };
    }

    // Map strict type to API type if needed, or pass through
    // For now we assume the UI passesvalid API types like 'hospital', 'school'
    const apiType = type;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': API_KEY,
                'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location'
            },
            body: JSON.stringify({
                includedTypes: [apiType],
                maxResultCount: 20, // Adjust as needed, max is 20
                locationRestriction: {
                    circle: {
                        center: {
                            latitude: MAP_CENTER_LAT,
                            longitude: MAP_CENTER_LNG
                        },
                        radius: 30000.0 // 30km
                    }
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Places API Error (${response.status}):`, errorText);
            return { type: 'FeatureCollection', features: [] };
        }

        const data: PlaceResult = await response.json();
        const features: PlaceFeature[] = (data.places || []).map(place => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [place.location.longitude, place.location.latitude]
            },
            properties: {
                name: place.displayName?.text || 'Unknown',
                address: place.formattedAddress || '',
                place_type: type
            }
        }));

        const result: FeatureCollection = {
            type: 'FeatureCollection',
            features: features
        };

        saveToCache<FeatureCollection>(cacheKey, result);
        return result;

    } catch (error) {
        console.error('Error fetching places:', error);
        return { type: 'FeatureCollection', features: [] };
    }
}

// Helper types
interface FeatureCollection {
    type: 'FeatureCollection';
    features: PlaceFeature[];
}
