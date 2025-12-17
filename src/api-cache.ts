export function saveToCache<T>(key: string, data: T): void {
    try {
        const cacheEntry = {
            timestamp: Date.now(),
            data: data
        };
        localStorage.setItem(key, JSON.stringify(cacheEntry));
    } catch (error) {
        console.warn('Failed to save to cache:', error);
    }
}

export function getFromCache<T>(key: string): T | null {
    try {
        // Clean up old cache entries (older than 1 week)
        cleanupOldCache();

        // Retrieve and parse cache if exists
        const item = localStorage.getItem(key);

        if (!item) return null;

        const cacheEntry = JSON.parse(item);
        return cacheEntry.data;
    } catch (error) {
        console.warn('Failed to retrieve from cache:', error);
        return null;
    }
}

function cleanupOldCache(): void {
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Iterate backwards to safely remove items while iterating
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('route_')) {
            try {
                const item = localStorage.getItem(key);
                if (item) {
                    const entry = JSON.parse(item);
                    if (now - entry.timestamp > ONE_WEEK_MS) {
                        localStorage.removeItem(key);
                    }
                }
            } catch (e) {
                // Ignore parsing errors
            }
        }
    }
}

export function generateCacheKey(origin: { lat: number, lng: number }, destination: { lat: number, lng: number }, departureTime: string): string {
    return `route_${origin.lat}_${origin.lng}_${destination.lat}_${destination.lng}_${departureTime}`;
}
