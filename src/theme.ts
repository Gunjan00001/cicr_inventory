/**
 * ThemeManager — applies and persists the three visual themes
 * (light / mono / decent) and syncs Background3D particle colors. */

// ==========================================
// Theme Manager System
// ==========================================
export class ThemeManager {
    private static themeSelectEl: HTMLSelectElement | null = null;
    private static navThemeSelectEl: HTMLSelectElement | null = null;
    private static headerThemeSelectEl: HTMLSelectElement | null = null;

    public static init() {

        this.themeSelectEl = document.getElementById('theme-select') as HTMLSelectElement;
        this.navThemeSelectEl = document.getElementById('nav-theme-select') as HTMLSelectElement;
        this.headerThemeSelectEl = document.getElementById('header-theme-select') as HTMLSelectElement;

        const storedTheme = localStorage.getItem('cicr_vault_theme') || localStorage.getItem('cicr_theme');
        // Primary default theme: Robosoccer ('light')
        let defaultTheme = 'light';
        if (storedTheme === 'mono') {
            defaultTheme = 'mono';
        } else if (storedTheme === 'decent') {
            defaultTheme = 'decent';
        } else if (storedTheme === 'light') {
            defaultTheme = 'light';
        } else {
            defaultTheme = 'light';
        }
        this.applyTheme(defaultTheme);

        if (this.themeSelectEl) {
            this.themeSelectEl.value = defaultTheme;
            this.themeSelectEl.addEventListener('change', (e) => {
                const val = (e.target as HTMLSelectElement).value;
                this.applyTheme(val);
            });
        }

        if (this.navThemeSelectEl) {
            this.navThemeSelectEl.value = defaultTheme;
            this.navThemeSelectEl.addEventListener('change', (e) => {
                const val = (e.target as HTMLSelectElement).value;
                this.applyTheme(val);
            });
        }

        if (this.headerThemeSelectEl) {
            this.headerThemeSelectEl.value = defaultTheme;
            this.headerThemeSelectEl.addEventListener('change', (e) => {
                const val = (e.target as HTMLSelectElement).value;
                this.applyTheme(val);
            });
        }

        const themeBtnLight = document.getElementById('theme-btn-light');
        const themeBtnMono = document.getElementById('theme-btn-mono');
        const themeBtnDecent = document.getElementById('theme-btn-decent');

        if (themeBtnLight) {
            themeBtnLight.addEventListener('click', () => {
                this.applyTheme('light');
            });
        }
        if (themeBtnMono) {
            themeBtnMono.addEventListener('click', () => {
                this.applyTheme('mono');
            });
        }
        if (themeBtnDecent) {
            themeBtnDecent.addEventListener('click', () => {
                this.applyTheme('decent');
            });
        }

        const authThemeToggle = document.getElementById('auth-theme-toggle');
        if (authThemeToggle) {
            authThemeToggle.addEventListener('click', (e) => {
                e.preventDefault();
                const cur = document.documentElement.getAttribute('data-theme') || 'light';
                const themeCycle = ['light', 'decent', 'mono'];
                const nextIdx = (themeCycle.indexOf(cur) + 1) % themeCycle.length;
                this.applyTheme(themeCycle[nextIdx]);
            });
        }
    }

    public static applyTheme(theme: string) {
        if (theme !== 'light' && theme !== 'mono' && theme !== 'decent') {
            theme = 'light';
        }

        // Direct, non-blocking class & attribute switches
        document.documentElement.setAttribute('data-theme', theme);
        document.body.classList.remove('theme-light', 'theme-mono', 'theme-decent');
        document.body.classList.add(`theme-${theme}`);
        localStorage.setItem('cicr_vault_theme', theme);
        localStorage.setItem('cicr_theme', theme);

        const authThemeLabel = document.querySelector('.auth-theme-label');
        if (authThemeLabel) {
            if (theme === 'light') {
                authThemeLabel.textContent = 'Robosoccer';
            } else if (theme === 'decent') {
                authThemeLabel.textContent = 'Cyber Decent';
            } else {
                authThemeLabel.textContent = 'Midnight Mono';
            }
        }

        if (this.themeSelectEl && this.themeSelectEl.value !== theme) {
            this.themeSelectEl.value = theme;
        }
        if (this.navThemeSelectEl && this.navThemeSelectEl.value !== theme) {
            this.navThemeSelectEl.value = theme;
        }
        if (this.headerThemeSelectEl && this.headerThemeSelectEl.value !== theme) {
            this.headerThemeSelectEl.value = theme;
        }

        // Fast toggle for sidebar theme buttons
        const themeBtnLight = document.getElementById('theme-btn-light');
        const themeBtnMono = document.getElementById('theme-btn-mono');
        const themeBtnDecent = document.getElementById('theme-btn-decent');
        if (themeBtnLight) themeBtnLight.classList.toggle('active', theme === 'light');
        if (themeBtnMono) themeBtnMono.classList.toggle('active', theme === 'mono');
        if (themeBtnDecent) themeBtnDecent.classList.toggle('active', theme === 'decent');

        if (window.bg3D) {
            window.bg3D.updateThemeColors(theme);
        }
    }
}
