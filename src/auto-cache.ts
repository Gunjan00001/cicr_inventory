/**
 * AutoCacheManager — one-shot startup cache sanitizer.
 * Clears stale cached collections while preserving auth keys. Runs once on load. */

// ==========================================
// Autonomous Silent Auto-Cache Sanitizer
// Clears stale caches on visit with ZERO popups or alerts
// ==========================================
export class AutoCacheManager {
    private static readonly PRESERVED_AUTH_KEYS = new Set([
        'cicr_token',
        'cicr_user',
        'cicr_role',
        'cicr_auth',
        'cicr_last_active',
        'cicr_theme',
        'cicr_vault_theme',
        'cicr_read_notifs',
        'cicr_cart_items',
        'cicr_user_avatar',
        'cicr_profile_override'
    ]);

    public static init(): void {
        try {
            // 1. Silently purge Service Worker & PWA cache storage
            if (typeof window !== 'undefined' && 'caches' in window) {
                window.caches.keys().then(keys => {
                    keys.forEach(key => window.caches.delete(key));
                }).catch(() => {});
            }

            // 2. Silently unregister stale service worker threads
            if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(registrations => {
                    registrations.forEach(r => r.unregister().catch(() => {}));
                }).catch(() => {});
            }

            // 3. Clear temporary sessionStorage to ensure crisp and fresh state
            try {
                sessionStorage.clear();
            } catch (_) {}

            // 4. Silently clear obsolete localStorage cache keys while strictly preserving credentials
            if (typeof localStorage !== 'undefined') {
                const keysToRemove: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith('cicr_') && !this.PRESERVED_AUTH_KEYS.has(key)) {
                        if (
                            key.includes('cache') ||
                            key.includes('temp') ||
                            key === 'cicr_dismissed_requests' ||
                            key === 'cicr_fresh_epoch'
                        ) {
                            keysToRemove.push(key);
                        }
                    }
                }
                keysToRemove.forEach(k => {
                    try { localStorage.removeItem(k); } catch (_) {}
                });
            }

            // 5. Clean resource timings to conserve RAM and enhance fluidity
            if (typeof performance !== 'undefined' && performance.clearResourceTimings) {
                performance.clearResourceTimings();
            }
        } catch (_) {
            // Always failsafe and completely silent - zero popups or alerts
        }
    }
}
