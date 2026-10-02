/**
 * Application entry point.
 *
 * Responsibilities
 * - Imports every manager module (side-effect free until boot).
 * - Installs the fetch failover guard and the 401 session-expiry hook.
 * - Exposes window helpers and boots all managers on DOMContentLoaded.
 *
 * Depends on: all feature modules, core/api, core/ui.
 * Loaded by: index.html via <script type="module" src="/src/main.ts">.
 */
import './style.css';
import { AuthManager } from './auth';
import { CLOUD_API_FALLBACK } from './core/api';
import { PasswordResetManager } from './password-reset';
import { AutoCacheManager } from './auto-cache';
import { ThemeManager } from './theme';
import { DatabaseManager } from './database';
import { ModalManager } from './modal';
import { TeamShowcaseManager } from './team-showcase';
import { ProfileViewManager } from './profile-view';
import { ProfileEditManager } from './profile-edit';
import { HardwareLedgerManager } from './hardware-ledger';
import { NotificationCenterManager } from './notification-center';
import { Background3D } from './background3d';
import { AdminManager } from './admin';
import { CartManager } from './cart';
import type { DashboardManager } from './dashboard';

// Intelligent Automatic Failover: If local backend request fails, fall back for that request without permanently poisoning API_BASE
if (typeof window !== 'undefined' && window.fetch) {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        try {
            const res = await originalFetch(input, init);
            if (res.status === 401) {
                const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
                if (urlStr && urlStr.includes('/api/auth/profile')) {
                    const token = localStorage.getItem('cicr_token');
                    if (token) {
                        console.warn('[CICR Auth] Profile session invalid or expired (401). Clearing session.');
                        if (typeof AuthManager !== 'undefined' && typeof AuthManager.handleLogout === 'function') {
                            AuthManager.handleLogout();
                        }
                    }
                }
            }
            return res;
        } catch (err: any) {
            const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
            if (urlStr && urlStr.includes(':5000/api') && !urlStr.includes('/auth/')) {
                const fallbackUrl = urlStr.replace(/https?:\/\/[^/]+:5000\/api/, CLOUD_API_FALLBACK);
                console.warn(`[CICR API] Local backend unreachable. Auto-falling back to cloud backend: ${fallbackUrl}`);
                return originalFetch(fallbackUrl, init);
            }
            throw err;
        }
    };
}

// Top-level global binding for self-service password reset modal
(window as any).openPasswordResetModal = () => {
    const modal = document.getElementById('reset-password-modal');
    if (modal) modal.classList.add('active');
    if (typeof PasswordResetManager !== 'undefined') {
        PasswordResetManager.open();
    }
};

// Extend global window interface for development debugging & admin actions
declare global {
    interface Window {
        bg3D?: Background3D;
        dashboard?: DashboardManager;
        openBulkReturnModal?: () => void;
        openPasswordResetModal?: () => void;
    }
}

// Immediate autonomous execution on module load
AutoCacheManager.init();

// ==========================================
// 7. Application Bootstrap
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    AuthManager.init();
    ThemeManager.init();
    DatabaseManager.init();
    ModalManager.init();
    PasswordResetManager.init();
    TeamShowcaseManager.init();
    ProfileViewManager.init();
    ProfileEditManager.init();
    HardwareLedgerManager.init();
    NotificationCenterManager.init();
    window.bg3D = new Background3D();
    AdminManager.init();
    DatabaseManager.updateNotificationBadges();
    DatabaseManager.startAutoSync(45000);
    lucide.createIcons();

    // High-performance scroll state tracker with zero DOM thrashing & debounced render
    let scrollEndTimer: any = null;
    window.addEventListener('scroll', () => {
        (window as any).isUserScrolling = true;
        clearTimeout(scrollEndTimer);
        scrollEndTimer = setTimeout(() => {
            (window as any).isUserScrolling = false;
            if ((window as any)._pendingDashboardRender && window.dashboard) {
                (window as any)._pendingDashboardRender = false;
                window.dashboard.renderInventory();
            }
        }, 100);
    }, { passive: true });

    // Immediate section reveal activation to eliminate 1-second scroll loading delay
    const revealElements = document.querySelectorAll('.reveal:not(section):not([id$="-view"])');
    revealElements.forEach(el => el.classList.add('active'));

    // Real-Time Sidebar Alignment Sync (Desktop Viewport-Fixed Positioning)
    const syncFixedSidebarPosition = () => {
        // Native CSS Grid sticky positioning provides zero-jitter, pixel-perfect alignment
    };

    (window as any).syncFixedSidebarPosition = syncFixedSidebarPosition;
    window.addEventListener('resize', syncFixedSidebarPosition, { passive: true });
    window.addEventListener('orientationchange', syncFixedSidebarPosition, { passive: true });
    syncFixedSidebarPosition();

    // Cross-Tab Synchronization via Window Storage Event (Issue #48)
    window.addEventListener('storage', (e: StorageEvent) => {
        if (e.key === 'cicr_token') {
            if (!e.newValue && document.body.classList.contains('authenticated')) {
                AuthManager.handleLogout();
            } else if (e.newValue && !document.body.classList.contains('authenticated')) {
                window.location.reload();
            }
        } else if (e.key === 'cicr_vault_theme' || e.key === 'cicr_theme') {
            const newTheme = e.newValue;
            if (newTheme === 'mono' || newTheme === 'light' || newTheme === 'decent') {
                ThemeManager.applyTheme(newTheme);
            }
        } else if (e.key === 'cicr_cart_items') {
            if (typeof CartManager !== 'undefined') {
                CartManager.reloadFromStorage();
            }
        }
    });
});
