/**
 * DashboardManager — main application shell and section router.
 *
 * Responsibilities
 * - switchSection() navigation between dashboard/inventory/profile/admin/logs.
 * - Renders the inventory grid, filters, stats bubbles and dashboard clock.
 * - Manages the mobile sidebar.
 *
 * Exposed as window.dashboard. Depends on: cart, auth, modal, admin, theme,
 * hardware-ledger, team-showcase, profile-view, toast, core/ui. */

import { CartManager } from './cart';
import { AuthManager } from './auth';
import { ModalManager } from './modal';
import { PasswordResetManager } from './password-reset';
import { escapeHtml, getFastIconSvg, getItemStockStatus, renderLucideIcons } from './core/ui';
import { ToastManager } from './toast';
import { AdminManager } from './admin';
import { HardwareLedgerManager } from './hardware-ledger';
import { TeamShowcaseManager } from './team-showcase';
import { ProfileViewManager } from './profile-view';
import { ThemeManager } from './theme';
import { inventory } from './core/state';
import { DatabaseManager } from './database';
import type { InventoryItem } from './types';

// ==========================================
// 4. Dashboard Manager Class
// ==========================================
export class DashboardManager {
    private activeCategory = 'all';
    public searchQuery = '';
    public lastRenderedFingerprint = '';
    private listenersInitialized = false;
    private mobileSidebarOpen = false;

    private appContainer: HTMLElement;
    private inventoryGrid: HTMLElement;
    private noResults: HTMLElement;
    private searchInput: HTMLInputElement;
    private clearSearchBtn: HTMLElement;
    private resultsCount: HTMLElement;

    private statTotal: HTMLElement;
    private statAvailable: HTMLElement | null;
    private statBorrowed: HTMLElement;
    private statLow: HTMLElement;
    private statOut: HTMLElement;
    private mobileSidebarToggle: HTMLButtonElement | null;
    private mobileSidebarBackdrop: HTMLElement | null;

    public activeStockFilter: 'all' | 'available' | 'borrowed' | 'low' | 'out' = 'all';
    private activeStockPill: HTMLElement | null = null;

    private clockTimerId: any = null;

    constructor() {
        this.appContainer = document.getElementById('app-container')!;
        this.mobileSidebarToggle = document.getElementById('mobile-sidebar-toggle') as HTMLButtonElement | null;
        this.mobileSidebarBackdrop = document.getElementById('mobile-sidebar-backdrop');
        this.inventoryGrid = document.getElementById('inventory-grid')!;
        this.noResults = document.getElementById('no-results')!;
        this.searchInput = document.getElementById('search-input') as HTMLInputElement;
        this.clearSearchBtn = document.getElementById('clear-search')!;
        this.resultsCount = document.getElementById('results-count')!;
        this.activeStockPill = document.getElementById('active-stock-pill');

        this.statTotal = document.getElementById('stat-total')!;
        this.statAvailable = document.getElementById('stat-available');
        this.statBorrowed = document.getElementById('stat-borrowed')!;
        this.statLow = document.getElementById('stat-low')!;
        this.statOut = document.getElementById('stat-out')!;

        this.init();
        this.loadInventory();
    }

    public init() {
        this.renderStats();
        this.renderInventory();
        if (typeof CartManager !== 'undefined') {
            CartManager.init();
        }
        AuthManager.updateAdminVisibility(ModalManager.getCurrentRole());
        if (!this.listenersInitialized) {
            this.setupEventListeners();
            this.listenersInitialized = true;
        }
    }

    static formatLogDateTime(raw: string | Date | undefined): { dateStr: string; timeStr: string } {
        if (!raw) {
            const now = new Date();
            return {
                dateStr: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
                timeStr: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\u202f/g, ' ').toUpperCase()
            };
        }

        let d: Date | null = null;
        const s = String(raw).trim();
        const hasTime = s.includes(':');

        if (raw instanceof Date) {
            d = raw;
        } else if (hasTime) {
            const isoCandidate = s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s;
            const parsed = new Date(isoCandidate);
            if (!isNaN(parsed.getTime())) {
                d = parsed;
            }
        }

