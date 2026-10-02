/**
 * AuthManager — authentication and session lifecycle.
 *
 * Responsibilities
 * - Login, registration (client-side password hashing) and logout.
 * - Session persistence + 15-minute inactivity timeout.
 * - Admin-only UI visibility toggling (updateAdminVisibility).
 *
 * Depends on: modal, profile-view, admin, dashboard, database, core/api,
 * core/ui, utils/authCrypto. */

import { readCurrentUser } from './core/session';
import { ModalManager } from './modal';
import { PasswordResetManager } from './password-reset';
import { API_BASE } from './core/api';
import { ProfileViewManager } from './profile-view';
import { AdminManager } from './admin';
import { ToastManager } from './toast';
import { createLegacyAuthToken, hashPasswordClient } from './utils/authCrypto';
import { DashboardManager } from './dashboard';
import { renderLucideIcons } from './core/ui';
import { DatabaseManager } from './database';
import { CartManager } from './cart';
import type { UserRole } from './core/ui';

// ==========================================
// 6. User Authentication & Admin Approval Manager
// ==========================================
export class AuthManager {
    private static loginForm: HTMLFormElement;
    private static signupForm: HTMLFormElement;
    private static authOverlay: HTMLElement;
    private static appContainer: HTMLElement;
    private static globalNavbar: HTMLElement;

    private static loginUserInp: HTMLInputElement;
    private static loginPassInp: HTMLInputElement;
    private static loginErr: HTMLElement;

    private static signupNameInp: HTMLInputElement;
    private static signupEmailInp: HTMLInputElement;
    private static signupUserInp: HTMLInputElement;
    private static signupEnrollmentInp: HTMLInputElement;
    private static signupBatchInp: HTMLInputElement;
    private static signupPassInp: HTMLInputElement;
    private static signupErr: HTMLElement;
    private static signupSuccess: HTMLElement;

    private static navUsername: HTMLElement;
    private static navLogoutBtn: HTMLElement;

    static init() {
        this.loginForm = document.getElementById('login-form') as HTMLFormElement;
        this.signupForm = document.getElementById('signup-form') as HTMLFormElement;
        this.authOverlay = document.getElementById('auth-overlay')!;
        this.appContainer = document.getElementById('app-container')!;
        this.globalNavbar = document.getElementById('global-navbar')!;

        this.loginUserInp = document.getElementById('login-username') as HTMLInputElement;
        this.loginPassInp = document.getElementById('login-password') as HTMLInputElement;
        this.loginErr = document.getElementById('login-error')!;

        this.signupNameInp = document.getElementById('signup-name') as HTMLInputElement;
        this.signupEmailInp = document.getElementById('signup-email') as HTMLInputElement;
        this.signupUserInp = document.getElementById('signup-username') as HTMLInputElement;
        this.signupEnrollmentInp = document.getElementById('signup-enrollment') as HTMLInputElement;
        this.signupBatchInp = document.getElementById('signup-batch') as HTMLInputElement;
        this.signupPassInp = document.getElementById('signup-password') as HTMLInputElement;
        this.signupErr = document.getElementById('signup-error')!;
        this.signupSuccess = document.getElementById('signup-success')!;

        this.navUsername = document.getElementById('nav-username')!;
        this.navLogoutBtn = document.getElementById('nav-logout')!;

        this.updateAdminVisibility(ModalManager.getCurrentRole());
        PasswordResetManager.init();
        this.setupInactivityTracker();
        this.setupEventListeners();
        this.checkAuth();
    }

    // Inactivity Tracking Configuration: 15-minute persistence and timeout rule
    private static readonly INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 minutes (900,000 ms)
    private static lastActivityRecordedAt = 0;
    private static inactivityTimer: any = null;

    private static recordActivity(immediate: boolean = false) {
        const now = Date.now();
        // Throttle updates unless immediate (e.g. login, unload, tab switch)
        if (immediate || now - this.lastActivityRecordedAt > 5000) {
            this.lastActivityRecordedAt = now;
            try {
                localStorage.setItem('cicr_last_active', now.toString());
            } catch { }
        }
    }

