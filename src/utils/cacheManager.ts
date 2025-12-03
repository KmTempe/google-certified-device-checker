export interface DeviceData {
    "Retail Branding": string;
    "Marketing Name": string;
    "Device": string;
    "Model": string;
}

interface CacheEntry {
    data: DeviceData[];
    timestamp: number;
    hits: number;
}

const CACHE_LIFETIME = 12 * 60 * 60 * 1000; // 12 hours in milliseconds

export const cacheManager = {
    getKey: (query: string) => `device_search_${query.toLowerCase()}`,

    get: (query: string): { data: DeviceData[]; source: 'Session Cache' | 'Local Cache' } | null => {
        const key = cacheManager.getKey(query);
        const now = Date.now();

        // 1. Check Local Storage (Tier 2 - Frequent)
        try {
            const localItem = localStorage.getItem(key);
            if (localItem) {
                const entry: CacheEntry = JSON.parse(localItem);
                if (now - entry.timestamp < CACHE_LIFETIME) {
                    // Update hits
                    entry.hits += 1;
                    localStorage.setItem(key, JSON.stringify(entry));
                    return { data: entry.data, source: 'Local Cache' };
                } else {
                    localStorage.removeItem(key); // Expired
                }
            }
        } catch (e) {
            console.warn("Local storage access failed", e);
        }

        // 2. Check Session Storage (Tier 1 - Recent)
        try {
            const sessionItem = sessionStorage.getItem(key);
            if (sessionItem) {
                const entry: CacheEntry = JSON.parse(sessionItem);
                if (now - entry.timestamp < CACHE_LIFETIME) {
                    entry.hits += 1;

                    // Promotion Logic: If hit > 1, move to Local Storage
                    if (entry.hits > 1) {
                        try {
                            localStorage.setItem(key, JSON.stringify(entry));
                            sessionStorage.removeItem(key); // Remove from session once promoted
                            return { data: entry.data, source: 'Local Cache' }; // Return as local now
                        } catch (e) {
                            // If local storage fails (e.g. full), keep in session
                            sessionStorage.setItem(key, JSON.stringify(entry));
                            return { data: entry.data, source: 'Session Cache' };
                        }
                    } else {
                        sessionStorage.setItem(key, JSON.stringify(entry));
                        return { data: entry.data, source: 'Session Cache' };
                    }
                } else {
                    sessionStorage.removeItem(key); // Expired
                }
            }
        } catch (e) {
            console.warn("Session storage access failed", e);
        }

        return null;
    },

    set: (query: string, data: DeviceData[]) => {
        const key = cacheManager.getKey(query);
        const entry: CacheEntry = {
            data,
            timestamp: Date.now(),
            hits: 1
        };

        try {
            // Default to Session Storage
            sessionStorage.setItem(key, JSON.stringify(entry));
        } catch (e) {
            console.warn("Failed to save to session storage", e);
        }
    },

    clear: () => {
        try {
            // Clear only our keys
            Object.keys(sessionStorage).forEach(key => {
                if (key.startsWith('device_search_')) sessionStorage.removeItem(key);
            });
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('device_search_')) localStorage.removeItem(key);
            });
        } catch (e) {
            console.error("Failed to clear cache", e);
        }
    }
};
