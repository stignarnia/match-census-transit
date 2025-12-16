import { getFromCache, saveToCache, generateCacheKey } from './api-cache';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const API_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

export interface RouteResult {
    drive: {
        distanceMeters: number | null;
        duration: string | null;
    };
    transit: {
        distanceMeters: number | null;
        duration: string | null;
    };
}

interface Coord {
    lat: number;
    lng: number;
}

export async function fetchRouteData(origin: Coord, destination: Coord): Promise<RouteResult> {
    // Set departure time to 1 hour from now
    const departureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const cacheKey = generateCacheKey(origin, destination, departureTime);
    const cached = getFromCache(cacheKey);

    if (cached) {
        console.log('Serving route data from cache');
        return cached;
    }

    if (!API_KEY) {
        console.error('VITE_GOOGLE_MAPS_API_KEY is missing!');
        return { drive: { distanceMeters: null, duration: null }, transit: { distanceMeters: null, duration: null } };
    }

    const requestBodyBase = {
        origins: [{ waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } } }],
        destinations: [{ waypoint: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } } }],
        departureTime: departureTime,
    };

    // Parallel requests for separate travel modes

    const drivePromise = fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': API_KEY,
            'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition'
        },
        body: JSON.stringify({
            ...requestBodyBase,
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_AWARE'
        })
    });

    const transitPromise = fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': API_KEY,
            'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition'
        },
        body: JSON.stringify({
            ...requestBodyBase,
            travelMode: 'TRANSIT'
        })
    });

    try {
        const [driveResp, transitResp] = await Promise.all([drivePromise, transitPromise]);

        if (!driveResp.ok || !transitResp.ok) {
            console.error('One or more API requests failed', {
                driveStatus: driveResp.status,
                transitStatus: transitResp.status
            });
            // You might want to get text here to see error details
            const driveErr = !driveResp.ok ? await driveResp.text() : '';
            const transitErr = !transitResp.ok ? await transitResp.text() : '';
            if (driveErr) console.error('Drive Error:', driveErr);
            if (transitErr) console.error('Transit Error:', transitErr);
        }

        const driveJson = driveResp.ok ? await driveResp.json() : [];
        const transitJson = transitResp.ok ? await transitResp.json() : [];

        // Parse single result from matrix response

        const driveData = driveJson[0] || {};
        const transitData = transitJson[0] || {};

        const result: RouteResult = {
            drive: {
                distanceMeters: driveData.distanceMeters || null,
                duration: driveData.duration || null
            },
            transit: {
                distanceMeters: transitData.distanceMeters || null,
                duration: transitData.duration || null
            }
        };

        saveToCache(cacheKey, result);
        return result;

    } catch (error) {
        console.error('Error fetching route data:', error);
        return {
            drive: { distanceMeters: null, duration: null },
            transit: { distanceMeters: null, duration: null }
        };
    }
}