    private static checkInactivityExpired(): boolean {
        const token = localStorage.getItem('cicr_token');
        if (!token) return false;

        const lastActiveStr = localStorage.getItem('cicr_last_active');
        if (!lastActiveStr) {
            // First time or legacy session with token: initialize activity timestamp now
            this.recordActivity(true);
            return false;
        }

        const lastActive = parseInt(lastActiveStr, 10);
        if (isNaN(lastActive) || lastActive <= 0) return false;

        const elapsed = Date.now() - lastActive;
        return elapsed > this.INACTIVITY_LIMIT_MS;
    }

    private static handleInactivityTimeout() {
        console.warn('Session expired due to 15 minutes of inactivity.');
        this.handleLogout(true);
    }

    private static setupInactivityTracker() {
        let lastActivityCheck = 0;
        const onUserActivity = () => {
            const now = Date.now();
            if (now - lastActivityCheck < 10000) return;
            lastActivityCheck = now;
            if (localStorage.getItem('cicr_token')) {
                this.recordActivity(false);
            }
        };

        // Window & document activity triggers
        window.addEventListener('pointerdown', onUserActivity, { passive: true });
        window.addEventListener('keydown', onUserActivity, { passive: true });
        window.addEventListener('scroll', onUserActivity, { passive: true });
        window.addEventListener('touchstart', onUserActivity, { passive: true });

        // Record timestamp when page unloads or is hidden (closing browser or switching tabs)
        window.addEventListener('beforeunload', () => {
            if (localStorage.getItem('cicr_token')) {
                this.recordActivity(true);
            }
        });
        window.addEventListener('pagehide', () => {
            if (localStorage.getItem('cicr_token')) {
                this.recordActivity(true);
            }
        });

        // Check timeout when user returns to this tab
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                if (localStorage.getItem('cicr_token')) {
                    if (this.checkInactivityExpired()) {
                        this.handleInactivityTimeout();
                    } else {
                        this.recordActivity(true);
                    }
                }
            } else if (document.visibilityState === 'hidden') {
                if (localStorage.getItem('cicr_token')) {
                    this.recordActivity(true);
                }
            }
        });

        // Background interval check every 15 seconds while tab is open
        if (this.inactivityTimer) clearInterval(this.inactivityTimer);
        this.inactivityTimer = setInterval(() => {
            if (localStorage.getItem('cicr_token')) {
                if (this.checkInactivityExpired()) {
                    this.handleInactivityTimeout();
                }
            }
        }, 15000);
    }

    private static setupEventListeners() {
        const authCard = document.querySelector('.auth-card') as HTMLElement | null;
        const tabLoginBtn = document.getElementById('tab-login-btn');
        const tabSignupBtn = document.getElementById('tab-signup-btn');

        const switchToLogin = () => {
            this.signupForm.style.display = 'none';
            this.loginForm.style.display = 'block';
            this.signupErr.style.display = 'none';
            this.signupSuccess.style.display = 'none';
            this.loginForm.reset();
            authCard?.classList.remove('auth-card-wide');
            tabLoginBtn?.classList.add('active');
            tabLoginBtn?.setAttribute('aria-selected', 'true');
            tabSignupBtn?.classList.remove('active');
            tabSignupBtn?.setAttribute('aria-selected', 'false');
            setTimeout(() => this.loginUserInp?.focus(), 60);
        };

        const switchToSignup = () => {
            this.loginForm.style.display = 'none';
            this.signupForm.style.display = 'block';
            this.loginErr.style.display = 'none';
            this.signupForm.reset();
            const matchStatus = document.getElementById('signup-password-match');
            if (matchStatus) matchStatus.style.display = 'none';
            const confirmPassInp = document.getElementById('signup-confirm-password') as HTMLInputElement | null;
            if (confirmPassInp) confirmPassInp.classList.remove('input-match-success', 'input-match-error');
            authCard?.classList.add('auth-card-wide');
            tabSignupBtn?.classList.add('active');
            tabSignupBtn?.setAttribute('aria-selected', 'true');
            tabLoginBtn?.classList.remove('active');
            tabLoginBtn?.setAttribute('aria-selected', 'false');
            setTimeout(() => this.signupNameInp?.focus(), 60);
        };

        document.getElementById('go-to-signup')?.addEventListener('click', (e) => {
            e.preventDefault();
            switchToSignup();
        });

        document.getElementById('go-to-login')?.addEventListener('click', (e) => {
            e.preventDefault();
            switchToLogin();
        });

        document.getElementById('btn-open-forgot-password')?.addEventListener('click', (e) => {
            e.preventDefault();
            PasswordResetManager.open();
        });

        tabLoginBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            switchToLogin();
        });

        tabSignupBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            switchToSignup();
        });

        this.loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        this.signupForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSignup();
        });

        this.navLogoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.promptLogout();
        });

        // Tactile password visibility toggles with eye icon swaps
        const setupPasswordToggle = (toggleBtnId: string, inputId: string) => {
            const toggleBtn = document.getElementById(toggleBtnId);
            const passInput = document.getElementById(inputId) as HTMLInputElement | null;
            if (toggleBtn && passInput && !toggleBtn.dataset.bound) {
                toggleBtn.dataset.bound = 'true';
                toggleBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const isPassword = passInput.getAttribute('type') === 'password';
                    const newType = isPassword ? 'text' : 'password';
                    passInput.setAttribute('type', newType);
                    toggleBtn.setAttribute('title', isPassword ? 'Hide password' : 'Show password');
                    toggleBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
                    toggleBtn.innerHTML = `<i data-lucide="${isPassword ? 'eye-off' : 'eye'}"></i>`;
                    if ((window as any).lucide && (window as any).lucide.createIcons) {
                        (window as any).lucide.createIcons();
                    }
                });
            }
        };

        setupPasswordToggle('login-password-toggle', 'login-password');
        setupPasswordToggle('signup-password-toggle', 'signup-password');
        setupPasswordToggle('signup-confirm-password-toggle', 'signup-confirm-password');

        // Real-time interactive password matching & strength feedback
        const checkPasswordMatch = () => {
            const pass = this.signupPassInp ? this.signupPassInp.value : '';
            const confirmPassInp = document.getElementById('signup-confirm-password') as HTMLInputElement | null;
            const confirmPass = confirmPassInp ? confirmPassInp.value : '';
            const matchStatus = document.getElementById('signup-password-match');
            if (!matchStatus || !confirmPassInp) return;

            if (!confirmPass) {
                matchStatus.style.display = 'none';
                confirmPassInp.classList.remove('input-match-success', 'input-match-error');
                return;
            }

            matchStatus.style.display = 'flex';
            if (pass === confirmPass) {
                confirmPassInp.classList.add('input-match-success');
                confirmPassInp.classList.remove('input-match-error');
                matchStatus.className = 'password-match-status match-success';
                matchStatus.innerHTML = '<i data-lucide="check" style="width:12px;height:12px;"></i> Passwords match';
            } else {
                confirmPassInp.classList.add('input-match-error');
                confirmPassInp.classList.remove('input-match-success');
                matchStatus.className = 'password-match-status match-error';
                matchStatus.innerHTML = '<i data-lucide="alert-circle" style="width:12px;height:12px;"></i> Passwords do not match';
            }
            if ((window as any).lucide && (window as any).lucide.createIcons) {
                (window as any).lucide.createIcons();
            }
        };

        this.signupPassInp?.addEventListener('input', () => {
            this.signupErr.style.display = 'none';
            checkPasswordMatch();
        });

        const confirmPassInput = document.getElementById('signup-confirm-password');
        confirmPassInput?.addEventListener('input', () => {
            this.signupErr.style.display = 'none';
            checkPasswordMatch();
        });

        // Dynamic auto-clearing of error messages on input interaction
        this.loginUserInp?.addEventListener('input', () => {
            this.loginErr.style.display = 'none';
        });
        this.loginPassInp?.addEventListener('input', () => {
            this.loginErr.style.display = 'none';
        });

        [this.signupNameInp, this.signupEmailInp, this.signupUserInp, this.signupEnrollmentInp, this.signupBatchInp].forEach(inp => {
            inp?.addEventListener('input', () => {
                this.signupErr.style.display = 'none';
            });
        });
    }

    private static async checkAuth() {
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) welcomeScreen.style.display = 'none';

        const token = localStorage.getItem('cicr_token');
        if (!token) {
            this.showLoginOverlay();
            return;
        }

        // Check if user session has been inactive or away for more than 15 minutes
        if (this.checkInactivityExpired()) {
            this.handleInactivityTimeout();
            return;
        }

        // Within 15 minutes: active session preserved, refresh activity timestamp
        this.recordActivity(true);

        // Instant session activation: eliminates auth modal flash on page reload
        const cachedUserStr = localStorage.getItem('cicr_user');
        const cachedAuth = localStorage.getItem('cicr_auth');
        const cachedRole = (localStorage.getItem('cicr_role') as UserRole) || 'MEMBER';
        let userObj = null;
        try { if (cachedUserStr) userObj = JSON.parse(cachedUserStr); } catch { }
        const fallbackName = userObj?.name || cachedAuth || 'Operator';
        this.loginSuccess(fallbackName, cachedRole, userObj);

        try {
            const res = await fetch(`${API_BASE}/auth/profile`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                const result = await res.json();
                const user = result.data;
                if (user) {
                    this.loginSuccess(user.name, user.role, user);
                    if (typeof ProfileViewManager !== 'undefined') {
                        ProfileViewManager.render(false);
                    }
                    if (typeof AdminManager !== 'undefined' && typeof AdminManager.syncFromBackend === 'function') {
                        AdminManager.syncFromBackend(false);
                    }
                    const welcomedKey = 'cicr_welcomed_' + (user.name || 'user');
                    if (!sessionStorage.getItem(welcomedKey)) {
                        sessionStorage.setItem(welcomedKey, 'true');
                        ToastManager.showWelcome(user.name, user.role);
                    }
                    return;
                }
            } else if (res.status === 401 || res.status === 403) {
                console.warn('[CICR Auth] Session invalid or expired (401/403). Clearing session.');
                this.handleLogout();
                return;
            }
        } catch (err) {
            console.warn('Profile validation check deferred (offline / backend initializing):', err);
        }
    }

    public static showLoginOverlay() {
        document.documentElement.classList.remove('is-authenticated');
        document.documentElement.classList.add('is-unauthenticated');
        document.body.classList.remove('authenticated');
        document.body.classList.add('auth-overlay-active');
        this.globalNavbar.style.setProperty('display', 'none', 'important');
        this.authOverlay.classList.remove('hidden');
        this.authOverlay.style.setProperty('display', 'flex', 'important');
        this.appContainer.classList.add('hidden');
        this.appContainer.style.setProperty('display', 'none', 'important');
        this.updateAdminVisibility('MEMBER');

        // Reset to default sign-in state
        this.signupForm.style.display = 'none';
        this.loginForm.style.display = 'block';
        document.querySelector('.auth-card')?.classList.remove('auth-card-wide');
        document.getElementById('tab-login-btn')?.classList.add('active');
        document.getElementById('tab-signup-btn')?.classList.remove('active');
    }

    private static isAllowedEmail(email: string): boolean {
        const norm = email.trim().toLowerCase();
        // Allow valid email addresses through to backend authentication API
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm);
    }

    private static async handleLogin() {
        const identifier = this.loginUserInp.value.trim();
        const rawPassword = this.loginPassInp.value;

        // Clear sensitive plaintext password from DOM memory immediately
        this.loginPassInp.value = '';
        this.loginErr.style.display = 'none';

        if (!identifier || !rawPassword) {
            this.showLoginError("Please enter your Email, Username, or Name, and Password.");
            return;
        }

        const btnSubmit = document.getElementById('btn-submit-login') as HTMLButtonElement | null;
        const origSubmitHtml = btnSubmit ? btnSubmit.innerHTML : '';
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Signing In...';
            if ((window as any).lucide) (window as any).lucide.createIcons();
        }

        try {
            // Pre-hash password client-side so plaintext is never transmitted in Network tab
            const [hashedPassword, legacyAuth] = await Promise.all([
                hashPasswordClient(rawPassword),
                createLegacyAuthToken(rawPassword)
            ]);

            const payload: Record<string, any> = {
                identifier,
                email: identifier,
                username: identifier,
                name: identifier,
                password: hashedPassword
            };
            if (legacyAuth) {
                payload.legacy_auth = legacyAuth;
            }

            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (res.ok && data.token) {
                localStorage.setItem('cicr_token', data.token);
                if (data.user) {
                    localStorage.setItem('cicr_user', JSON.stringify(data.user));
                }
                const resolvedName = data.user?.name || identifier;
                const role = data.user?.role || 'MEMBER';
                this.loginSuccess(resolvedName, role, data.user);
                sessionStorage.setItem('cicr_welcomed_' + resolvedName, 'true');
                ToastManager.showWelcome(resolvedName, role);
                return;
            }

            if (data.status === 'pending_approval') {
                this.showLoginError(data.message || "Access Pending: Your account has been registered and is awaiting approval by the CICR Admin.");
                return;
            }

            if (data.status === 'rejected') {
                this.showLoginError(data.message || "Access Denied: Your account registration was rejected by the CICR Admin.");
                return;
            }

            const errorMsg = data.errors?.[0]?.message || data.message || "Invalid credentials. Please check your email, username, or name and password.";
            this.showLoginError(errorMsg);
        } catch (err) {
            this.showLoginError("Unable to reach backend server. Please verify your connection.");
        } finally {
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = origSubmitHtml;
                if ((window as any).lucide) (window as any).lucide.createIcons();
            }
        }
    }

    private static showLoginError(msg: string) {
        this.loginErr.innerText = msg;
        this.loginErr.style.display = 'block';
        this.loginErr.style.animation = 'none';
        this.loginErr.offsetHeight;
        this.loginErr.style.animation = 'shake-error 0.4s ease';
    }

    private static loginSuccess(username: string, role: string = 'MEMBER', _userObj?: any) {
        this.recordActivity(true);
        let effectiveRole: 'ADMIN' | 'MEMBER' = 'MEMBER';
        if (role === 'ADMIN' || _userObj?.role === 'ADMIN') {
            effectiveRole = 'ADMIN';
        } else {
            effectiveRole = 'MEMBER';
        }

        localStorage.setItem('cicr_auth', username);
        localStorage.setItem('cicr_role', effectiveRole);
        if (_userObj) {
            localStorage.setItem('cicr_user', JSON.stringify({ ..._userObj, role: effectiveRole }));
        }

        if (this.navUsername) {
            this.navUsername.innerText = username;
        }

        // Set username, role, initial, and avatar in the left sidebar profile card
        const profileUserDisplay = document.getElementById('profile-username-display');
        const profileAvatarInitial = document.getElementById('profile-avatar-initial');
        const sidebarAvatarImg = document.getElementById('sidebar-avatar-img') as HTMLImageElement;
        const profileRoleDisplay = document.querySelector('.sidebar-profile-box .profile-role') as HTMLElement;

        if (profileUserDisplay) profileUserDisplay.innerText = username;
        if (sidebarAvatarImg && profileAvatarInitial) {
            const initialTextEl = document.getElementById('sidebar-avatar-initial-text');
            if (_userObj?.avatar_url) {
                sidebarAvatarImg.src = _userObj.avatar_url;
                sidebarAvatarImg.style.display = 'block';
                profileAvatarInitial.classList.add('has-avatar-img');
                if (initialTextEl) {
                    initialTextEl.style.display = 'none';
                    initialTextEl.textContent = '';
                }
            } else {
                sidebarAvatarImg.src = '';
                sidebarAvatarImg.style.display = 'none';
                profileAvatarInitial.classList.remove('has-avatar-img');
                if (initialTextEl) {
                    initialTextEl.textContent = (username.charAt(0) || 'U').toUpperCase();
                    initialTextEl.style.display = 'flex';
                } else {
                    profileAvatarInitial.textContent = (username.charAt(0) || 'U').toUpperCase();
                }
            }
        } else if (profileAvatarInitial) {
            profileAvatarInitial.classList.remove('has-avatar-img');
            const initialTextEl = document.getElementById('sidebar-avatar-initial-text');
            if (initialTextEl) {
                initialTextEl.textContent = (username.charAt(0) || 'U').toUpperCase();
                initialTextEl.style.display = 'flex';
            } else {
                profileAvatarInitial.textContent = (username.charAt(0) || 'U').toUpperCase();
            }
        }
        if (profileRoleDisplay) {
            profileRoleDisplay.innerText = effectiveRole;
            profileRoleDisplay.classList.toggle('role-admin', effectiveRole === 'ADMIN');
            profileRoleDisplay.classList.toggle('role-member', effectiveRole !== 'ADMIN');
            profileRoleDisplay.style.color = '';
        }

        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) welcomeScreen.style.display = 'none';

        document.documentElement.classList.add('is-authenticated');
        document.documentElement.classList.remove('is-unauthenticated');
        document.body.classList.remove('auth-overlay-active');
        document.body.classList.add('authenticated');
        document.body.style.overflow = '';

        // Directly transition: hide auth form, show app container
        this.authOverlay.classList.add('hidden');
        this.authOverlay.style.setProperty('display', 'none', 'important');
        this.appContainer.classList.remove('hidden');
        this.appContainer.style.removeProperty('display');
        this.globalNavbar.style.setProperty('display', 'none', 'important');
        (window as any).syncFixedSidebarPosition?.();

        // Show/Hide Admin Portal navigation & cards based strictly on role
        this.updateAdminVisibility(effectiveRole);

        // Select Dashboard link in the left sidebar by default
        const activeNavClass = () => {
            const sidebarLinks = document.querySelectorAll('.sidebar-nav-link');
            sidebarLinks.forEach(link => {
                const target = (link as HTMLElement).dataset.target;
                if (target === 'dashboard-view') {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            });
            const sections = document.querySelectorAll('#app-main-content > section');
            sections.forEach(node => {
                const sec = node as HTMLElement;
                if (sec.id === 'dashboard-view') {
                    sec.classList.add('active');
                    sec.style.display = 'flex';
                } else {
                    sec.classList.remove('active');
                    sec.style.display = 'none';
                }
            });



            const breadcrumbActive = document.getElementById('breadcrumb-current');
            if (breadcrumbActive) breadcrumbActive.innerText = 'DASHBOARD';
        };
        activeNavClass();

        if (!window.dashboard) {
            window.dashboard = new DashboardManager();
        } else {
            window.dashboard.init();
        }
        renderLucideIcons();

        if (effectiveRole === 'ADMIN') {
            AdminManager.init();
        }
    }

    public static updateAdminVisibility(role?: string) {
        const sideAdminLink = document.getElementById('side-nav-admin');
        const dashAdminCard = document.getElementById('dash-card-admin');
        const adminViewSection = document.getElementById('admin-view');
        const btnInventoryAdd = document.getElementById('btn-inventory-add-item');

        const sideHwLogsLink = document.getElementById('side-nav-hardware-logs');
        const dashHwLogsCard = document.getElementById('dash-card-hardware-logs');
        const navHwLogsLink = document.getElementById('nav-hardware-logs');
        const hwLogsSection = document.getElementById('hardware-logs-view');

        const activeRole = role !== undefined ? role : ModalManager.getCurrentRole();
        const isAdmin = activeRole === 'ADMIN';

        const roleSubtitleEl = document.getElementById('dashboard-subtitle-role');
        if (roleSubtitleEl) {
            roleSubtitleEl.innerText = isAdmin ? 'ADMIN DASHBOARD' : 'MEMBER DASHBOARD';
        }

        if (isAdmin) {
            document.body.classList.add('user-is-admin');
            if (sideAdminLink) {
                sideAdminLink.style.removeProperty('display');
                sideAdminLink.style.setProperty('display', 'flex', 'important');
            }
            if (dashAdminCard) {
                dashAdminCard.style.setProperty('display', 'none', 'important');
            }
            if (btnInventoryAdd) {
                btnInventoryAdd.style.removeProperty('display');
                btnInventoryAdd.style.setProperty('display', 'inline-flex', 'important');
            }
            if (adminViewSection && !adminViewSection.classList.contains('active')) {
                adminViewSection.style.setProperty('display', 'none', 'important');
            }
            if (sideHwLogsLink) {
                sideHwLogsLink.style.removeProperty('display');
                sideHwLogsLink.style.setProperty('display', 'flex', 'important');
            }
            if (dashHwLogsCard) {
                dashHwLogsCard.style.setProperty('display', 'none', 'important');
            }
            if (navHwLogsLink) {
                navHwLogsLink.style.removeProperty('display');
                navHwLogsLink.style.setProperty('display', 'inline-flex', 'important');
            }
            if (hwLogsSection && !hwLogsSection.classList.contains('active')) {
                hwLogsSection.style.setProperty('display', 'none', 'important');
            }
            AdminManager.init();
        } else {
            document.body.classList.remove('user-is-admin');
            if (sideAdminLink) {
                sideAdminLink.style.setProperty('display', 'none', 'important');
            }
            if (dashAdminCard) {
                dashAdminCard.style.setProperty('display', 'none', 'important');
            }
            if (btnInventoryAdd) {
                btnInventoryAdd.style.setProperty('display', 'none', 'important');
            }
            if (adminViewSection) {
                adminViewSection.style.setProperty('display', 'none', 'important');
                adminViewSection.classList.remove('active');
            }
            if (sideHwLogsLink) {
                sideHwLogsLink.style.setProperty('display', 'none', 'important');
            }
            if (dashHwLogsCard) {
                dashHwLogsCard.style.setProperty('display', 'none', 'important');
            }
            if (navHwLogsLink) {
                navHwLogsLink.style.setProperty('display', 'none', 'important');
            }
            if (hwLogsSection) {
                hwLogsSection.style.setProperty('display', 'none', 'important');
                hwLogsSection.classList.remove('active');
            }
            // Auto-redirect if non-admin is currently attempting to view restricted sections
            const curActive = document.querySelector('.main-viewport > section.active');
            if (curActive && (curActive.id === 'admin-view' || curActive.id === 'hardware-logs-view')) {
                if ((window as any).switchSection) {
                    (window as any).switchSection('dashboard-view');
                }
            }
        }

        if (window.dashboard) {
            window.dashboard.renderInventory(true);
        }
    }

    private static async handleSignup() {
        const name = (this.signupNameInp ? this.signupNameInp.value : '').trim();
        const email = (this.signupEmailInp ? this.signupEmailInp.value : '').trim();
        const username = (this.signupUserInp ? this.signupUserInp.value : '').trim();
        const enrollment = (this.signupEnrollmentInp ? this.signupEnrollmentInp.value : '').trim();
        const batch = (this.signupBatchInp ? this.signupBatchInp.value : '').trim();
        const password = this.signupPassInp ? this.signupPassInp.value : '';
        const confirmPassInp = document.getElementById('signup-confirm-password') as HTMLInputElement | null;
        const confirmPassword = confirmPassInp ? confirmPassInp.value : '';

        this.signupErr.style.display = 'none';
        this.signupSuccess.style.display = 'none';

        if (name.length < 2) {
            this.showSignupError("Please enter your full name.");
            return;
        }

        if (!email || !email.includes('@')) {
            this.showSignupError("Please provide a valid email address.");
            return;
        }

        if (!this.isAllowedEmail(email)) {
            this.showSignupError("Registration Restricted: Only official JIIT student accounts (enrollmentnumber@mail.jiit.ac.in) can create an account.");
            return;
        }

        if (username.length < 3) {
            this.showSignupError("Username must be at least 3 characters.");
            return;
        }

        if (enrollment.length < 4) {
            this.showSignupError("Please enter a valid enrollment number.");
            return;
        }

        if (!batch) {
            this.showSignupError("Please enter your academic branch (e.g. CSE / ECE / IT).");
            return;
        }

        if (password.length < 6) {
            this.showSignupError("Password must be at least 6 characters.");
            return;
        }

        if (password !== confirmPassword) {
            this.showSignupError("Passwords do not match. Please verify and re-type.");
            return;
        }

        const rawPassword = password;

        // Clear sensitive plaintext password from DOM memory immediately
        this.signupPassInp.value = '';
        if (confirmPassInp) confirmPassInp.value = '';

        const btnSubmit = document.getElementById('btn-submit-signup') as HTMLButtonElement | null;
        const origSubmitHtml = btnSubmit ? btnSubmit.innerHTML : '';
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Registering...';
            if ((window as any).lucide) (window as any).lucide.createIcons();
        }

        try {
            // Pre-hash password client-side so plaintext is never transmitted in Network tab
            const hashedPassword = await hashPasswordClient(rawPassword);

            const res = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    email,
                    username,
                    roll_number: enrollment,
                    batch,
                    password: hashedPassword
                }),
            });

            const data = await res.json();

            if (res.ok || data.status === 'success') {
                this.signupSuccess.innerText = data.message || "Registration request submitted! Your account is pending CICR Admin approval.";
                this.signupSuccess.style.display = 'block';

                DatabaseManager.addLog('system', `Registration requested: <span>${name}</span> (@${username}, ${email}, Branch: ${batch}).`);

                setTimeout(() => {
                    document.getElementById('go-to-login')!.click();
                }, 2200);
                return;
            }

            this.showSignupError(data.message || "Registration failed. Please check your information.");
        } catch (err) {
            this.showSignupError("Unable to reach backend server. Please verify your connection.");
        } finally {
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = origSubmitHtml;
                if ((window as any).lucide) (window as any).lucide.createIcons();
            }
        }
    }

    private static showSignupError(msg: string) {
        this.signupErr.innerText = msg;
        this.signupErr.style.display = 'block';
        this.signupErr.style.animation = 'none';
        this.signupErr.offsetHeight;
        this.signupErr.style.animation = 'shake-error 0.4s ease';
    }

    public static promptLogout() {
        const modal = document.getElementById('signout-confirm-modal');
        if (!modal) {
            this.handleLogout();
            return;
        }

        // Populate user preview details
        let user: any = {};
        try {
            user = readCurrentUser();
        } catch { }
        const nameEl = document.getElementById('signout-user-name');
        const emailEl = document.getElementById('signout-user-email');
        const roleEl = document.getElementById('signout-user-role');
        const avatarEl = document.getElementById('signout-user-avatar');

        const userName = user?.name || user?.username || localStorage.getItem('cicr_auth') || 'Member';
        const userRoll = user?.roll_number || user?.roll || '';
        const userEmail = user?.email || (userRoll ? `${userRoll}@mail.jiit.ac.in` : (localStorage.getItem('cicr_auth')?.includes('@') ? localStorage.getItem('cicr_auth') : 'member@mail.jiit.ac.in'));
        const userRole = (user?.role || localStorage.getItem('cicr_role') || 'MEMBER').toUpperCase();

        if (nameEl) nameEl.innerText = userName;
        if (emailEl) emailEl.innerText = userEmail;
        if (roleEl) roleEl.innerText = userRole === 'ADMIN' ? 'VAULT ADMIN' : 'STUDENT MEMBER';
        if (avatarEl) avatarEl.innerText = userName.charAt(0).toUpperCase();

        modal.classList.add('active');
        modal.style.display = 'flex';
        setTimeout(() => {
            modal.style.opacity = '1';
        }, 10);
        lucide.createIcons();

        const closeBtn = document.getElementById('close-signout-confirm');
        const cancelBtn = document.getElementById('btn-cancel-signout');
        const confirmBtn = document.getElementById('btn-confirm-signout');

        const closeModal = () => {
            modal.style.opacity = '0';
            setTimeout(() => {
                modal.classList.remove('active');
                modal.style.display = 'none';
            }, 250);
        };

        if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); closeModal(); };
        if (cancelBtn) cancelBtn.onclick = (e) => { e.stopPropagation(); closeModal(); };
        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };

        if (confirmBtn) {
            confirmBtn.onclick = (e) => {
                e.stopPropagation();
                closeModal();
                ToastManager.show('Session Terminated', 'You have been disconnected safely.', 'info');
                this.handleLogout();
            };
        }
    }

    public static handleLogout(isTimeout: boolean = false) {
        const token = localStorage.getItem('cicr_token');
        if (token) {
            try {
                fetch(`${API_BASE}/auth/logout`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                }).catch(() => {});
            } catch {}
        }

        localStorage.removeItem('cicr_auth');
        localStorage.removeItem('cicr_role');
        localStorage.removeItem('cicr_token');
        localStorage.removeItem('cicr_user');
        localStorage.removeItem('cicr_last_active');
        localStorage.removeItem('cicr_cart_items');
        localStorage.removeItem('cicr_pending_returns');
        sessionStorage.clear();

        if (typeof CartManager !== 'undefined') {
            CartManager.clearCart();
        }

        document.documentElement.classList.remove('is-authenticated');
        document.documentElement.classList.add('is-unauthenticated');
        document.body.classList.remove('authenticated');
        document.body.classList.add('auth-overlay-active');

        this.updateAdminVisibility('MEMBER');

        this.appContainer.classList.add('hidden');
        this.appContainer.style.setProperty('display', 'none', 'important');
        this.globalNavbar.style.setProperty('display', 'none', 'important');

        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) {
            welcomeScreen.style.display = 'none';
            welcomeScreen.style.transform = 'translateY(0)';
        }

        this.authOverlay.style.setProperty('display', 'flex', 'important');
        setTimeout(() => {
            this.authOverlay.classList.remove('hidden');
        }, 50);

        this.loginForm.reset();
        this.loginErr.style.display = 'none';

        if (isTimeout) {
            setTimeout(() => {
                if (typeof ToastManager !== 'undefined' && ToastManager.show) {
                    ToastManager.show('Session Expired', 'You were away or inactive for more than 15 minutes. Please sign in again.', 'warning');
                }
            }, 120);
        }
    }
}