        if (d && !isNaN(d.getTime())) {
            const dateStr = d.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            }); // e.g. "13 Sep 2026"
            const timeStr = d.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            }).replace(/\u202f/g, ' ').toUpperCase(); // e.g. "03:13 PM"
            return { dateStr, timeStr };
        }

        // Check if date-only format YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            const [year, month, day] = s.split('-');
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const mIdx = parseInt(month, 10) - 1;
            if (mIdx >= 0 && mIdx < 12) {
                return {
                    dateStr: `${parseInt(day, 10)} ${monthNames[mIdx]} ${year}`,
                    timeStr: ''
                };
            }
        }

        // Fallback for strings with T or space
        if (s.includes('T') || s.includes(' ')) {
            const sep = s.includes('T') ? 'T' : ' ';
            const [datePart, timePart] = s.split(sep);
            let formattedDate = datePart;
            if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
                const [year, month, day] = datePart.split('-');
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const mIdx = parseInt(month, 10) - 1;
                if (mIdx >= 0 && mIdx < 12) {
                    formattedDate = `${parseInt(day, 10)} ${monthNames[mIdx]} ${year}`;
                }
            }
            return {
                dateStr: formattedDate || s,
                timeStr: timePart ? timePart.slice(0, 5) : ''
            };
        }

        return { dateStr: s, timeStr: '' };
    }

    public setMobileSidebar(open: boolean) {
        const shouldOpen = open && window.innerWidth <= 900.98;
        this.mobileSidebarOpen = shouldOpen;
        this.appContainer.classList.toggle('sidebar-open', shouldOpen);
        this.mobileSidebarToggle?.setAttribute('aria-expanded', String(shouldOpen));
        document.body.style.overflow = shouldOpen ? 'hidden' : '';
    }

    private startClock() {
        if (this.clockTimerId) clearInterval(this.clockTimerId);

        const clockEl = document.getElementById('dashboard-clock');
        const dateEl = document.getElementById('dashboard-date');
        const greetingEl = document.getElementById('dashboard-greeting');
        let lastDateStr = '';
        let lastGreetingStr = '';

        const updateTime = () => {
            const now = new Date();

            // Format time: hh:mm:ss am/pm
            let hours = now.getHours();
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // the hour '0' should be '12'
            const formattedHours = String(hours).padStart(2, '0');
            const timeStr = `${formattedHours}:${minutes}:${seconds} ${ampm}`;

            if (clockEl && clockEl.textContent !== timeStr) {
                clockEl.textContent = timeStr;
            }

            // Update date only when changed
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            const dateStr = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
            if (dateStr !== lastDateStr) {
                lastDateStr = dateStr;
                if (dateEl) dateEl.textContent = dateStr;
            }

            // Update time-of-day greeting only when hour or user changes
            const curHour = now.getHours();
            let timeOfDay = 'evening';
            if (curHour < 12) {
                timeOfDay = 'morning';
            } else if (curHour < 17) {
                timeOfDay = 'afternoon';
            }

            const username = localStorage.getItem('cicr_auth') || 'Operator';
            const greetingStr = `Good ${timeOfDay}, ${username}`;
            if (greetingStr !== lastGreetingStr) {
                lastGreetingStr = greetingStr;
                if (greetingEl) greetingEl.textContent = greetingStr;
            }
        };

        updateTime();
        this.clockTimerId = setInterval(updateTime, 1000);
    }

    private setupEventListeners() {
        // Ticking Clock and dynamic greeting initialization
        this.startClock();

        const closeMobileSidebar = () => this.setMobileSidebar(false);
        const toggleMobileSidebar = () => this.setMobileSidebar(!this.mobileSidebarOpen);

        this.mobileSidebarToggle?.addEventListener('click', () => {
            toggleMobileSidebar();
        });

        this.mobileSidebarBackdrop?.addEventListener('click', () => {
            closeMobileSidebar();
        });

        const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
        sidebarCloseBtn?.addEventListener('click', () => {
            closeMobileSidebar();
        });

        const sidebarResetPassBtn = document.getElementById('sidebar-reset-pass-btn');
        sidebarResetPassBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeMobileSidebar();
            PasswordResetManager.open();
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 900) {
                closeMobileSidebar();
            }
        }, { passive: true });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeMobileSidebar();

                // Close notification dropdown
                const notifDropdown = document.getElementById('header-notif-dropdown');
                if (notifDropdown && notifDropdown.style.display !== 'none') {
                    notifDropdown.style.display = 'none';
                    document.getElementById('header-notif-btn')?.setAttribute('aria-expanded', 'false');
                }

                // Close all active modals
                ModalManager.closeAll();

                const signoutModal = document.getElementById('signout-confirm-modal');
                if (signoutModal && signoutModal.classList.contains('active')) {
                    signoutModal.style.opacity = '0';
                    setTimeout(() => {
                        signoutModal.classList.remove('active');
                        signoutModal.style.display = 'none';
                    }, 250);
                }
            }

            // Press '/' to search catalog when not typing in an input/textarea and no modal is active
            if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
                const anyModalActive = document.querySelector('.modal-overlay.active');
                if (!anyModalActive) {
                    e.preventDefault();
                    if ((window as any).switchSection) {
                        (window as any).switchSection('inventory-view');
                    }
                    const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
                    if (searchInput) {
                        searchInput.focus();
                        searchInput.select();
                    }
                }
            }
        });

        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }

        // 1. Sidebar Nav click listeners
        const sidebarLinks = document.querySelectorAll('.sidebar-nav-link');
        const sections = document.querySelectorAll('#app-main-content > section');
        const breadcrumbActive = document.getElementById('breadcrumb-current');

        const switchSection = (targetId: string) => {
            sections.forEach(node => {
                const sec = node as HTMLElement;
                if (sec.id === targetId) {
                    sec.classList.add('active');
                    sec.style.setProperty('display', (sec.id === 'admin-view' || sec.id === 'dashboard-view') ? 'flex' : 'block', 'important');
                } else {
                    sec.classList.remove('active');
                    sec.style.setProperty('display', 'none', 'important');
                }
            });

            // Reliable scroll reset to top on section transition to prevent content overlap
            try {
                window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
                document.documentElement.scrollTop = 0;
                document.body.scrollTop = 0;
                const mainViewport = document.querySelector('.main-viewport-wrapper') || document.querySelector('.main-viewport') || document.querySelector('.main-content');
                if (mainViewport) {
                    (mainViewport as HTMLElement).scrollTop = 0;
                    (mainViewport as HTMLElement).scrollLeft = 0;
                }
            } catch (_) {}

            // Toggle body classes for current view
            document.body.classList.toggle('view-dashboard-view', targetId === 'dashboard-view');
            document.body.classList.toggle('view-developers-view', targetId === 'developers-view');
            document.body.classList.toggle('view-profile-view', targetId === 'profile-view');
            document.body.classList.toggle('view-admin-view', targetId === 'admin-view');
            document.body.classList.toggle('view-inventory-view', targetId === 'inventory-view');
            document.body.classList.toggle('view-hardware-logs-view', targetId === 'hardware-logs-view');

            // Top navbar cart button is visible STRICTLY on the inventory page
            const headerCartWrapper = document.querySelector('.header-cart-wrapper') as HTMLElement | null;
            if (headerCartWrapper) {
                headerCartWrapper.style.setProperty('display', (targetId === 'inventory-view') ? 'inline-flex' : 'none', 'important');
            }

            // Sync floating cart capsule FAB (strictly on inventory page)
            const floatingFab = document.getElementById('floating-cart-fab');
            if (floatingFab) {
                floatingFab.style.display = (targetId === 'inventory-view') ? 'block' : 'none';
            }

            // Refresh Lucide icons efficiently without re-parsing whole DOM
            renderLucideIcons();

            // Update sidebar link active class
            sidebarLinks.forEach(link => {
                const target = (link as HTMLElement).dataset.target;
                if (target === targetId) {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            });

            // Auto-expand parent section if it's currently collapsed so active link is visible
            const currentActiveLink = document.querySelector(`.sidebar-nav-link[data-target="${targetId}"]`);
            if (currentActiveLink) {
                const parentSection = currentActiveLink.closest('.sidebar-section');
                if (parentSection && parentSection.classList.contains('is-collapsed')) {
                    parentSection.classList.remove('is-collapsed');
                    const hdr = parentSection.querySelector('.sidebar-section-header');
                    if (hdr) hdr.setAttribute('aria-expanded', 'true');
                }
            }

            // Update breadcrumbs text
            if (breadcrumbActive) {
                const nameMap: Record<string, string> = {
                    'dashboard-view': 'DASHBOARD',
                    'inventory-view': 'INVENTORY',
                    'hardware-logs-view': 'LOGS',
                    'developers-view': 'MEET THE DEVELOPERS',
                    'profile-view': 'MY PROFILE',
                    'admin-view': 'ADMIN MANAGEMENT'
                };
                breadcrumbActive.textContent = nameMap[targetId] || targetId.toUpperCase();
            }

            // If switching to inventory-view, trigger render/refresh
            if (targetId === 'inventory-view') {
                this.renderInventory();
            }

            // If switching to admin-view, load admin data (ADMIN ONLY)
            if (targetId === 'admin-view') {
                if (ModalManager.getCurrentRole() !== 'ADMIN') {
                    ToastManager.show('Access Restricted', 'Admin privileges required to access Admin Portal.', 'warning');
                    switchSection('dashboard-view');
                    return;
                }
                AdminManager.loadUsers(true);
                AdminManager.loadHardwareRequests(true);
                AdminManager.loadAuditLogs();
            }

            // If switching to hardware-logs-view, render logs & component history (ADMIN ONLY)
            if (targetId === 'hardware-logs-view') {
                if (ModalManager.getCurrentRole() !== 'ADMIN') {
                    ToastManager.show('Access Restricted', 'Admin privileges required to access Activity Logs.', 'warning');
                    switchSection('dashboard-view');
                    return;
                }
                if (typeof HardwareLedgerManager !== 'undefined') {
                    HardwareLedgerManager.render();
                }
            }

            // If switching to developers-view, render team showcase with Team as default
            if (targetId === 'developers-view') {
                if (typeof TeamShowcaseManager !== 'undefined') {
                    TeamShowcaseManager.init();
                    TeamShowcaseManager.setCategory('team');
                }
            }

            // If switching to profile-view, render aesthetic operator profile HUD
            if (targetId === 'profile-view') {
                if (typeof ProfileViewManager !== 'undefined') {
                    ProfileViewManager.render();
                }
            }

            closeMobileSidebar();
            (window as any).syncFixedSidebarPosition?.();
        };

        (this as any).switchSection = switchSection;
        (window as any).switchSection = switchSection;
        switchSection('dashboard-view');

        sidebarLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const target = (link as HTMLElement).dataset.target;
                if (target) {
                    switchSection(target);
                    closeMobileSidebar();
                }
            });
        });

        // Interactive Collapsible Sidebar Sections (CORE WORKSPACE, MISCELLANEOUS)
        const sidebarSectionHeaders = document.querySelectorAll('.sidebar-section > .sidebar-section-header');
        sidebarSectionHeaders.forEach(header => {
            if (header.tagName.toLowerCase() === 'summary') return;
            header.setAttribute('role', 'button');
            header.setAttribute('tabindex', '0');
            header.setAttribute('aria-expanded', 'true');

            const toggleSection = () => {
                const section = header.parentElement;
                if (!section || !section.classList.contains('sidebar-section')) return;
                const isCollapsed = section.classList.toggle('is-collapsed');
                header.setAttribute('aria-expanded', String(!isCollapsed));
            };

            header.addEventListener('click', (e) => {
                e.preventDefault();
                toggleSection();
            });

            header.addEventListener('keydown', (e: Event) => {
                const keyEvent = e as KeyboardEvent;
                if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                    keyEvent.preventDefault();
                    toggleSection();
                }
            });
        });

        // Sync Vault Dropdown aria-expanded state on toggle
        const vaultDropdown = document.getElementById('sidebar-vault-dropdown') as HTMLDetailsElement | null;
        const vaultHeader = document.getElementById('sidebar-header-vault');
        if (vaultDropdown && vaultHeader) {
            vaultDropdown.addEventListener('toggle', () => {
                vaultHeader.setAttribute('aria-expanded', String(vaultDropdown.open));
            });
        }

        // Interactive Breadcrumb Redirecting Buttons
        const breadcrumbHome = document.getElementById('breadcrumb-home');
        if (breadcrumbHome) {
            breadcrumbHome.addEventListener('click', (e) => {
                e.preventDefault();
                switchSection('dashboard-view');
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }
        if (breadcrumbActive) {
            breadcrumbActive.addEventListener('click', (e) => {
                e.preventDefault();
                const activeSection = document.querySelector('#app-main-content > section.active');
                if (activeSection) {
                    activeSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
        }

        // Floating Navbar component logs, developers & profile links
        const navHwLogs = document.getElementById('nav-hardware-logs');
        if (navHwLogs) {
            navHwLogs.addEventListener('click', () => switchSection('hardware-logs-view'));
        }
        const navDevs = document.getElementById('nav-developers');
        if (navDevs) {
            navDevs.addEventListener('click', () => switchSection('developers-view'));
        }
        const navProfile = document.getElementById('nav-profile');
        if (navProfile) {
            navProfile.addEventListener('click', () => switchSection('profile-view'));
        }

        // 2. Dashboard action pills switching listeners
        const pillAdmin = document.getElementById('dashboard-pill-admin');
        if (pillAdmin) {
            pillAdmin.addEventListener('click', () => {
                ModalManager.open('add-item-modal');
            });
        }
        const pillCommunity = document.getElementById('dashboard-pill-community');
        if (pillCommunity) {
            pillCommunity.addEventListener('click', () => {
                ModalManager.openAboutModal();
            });
        }

        // 3. Dashboard card switching listeners
        const cardVault = document.getElementById('dash-card-vault');
        if (cardVault) {
            cardVault.addEventListener('click', () => switchSection('inventory-view'));
        }
        const cardLogs = document.getElementById('dash-card-logs');
        if (cardLogs) {
            cardLogs.addEventListener('click', () => {
                ModalManager.openLogsDrawer();
            });
        }
        const cardHwLogs = document.getElementById('dash-card-hardware-logs');
        if (cardHwLogs) {
            cardHwLogs.addEventListener('click', () => switchSection('hardware-logs-view'));
        }
        const cardDevs = document.getElementById('dash-card-devs');
        if (cardDevs) {
            cardDevs.addEventListener('click', () => switchSection('developers-view'));
        }
        const cardProfile = document.getElementById('dash-card-profile');
        if (cardProfile) {
            cardProfile.addEventListener('click', () => switchSection('profile-view'));
        }
        const cardAdmin = document.getElementById('dash-card-admin');
        if (cardAdmin) {
            cardAdmin.addEventListener('click', () => switchSection('admin-view'));
        }
        const cardDiscussions = document.getElementById('dash-card-discussions');
        if (cardDiscussions) {
            cardDiscussions.addEventListener('click', () => {
                ModalManager.openAboutModal();
            });
        }
        const cardRecruitment = document.getElementById('dash-card-recruitment');
        if (cardRecruitment) {
            cardRecruitment.addEventListener('click', () => {
                ModalManager.openAboutModal();
            });
        }

        // 4. Notifications & History Drawer trigger
        const notifBtn = document.getElementById('sidebar-notifications-btn');
        if (notifBtn) {
            notifBtn.addEventListener('click', () => {
                closeMobileSidebar();
                const isLoggedIn = Boolean(localStorage.getItem('cicr_token') || localStorage.getItem('cicr_auth'));
                if (!isLoggedIn) {
                    AuthManager.showLoginOverlay();
                    document.getElementById('tab-login-btn')?.click();
                    ToastManager.show('Authentication Required', 'Please sign in to view your hardware requests and approval status.', 'info');
                    return;
                }
                const role = ModalManager.getCurrentRole();
                if (role !== 'ADMIN') {
                    ModalManager.activeNotifTab = 'requests';
                }
                ModalManager.openLogsDrawer();
            });
        }

        // 5. Sidebar profile box click -> Profile view
        const sidebarProfileBox = document.getElementById('sidebar-profile-widget');
        if (sidebarProfileBox) {
            sidebarProfileBox.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).closest('#sidebar-reset-pass-btn') || (e.target as HTMLElement).closest('#sidebar-logout-btn')) return;
                switchSection('profile-view');
                closeMobileSidebar();
            });
        }

        // 6. Password Reset / Change Key trigger
        const resetPassBtn = document.getElementById('sidebar-reset-pass-btn');
        if (resetPassBtn && !resetPassBtn.dataset.bound) {
            resetPassBtn.dataset.bound = 'true';
            resetPassBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeMobileSidebar();
                PasswordResetManager.open();
            });
        }

        // 6. Profile Logout button
        const logoutBtn = document.getElementById('sidebar-logout-btn');
        if (logoutBtn && !logoutBtn.dataset.bound) {
            logoutBtn.dataset.bound = 'true';
            logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof AuthManager !== 'undefined' && typeof AuthManager.promptLogout === 'function') {
                    AuthManager.promptLogout();
                } else {
                    const oldLogoutBtn = document.getElementById('nav-logout');
                    if (oldLogoutBtn) {
                        oldLogoutBtn.click();
                    } else {
                        localStorage.removeItem('cicr_auth');
                        window.location.reload();
                    }
                }
            });
        }

        // 7. Inventory Search Input listeners (with 75ms debounce to prevent input lag)
        let searchDebounceTimer: any = null;
        this.searchInput.addEventListener('input', (e) => {
            const val = (e.target as HTMLInputElement).value;
            this.clearSearchBtn.style.display = val.trim() ? 'block' : 'none';
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                this.searchQuery = val.toLowerCase().trim();
                this.renderInventory();
            }, 75);
        });

        this.clearSearchBtn.addEventListener('click', () => {
            clearTimeout(searchDebounceTimer);
            this.searchInput.value = '';
            this.searchQuery = '';
            this.clearSearchBtn.style.display = 'none';
            this.renderInventory();
            this.searchInput.focus();
        });

        // 8. Sync active category states between sidebar items and tag pills
        const sidebarItems = document.querySelectorAll('.sidebar-item');
        const tagPills = document.querySelectorAll('.tag-pill');

        const selectCategory = (category: string) => {
            this.activeCategory = category;

            sidebarItems.forEach(item => {
                const itemCat = (item as HTMLElement).dataset.category || 'all';
                if (itemCat === category) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });

            tagPills.forEach(pill => {
                const pillCat = (pill as HTMLElement).dataset.category || 'all';
                if (pillCat === category) {
                    pill.classList.add('active');
                } else {
                    pill.classList.remove('active');
                }
            });

            this.renderInventory();
        };

        sidebarItems.forEach(item => {
            item.addEventListener('click', () => {
                const cat = (item as HTMLElement).dataset.category || 'all';
                selectCategory(cat);
                switchSection('inventory-view');
                closeMobileSidebar();
            });
        });

        tagPills.forEach(pill => {
            pill.addEventListener('click', () => {
                const cat = (pill as HTMLElement).dataset.category || 'all';
                selectCategory(cat);
            });
        });

        // 9. Theme Switcher Buttons listeners
        const themeBtnLight = document.getElementById('theme-btn-light');
        const themeBtnMono = document.getElementById('theme-btn-mono');

        themeBtnLight?.addEventListener('click', () => ThemeManager.applyTheme('light'));
        themeBtnMono?.addEventListener('click', () => ThemeManager.applyTheme('mono'));

        // 10. Interactive Stat Bubbles Filter Listeners (Total, Active Loans, Low Reserves, Out of Stock)
        const statBubbles = document.querySelectorAll('.stat-bubble-new');
        statBubbles.forEach(bubble => {
            bubble.addEventListener('click', () => {
                const target = (bubble as HTMLElement).dataset.stockFilter || 'all';
                if (this.activeStockFilter === target && target !== 'all') {
                    this.activeStockFilter = 'all';
                } else {
                    this.activeStockFilter = target as any;
                }
                this.updateStatBubbleUI();
                this.renderInventory(true);
            });
        });
    }

    public updateStatBubbleUI() {
        const statBubbles = document.querySelectorAll('.stat-bubble-new');
        statBubbles.forEach(bubble => {
            const f = (bubble as HTMLElement).dataset.stockFilter || 'all';
            if (this.activeStockFilter === 'all') {
                bubble.classList.remove('active-filter');
            } else if (f === this.activeStockFilter) {
                bubble.classList.add('active-filter');
            } else {
                bubble.classList.remove('active-filter');
            }
        });

        if (this.activeStockPill) {
            if (this.activeStockFilter === 'all') {
                this.activeStockPill.style.display = 'none';
                this.activeStockPill.innerHTML = '';
            } else {
                const labels: Record<string, string> = {
                    available: 'Vaults Available',
                    borrowed: 'Active Loans',
                    low: 'Low Reserves (≤ 50%)',
                    out: 'Out of Stock'
                };
                const filterText = labels[this.activeStockFilter] || this.activeStockFilter;
                this.activeStockPill.style.display = 'inline-flex';
                this.activeStockPill.innerHTML = `
                    <span class="active-stock-pill-text"><i data-lucide="filter"></i> ${filterText}</span>
                    <button class="btn-clear-stock-filter" title="Clear Stock Filter">✕</button>
                `;
                const clearBtn = this.activeStockPill.querySelector('.btn-clear-stock-filter');
                clearBtn?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.activeStockFilter = 'all';
                    this.updateStatBubbleUI();
                    this.renderInventory(true);
                });
                lucide.createIcons();
            }
        }
    }

    public renderStats() {
        let totalUnits = 0;
        let availableUnits = 0;
        let checkedOutQty = 0;
        let availableItemsCount = 0;
        let lowStockCount = 0;
        let outOfStockCount = 0;

        const role = ModalManager.getCurrentRole();
        const isAdmin = role === 'ADMIN';

        inventory.forEach(item => {
            const total = Number(item.quantity) || 0;
            totalUnits += total;

            const currentAvailable = typeof item.availableQuantity === 'number'
                ? Math.min(total, Math.max(0, item.availableQuantity))
                : total;

            availableUnits += currentAvailable;
            if (currentAvailable > 0) {
                availableItemsCount++;
            }

            // An item can only have active loans if available < total in the vault
            const maxPossibleLoans = Math.max(0, total - currentAvailable);

            // Clean up any stale records if all units are returned in inventory
            if (maxPossibleLoans === 0 && Array.isArray(item.borrowedBy)) {
                item.borrowedBy.forEach((r: any) => {
                    r.returned = true;
                    r.status = 'RETURNED';
                });
            }

            const activeBorrows = (item.borrowedBy || []).filter((r: any) => !r.returned && (r as any).status !== 'RETURNED' && (r as any).status !== 'REJECTED');

            if (isAdmin) {
                checkedOutQty += maxPossibleLoans;
            } else {
                const memberLoans = activeBorrows.filter((r: any) => ModalManager.isUserLoanMatch(r));
                checkedOutQty += Math.min(maxPossibleLoans, memberLoans.reduce((sum, rec) => sum + rec.qty, 0));
            }

            const status = getItemStockStatus(item.quantity, currentAvailable);
            if (status.class === 'status-out') {
                outOfStockCount++;
            } else if (status.class === 'status-low') {
                lowStockCount++;
            }
        });

        // Total Vaulted is the total inventory units vaulted (173), Vaults Available is the total units available.
        // Consistency across user and admin accounts per user request ("check 2nd photo..its showing 54 vault in user account..nd 173 in admin acc..fix it")
        const totalStr = String(totalUnits);
        const availableStr = String(availableUnits);
        const borrowedStr = String(checkedOutQty);
        const lowStr = String(lowStockCount);
        const outStr = String(outOfStockCount);

        if (this.statTotal && this.statTotal.innerText !== totalStr) this.statTotal.innerText = totalStr;
        if (this.statAvailable && this.statAvailable.innerText !== availableStr) this.statAvailable.innerText = availableStr;
        if (this.statBorrowed && this.statBorrowed.innerText !== borrowedStr) this.statBorrowed.innerText = borrowedStr;
        if (this.statLow && this.statLow.innerText !== lowStr) this.statLow.innerText = lowStr;
        if (this.statOut && this.statOut.innerText !== outStr) this.statOut.innerText = outStr;
    }

    public renderInventory(force = false) {
        const role = ModalManager.getCurrentRole();
        const isAdmin = role === 'ADMIN';

        const q = this.searchQuery;
        const filtered = inventory.filter(item => {
            if (this.activeCategory !== 'all' && item.category !== this.activeCategory) {
                return false;
            }

            if (q) {
                const matchesSearch = item.name.toLowerCase().includes(q) ||
                    item.specs.toLowerCase().includes(q) ||
                    item.location.toLowerCase().includes(q) ||
                    (Array.isArray(item.tags) && item.tags.some((t: string) => t.toLowerCase().includes(q)));
                if (!matchesSearch) return false;
            }

            const activeBorrows = (item.borrowedBy || []).filter((r: any) => !r.returned && (r as any).status !== 'RETURNED' && (r as any).status !== 'REJECTED');
            const borrowedSum = activeBorrows.reduce((sum, rec) => sum + rec.qty, 0);
            const totalQty = Number(item.quantity) || 0;
            const available = typeof item.availableQuantity === 'number'
                ? Math.min(totalQty, Math.max(0, item.availableQuantity))
                : Math.max(0, totalQty - borrowedSum);

            if (this.activeStockFilter === 'available') {
                return available > 0;
            } else if (this.activeStockFilter === 'borrowed') {
                if (isAdmin) {
                    return borrowedSum > 0 || (typeof item.availableQuantity === 'number' && item.availableQuantity < totalQty);
                } else {
                    return activeBorrows.some((r: any) => ModalManager.isUserLoanMatch(r));
                }
            } else if (this.activeStockFilter === 'low') {
                const status = getItemStockStatus(item.quantity, available);
                return status.class === 'status-low';
            } else if (this.activeStockFilter === 'out') {
                const status = getItemStockStatus(item.quantity, available);
                return status.class === 'status-out';
            }

            return true;
        });

        const cartKey = (typeof CartManager !== 'undefined')
            ? CartManager.getItems().map((c: any) => `${c.id}:${c.quantity}`).join(',')
            : '';
        const currentFingerprint = `${role}_${this.activeCategory}_${this.activeStockFilter}_${this.searchQuery}_${cartKey}_` +
            filtered.map(i => `${i.id}_${i.availableQuantity}_${i.quantity}_${i.name}_${i.location}_${(i.borrowedBy || []).map((b: any) => `${b.id}:${b.status}:${b.qty}`).join(',')}`).join('|');

        if (!force && this.lastRenderedFingerprint === currentFingerprint && this.inventoryGrid.children.length === filtered.length) {
            // Inventory data and filters have not changed; do NOT destroy/re-render DOM cards to prevent items popping up repeatedly
            return;
        }

        this.lastRenderedFingerprint = currentFingerprint;

        this.inventoryGrid.innerHTML = '';

        if (filtered.length === 0) {
            this.noResults.style.display = 'flex';
            this.resultsCount.innerText = "Showing 0 items";
            return;
        }

        this.noResults.style.display = 'none';
        const filterSuffix = this.activeStockFilter === 'low' ? ' (Low Reserves)' :
            this.activeStockFilter === 'borrowed' ? ' (Active Loans)' :
                this.activeStockFilter === 'out' ? ' (Out of Stock)' : '';
        this.resultsCount.innerText = `Showing ${filtered.length} component${filtered.length > 1 ? 's' : ''}${filterSuffix}`;

        const totalCountEl = document.getElementById('vault-total-count-text');
        if (totalCountEl) {
            totalCountEl.innerText = String(inventory.length);
        }

        const fragment = document.createDocumentFragment();
        filtered.forEach((item) => {
            const card = this.createCardElement(item);
            fragment.appendChild(card);
        });
        this.inventoryGrid.appendChild(fragment);

        // If currently viewing profile, keep active loans & quota updated in real time
        const profileSec = document.getElementById('profile-view');
        if (profileSec && profileSec.classList.contains('active') && typeof ProfileViewManager !== 'undefined') {
            ProfileViewManager.render();
        }
    }

    private async loadInventory() {
        await DatabaseManager.syncFromBackend();
        this.renderInventory(true);
        this.renderStats();
    }

    private createCardElement(item: InventoryItem): HTMLElement {
        const card = document.createElement('div');
        card.className = 'inventory-card active';

        const borrowedSum = (item.borrowedBy || [])
            .filter((r: any) => !r.returned && (r as any).status !== 'RETURNED' && (r as any).status !== 'REJECTED')
            .reduce((sum: number, rec: any) => sum + rec.qty, 0);
        const totalQty = Number(item.quantity) || 0;
        const available = typeof item.availableQuantity === 'number'
            ? Math.min(totalQty, Math.max(0, item.availableQuantity))
            : Math.max(0, totalQty - borrowedSum);

        const status = getItemStockStatus(totalQty, available);
        const statusText = status.text;
        const statusClass = status.class;

        const catMap: Record<string, string> = {
            microcontrollers: "MCU",
            sensors: "SENSOR",
            actuators: "ACTUATOR",
            power: "POWER",
            tools: "HARDWARE"
        };
        const categoryLabel = catMap[item.category] || item.category.toUpperCase();

        const itemName = item.name;

        // Dynamic 1-line sizing class so longer component names never get hidden or truncated
        const nameLen = itemName.length;
        const titleSizeClass = nameLen > 28 ? 'title-compact-xs' : nameLen > 18 ? 'title-compact-sm' : '';

        // Shorter, punchier description for aesthetic display
        const cleanSpecs = (item.specs || '').trim();
        let shortDesc = cleanSpecs;
        if (shortDesc.length > 56) {
            const cut = shortDesc.substring(0, 54);
            const lastSpace = cut.lastIndexOf(' ');
            shortDesc = (lastSpace > 24 ? cut.substring(0, lastSpace) : cut).trim() + '...';
        }

        // Shorter location label (extracts sub-location e.g. "Rack S1, Box 1")
        let shortLocation = item.location || 'Lab Vault';
        if (shortLocation.includes(' - ')) {
            shortLocation = shortLocation.split(' - ')[1].trim();
        }

        // Mini tech tags (up to 2 clean tags)
        const rawTags = Array.isArray(item.tags) ? item.tags : [];
        const miniTags = rawTags
            .filter((t: string) => !['Sensors', 'Controllers', 'Actuators', 'Power', 'Tools', 'Mechanical'].includes(t))
            .slice(0, 2);
        const miniTagsHtml = miniTags.length > 0 ? `
            <div class="card-tags-row">
                ${miniTags.map((t: string) => `<span class="card-mini-tag">#${AdminManager.escapeHtml(t)}</span>`).join('')}
            </div>
        ` : '';

        // Availability progress percentage (relative to true total quantity)
        const fillPercent = totalQty > 0 ? Math.min(100, Math.round((available / totalQty) * 100)) : 0;

        const isAdmin = ModalManager.getCurrentRole() === 'ADMIN';
        const deleteBtnHtml = isAdmin ? `
            <button class="btn-card-delete-item" data-id="${escapeHtml(item.id)}" data-name="${escapeHtml(itemName)}" title="Delete Component from Inventory">
                ${getFastIconSvg('trash-2', 13)}
            </button>
        ` : '';

        const totalBorrowedUnits = Math.max(0, totalQty - available);
        const cleanBorrowedBy = totalBorrowedUnits > 0
            ? (item.borrowedBy || []).filter((r: any) => !r.returned && (r as any).status !== 'RETURNED' && (r as any).status !== 'REJECTED')
            : [];
        const myLoans = cleanBorrowedBy.filter((r: any) => (r as any).status !== 'PENDING' && ModalManager.isUserLoanMatch(r));
        const myLoanTotal = myLoans.reduce((sum: number, r: any) => sum + (Number(r.qty) || 0), 0);
        const myPendingReturn = myLoans.some((r: any) => (r as any).status === 'RETURN_REQUESTED');

        let loanBadgeHtml = '';
        if (myLoanTotal > 0) {
            loanBadgeHtml = `
            <div class="card-loan-action-pill" style="margin-top: 8px; display: flex; align-items: center; justify-content: space-between; width: 100%; box-sizing: border-box; background: ${myPendingReturn ? 'rgba(245, 158, 11, 0.12)' : 'rgba(99, 102, 241, 0.08)'}; border: 1px solid ${myPendingReturn ? 'rgba(245, 158, 11, 0.35)' : 'rgba(99, 102, 241, 0.28)'}; border-radius: 6px; padding: 5px 10px; font-size: 11px; color: ${myPendingReturn ? '#f59e0b' : '#818cf8'}; cursor: pointer; transition: all 0.2s ease;">
                <span style="display: inline-flex; align-items: center; gap: 5px; font-weight: 600;">
                    ${getFastIconSvg(myPendingReturn ? 'clock' : 'package-check', 12)} ${myPendingReturn ? `Return Pending (${myLoanTotal} issued)` : `You have ${myLoanTotal} issued`}
                </span>
                <span style="font-weight: 700; text-decoration: underline; letter-spacing: 0.5px; display: inline-flex; align-items: center; gap: 3px;">
                    ${myPendingReturn ? 'View Status' : 'Return'} ${getFastIconSvg(myPendingReturn ? 'arrow-right' : 'corner-up-left', 11)}
                </span>
            </div>
            `;
        } else if (isAdmin && totalBorrowedUnits > 0) {
            loanBadgeHtml = `
            <div class="card-admin-loan-pill" style="margin-top: 8px; display: flex; align-items: center; justify-content: space-between; width: 100%; box-sizing: border-box; font-size: 11px; cursor: pointer; transition: all 0.2s ease;" title="Click to view active borrowers & restock">
                <span style="display: inline-flex; align-items: center; gap: 5px; font-weight: 600;">
                    ${getFastIconSvg('users', 12)} ${totalBorrowedUnits} unit${totalBorrowedUnits > 1 ? 's' : ''} on active loan
                </span>
                <span style="font-weight: 700; text-decoration: underline; letter-spacing: 0.5px; display: inline-flex; align-items: center; gap: 3px;">
                    Inspect / Restock ${getFastIconSvg('arrow-right', 11)}
                </span>
            </div>
            `;
        }

        // Cart status for this item
        const inCart = typeof CartManager !== 'undefined' && CartManager.hasItem(item.id);
        const cartQty = typeof CartManager !== 'undefined' ? CartManager.getItemQty(item.id) : 0;
        const isOutOfStock = available <= 0;

        const cartBtnText = inCart ? `In Cart (${cartQty})` : (isOutOfStock ? 'Out of Stock' : '+ Add to Cart');
        const cartBtnIcon = inCart ? 'check' : 'shopping-bag';
        const cartBtnClass = inCart ? 'btn-card-add-cart in-cart' : 'btn-card-add-cart';

        card.innerHTML = `
            <div class="card-header">
                <span class="card-category-badge cat-${item.category}">${categoryLabel}</span>
                <div class="card-header-actions">
                    <span class="status-indicator ${statusClass}">
                        <span class="status-indicator-dot"></span>
                        ${statusText}
                    </span>
                </div>
            </div>
            <h3 class="card-title ${titleSizeClass}" title="${AdminManager.escapeHtml(itemName)}">${AdminManager.escapeHtml(itemName)}</h3>
            <p class="card-desc" title="${AdminManager.escapeHtml(item.specs)}">${AdminManager.escapeHtml(shortDesc)}</p>
            ${miniTagsHtml}
            ${loanBadgeHtml}
            <div class="card-footer">
                <div class="footer-info" title="${AdminManager.escapeHtml(item.location)}">
                    <span class="info-title">Location</span>
                    <span class="info-content">${getFastIconSvg('map-pin', 12)} ${AdminManager.escapeHtml(shortLocation)}</span>
                </div>
                <div class="footer-info" style="align-items: flex-end;">
                    <span class="info-title">Availability</span>
                    <span class="info-content"><strong class="stock-curr ${statusClass}">${available}</strong> <span class="stock-divider">/</span> ${totalQty}</span>
                    <div class="availability-bar-track">
                        <div class="availability-bar-fill fill-${statusClass}" style="width: ${fillPercent}%"></div>
                    </div>
                </div>
            </div>
            <div class="card-action-row">
                <button type="button" class="${cartBtnClass}" data-id="${item.id}" ${isOutOfStock ? 'disabled' : ''} title="${isOutOfStock ? 'Out of stock in vault' : 'Add to Hardware Request Cart'}">
                    ${getFastIconSvg(cartBtnIcon, 13)}
                    <span>${cartBtnText}</span>
                </button>
                ${deleteBtnHtml}
            </div>
        `;

        const addCartBtn = card.querySelector('.btn-card-add-cart') as HTMLButtonElement | null;
        if (addCartBtn) {
            addCartBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (typeof CartManager !== 'undefined') {
                    CartManager.addItem(item);
                }
            });
        }

        if (isAdmin) {
            const delBtn = card.querySelector('.btn-card-delete-item');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    AdminManager.promptDeleteItem(item.id, item.name);
                });
            }
        }

        if (myLoanTotal > 0) {
            const loanPill = card.querySelector('.card-loan-action-pill');
            if (loanPill) {
                loanPill.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (myPendingReturn) {
                        ModalManager.openDetailModal(item);
                    } else {
                        const activeLoan = myLoans.find((r: any) => (r as any).status !== 'RETURN_REQUESTED') || myLoans[0];
                        if (activeLoan) {
                            ModalManager.openReturnModal(activeLoan, item, (item.borrowedBy || []).indexOf(activeLoan));
                        }
                    }
                });
            }
        } else if (isAdmin && totalBorrowedUnits > 0) {
            const adminPill = card.querySelector('.card-admin-loan-pill');
            if (adminPill) {
                adminPill.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    ModalManager.openDetailModal(item);
                });
            }
        }

        const delBtn = card.querySelector<HTMLButtonElement>('.btn-card-delete-item');
        if (delBtn) {
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                AdminManager.promptDeleteItem(item.id, itemName);
            });
        }

        card.addEventListener('click', () => {
            ModalManager.openDetailModal(item);
        });

        return card;
    }

    public static switchSection(targetId: string) {
        if (window.dashboard && (window.dashboard as any).switchSection) {
            (window.dashboard as any).switchSection(targetId);
        } else {
            const sideLink = document.querySelector(`.sidebar-nav-link[data-target="${targetId}"]`) as HTMLElement;
            if (sideLink) {
                sideLink.click();
            }
        }
    }
}
