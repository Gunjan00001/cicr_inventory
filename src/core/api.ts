/**
 * API endpoint resolution.
 * Detects localhost/LAN vs production and exposes API_BASE
 * (and CLOUD_API_FALLBACK for the failover path in main.ts). */

// Dynamic API URL for Local Development & Live Production
export const isLocalHost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '[::1]' ||
    window.location.hostname.startsWith('192.168.') ||
    window.location.hostname.startsWith('172.') ||
    window.location.hostname.startsWith('10.') ||
    window.location.hostname.endsWith('.local')
);

export let API_BASE = (() => {
    if (typeof window !== 'undefined' && window.location) {
        const host = window.location.hostname;
        // When accessed from a mobile phone or another device on LAN (e.g. 192.168.x.x:5173),
        // route directly to that same machine IP on port 5000 instead of literal localhost:5000
        if (isLocalHost && host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
            return `http://${host}:5000/api`;
        }
    }
    return (import.meta.env.VITE_API_BASE as string) ||
        (import.meta.env.VITE_API_BASE_URL as string) ||
        (isLocalHost
            ? `http://${(typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) ? 'localhost' : (typeof window !== 'undefined' ? window.location.hostname : 'localhost')}:5000/api`
            : '/api');
})();

export const CLOUD_API_FALLBACK = (import.meta.env.VITE_API_FALLBACK_URL as string) || (import.meta.env.VITE_API_BASE as string) || (import.meta.env.VITE_API_BASE_URL as string) || '/api';
