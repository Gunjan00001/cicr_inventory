/**
 * ToastManager — transient floating notifications and welcome banners.
 * Used by nearly every manager for user feedback. Depends on core/ui. */

import { escapeHtml, renderLucideIcons } from './core/ui';

// ==========================================
// 1.5. Real-Time Floating Cyber Toast Notifications
// ==========================================
export class ToastManager {
    private static container: HTMLElement | null = null;

    static init() {
        if (!this.container) {
            this.container = document.getElementById('toast-container');
            if (!this.container) {
                this.container = document.createElement('div');
                this.container.id = 'toast-container';
                document.body.appendChild(this.container);
            }
        }
    }

    static show(title: string, desc: string, type: 'success' | 'info' | 'warning' | 'error' = 'info') {
        this.init();
        if (!this.container) return;

        const toast = document.createElement('div');
        toast.className = `cyber-toast toast-${type}`;

        const iconName = type === 'success' ? 'check-circle'
            : type === 'warning' ? 'alert-triangle'
                : type === 'error' ? 'alert-octagon' : 'bell';

        toast.innerHTML = `
            <div class="toast-icon-wrap">
                <i data-lucide="${iconName}"></i>
            </div>
            <div class="toast-content-wrap">
                <h4 class="toast-title"></h4>
                <p class="toast-desc"></p>
            </div>
            <button class="toast-close-btn" title="Dismiss">
                <i data-lucide="x" style="width:14px;height:14px;"></i>
            </button>
        `;

        const titleEl = toast.querySelector<HTMLElement>('.toast-title');
        if (titleEl) titleEl.textContent = title;
        const descEl = toast.querySelector<HTMLElement>('.toast-desc');
        if (descEl) descEl.textContent = desc;

        toast.querySelector('.toast-close-btn')!.addEventListener('click', () => {
            toast.classList.remove('show');
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 350);
        });

        this.container.appendChild(toast);
        renderLucideIcons(toast);

        requestAnimationFrame(() => {
            setTimeout(() => toast.classList.add('show'), 20);
        });

        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.remove('show');
                toast.classList.add('hide');
                setTimeout(() => toast.remove(), 350);
            }
        }, 4200);
    }

    static showWelcome(userName: string, role: string = 'MEMBER') {
        this.init();
        if (!this.container) return;

        const displayRole = (role || 'MEMBER').toUpperCase();
        const initial = (userName.trim().charAt(0) || 'U').toUpperCase();

        const toast = document.createElement('div');
        toast.className = 'cyber-toast toast-welcome';

        toast.innerHTML = `
            <div class="welcome-toast-glow"></div>
            <div class="welcome-avatar-wrap">
                <span class="welcome-avatar-letter"></span>
                <span class="welcome-status-dot"></span>
            </div>
            <div class="welcome-body">
                <div class="welcome-top-meta">
                    <span class="welcome-badge">
                        <i data-lucide="shield-check"></i> AUTHENTICATED
                    </span>
                    <span class="welcome-role-pill ${escapeHtml(displayRole.toLowerCase())}"></span>
                </div>
                <div class="welcome-headline">
                    Welcome, <span class="welcome-highlight-name"></span>
                </div>
                <div class="welcome-subtext">
                    Access granted to CICR Robotics Inventory
                </div>
            </div>
            <button class="toast-close-btn" title="Dismiss">
                <i data-lucide="x" style="width:14px;height:14px;"></i>
            </button>
            <div class="welcome-progress-track">
                <div class="welcome-progress-fill"></div>
            </div>
        `;

        const letterEl = toast.querySelector<HTMLElement>('.welcome-avatar-letter');
        if (letterEl) letterEl.textContent = initial;
        const rolePill = toast.querySelector<HTMLElement>('.welcome-role-pill');
        if (rolePill) rolePill.textContent = displayRole;
        const nameEl = toast.querySelector<HTMLElement>('.welcome-highlight-name');
        if (nameEl) nameEl.textContent = userName;

        toast.querySelector('.toast-close-btn')!.addEventListener('click', () => {
            toast.classList.remove('show');
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 350);
        });

        this.container.appendChild(toast);
        renderLucideIcons(toast);

        requestAnimationFrame(() => {
            setTimeout(() => toast.classList.add('show'), 20);
        });

        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.remove('show');
                toast.classList.add('hide');
                setTimeout(() => toast.remove(), 350);
            }
        }, 5500);
    }
}
