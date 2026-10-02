/**
 * Shared UI utilities.
 * - Safe/idempotent Lucide icon rendering (installs the global lucide guard).
 * - escapeHtml() — the canonical HTML escaper for all innerHTML interpolation.
 * - Stock-status labels and roll-number -> branch lookup. */

import { createIcons as lucideCreateIcons, icons as lucideIcons } from 'lucide';

// Safe, universal Lucide icon creator that never throws even if options or icons are omitted
export function safeCreateIcons(options?: any) {
    const opts = options || {};
    // 1. If CDN lucide is loaded and has createIcons
    try {
        const cdnLucide = (window as any).__cdnLucide || (window as any).lucide;
        if (cdnLucide && typeof cdnLucide.createIcons === 'function' && cdnLucide.createIcons !== safeCreateIcons && (window as any).__hasCdnLucide) {
            cdnLucide.createIcons(opts);
            return;
        }
    } catch {
        // Fall back to bundled NPM
    }

    // 2. Bundled NPM icons (always has all 2,000+ Lucide icons)
    try {
        lucideCreateIcons({
            icons: lucideIcons,
            nameAttr: 'data-lucide',
            ...(opts.root ? { root: opts.root } : {})
        });
    } catch (err) {
        console.warn('Lucide icon rendering fallback notice:', err);
    }
}

if (typeof window !== 'undefined') {
    (window as any).__rawLucideCreateIcons = safeCreateIcons;
    (window as any).lucide = {
        createIcons: (options?: any) => {
            try {
                safeCreateIcons(options);
            } catch (err) {
                console.warn('Lucide createIcons notice:', err);
            }
        }
    };
}

// Safe, idempotent Lucide icon renderer that NEVER destroys already-rendered SVGs
export function renderLucideIcons(root?: HTMLElement | Document | null) {
    const target = root || document;

    // Only select elements that need icon creation (not already rendered SVGs)
    const placeholders = target.querySelectorAll('i[data-lucide], span[data-lucide], [data-lucide]:not(svg)');
    if (placeholders.length === 0) return;

    try {
        safeCreateIcons({
            root: target instanceof HTMLElement ? target : undefined
        });
    } catch {
        try { safeCreateIcons(); } catch {}
    }

    // Strip data-lucide from rendered SVGs to prevent future calls from destroying/re-rendering them
    const renderedSvgs = target.querySelectorAll('svg[data-lucide]');
    renderedSvgs.forEach(svg => {
        svg.removeAttribute('data-lucide');
        svg.setAttribute('data-lucide-rendered', 'true');
    });
}

// Ultra-fast inline SVG generator for cards to avoid synchronous Lucide DOM queries
export function getFastIconSvg(name: string, size: number = 13): string {
    const s = `${size}px`;
    switch (name) {
        case 'map-pin':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:${s};height:${s};vertical-align:middle;" data-lucide-rendered="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>`;
        case 'shopping-bag':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:${s};height:${s};vertical-align:middle;" data-lucide-rendered="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`;
        case 'check':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:${s};height:${s};vertical-align:middle;" data-lucide-rendered="true"><polyline points="20 6 9 17 4 12"/></svg>`;
        case 'trash-2':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:${s};height:${s};vertical-align:middle;" data-lucide-rendered="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;
        case 'clock':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:${s};height:${s};vertical-align:middle;" data-lucide-rendered="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
        case 'package-check':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:${s};height:${s};vertical-align:middle;" data-lucide-rendered="true"><path d="m16 16 2 2 4-4"/><path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
        case 'arrow-right':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:${s};height:${s};vertical-align:middle;" data-lucide-rendered="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;
        case 'corner-up-left':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:${s};height:${s};vertical-align:middle;" data-lucide-rendered="true"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`;
        case 'minus':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:${s};height:${s};vertical-align:middle;" data-lucide-rendered="true"><path d="M5 12h14"/></svg>`;
        case 'plus':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:${s};height:${s};vertical-align:middle;" data-lucide-rendered="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;
        case 'calendar':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:${s};height:${s};vertical-align:middle;" data-lucide-rendered="true"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`;
        case 'link':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:${s};height:${s};vertical-align:middle;" data-lucide-rendered="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
        default:
            return `<i data-lucide="${name}"></i>`;
    }
}

// Intercept lucide.createIcons globally so ANY third-party or legacy call is automatically safe
if (typeof window !== 'undefined') {
    const installLucideGuard = () => {
        (window as any).lucide = (window as any).lucide || {};
        (window as any).lucide.createIcons = (options?: any) => {
            const root = options && options.root ? options.root : undefined;
            renderLucideIcons(root);
        };
    };
    installLucideGuard();
    window.addEventListener('DOMContentLoaded', installLucideGuard);
}

/**
 * Universal HTML escape helper that neutralizes: &, <, >, ", ', and `
 * Prevents attribute breakout and DOM injection.
 */
export function escapeHtml(str: any): string {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/`/g, '&#96;');
}

export type UserRole = 'ADMIN' | 'MEMBER';

/**
 * Resolves component stock status per specification:
 * - If total <= 1 (quantity = 1):
 *     available > 0  => "Available" (status-available)
 *     available <= 0 => "Not Available" (status-out)
 * - If total > 1:
 *     available <= 0 => "Not Available" (status-out)
 *     available > total / 2 => "Available" (status-available)
 *     available <= total / 2 => "Low Reserve" (status-low)
 */
export function getItemStockStatus(totalQty: number, availableQty: number): {
    text: string;
    class: 'status-available' | 'status-low' | 'status-out';
} {
    const total = Number(totalQty) || 0;
    const available = Number(availableQty) || 0;

    if (total <= 1) {
        if (available > 0) {
            return { text: 'Available', class: 'status-available' };
        }
        return { text: 'Not Available', class: 'status-out' };
    }

    if (available <= 0) {
        return { text: 'Not Available', class: 'status-out' };
    }
    if (available > total / 2) {
        return { text: 'Available', class: 'status-available' };
    }
    return { text: 'Low Reserve', class: 'status-low' };
}

// ==========================================
// Admin Member Management & Approval System
// ==========================================
export function getStudentBranch(rollVal?: string | null, explicitBranch?: string | null): string {
    if (explicitBranch && explicitBranch.trim() && !explicitBranch.includes('NaN')) {
        const cleanExp = explicitBranch.trim().toUpperCase();
        if (cleanExp !== 'JIIT MEMBER' && cleanExp !== 'ACTIVE' && cleanExp !== 'BATCH: ACTIVE') {
            return cleanExp;
        }
    }
    const clean = (rollVal || '').trim();
    if (!clean) return 'CSE';
    if (clean.includes('103') || clean.includes('0103')) return 'CSE';
    if (clean.includes('102') || clean.includes('0102')) return 'IT';
    if (clean.includes('121') || clean.includes('0121')) return 'ECE';
    if (clean.includes('114') || clean.includes('0114')) return 'BT';
    if (clean.includes('101') || clean.includes('0101')) return 'CSE';
    return 'CSE';
}
