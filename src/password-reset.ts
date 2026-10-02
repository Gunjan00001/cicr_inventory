/**
 * PasswordResetManager — direct self-service password reset.
 * Requires identifier + current password + new password (no OTP flow).
 * Depends on: toast, database, core/api, utils/authCrypto. */

import { readCurrentUser } from './core/session';
import { createLegacyAuthToken, hashPasswordClient } from './utils/authCrypto';
import { API_BASE } from './core/api';
import { ToastManager } from './toast';
import { DatabaseManager } from './database';

// ==========================================
// 6.5 Password Reset & Credential Sync Manager (No OTP)
// ==========================================
export class PasswordResetManager {
    private static resetModal: HTMLElement | null = null;
    private static directForm: HTMLFormElement | null = null;
    private static identifierInput: HTMLInputElement | null = null;
    private static currentPassInput: HTMLInputElement | null = null;
    private static newPassInput: HTMLInputElement | null = null;
    private static confirmPassInput: HTMLInputElement | null = null;
    private static errorEl: HTMLElement | null = null;

    static init() {
        this.resetModal = document.getElementById('reset-password-modal');
        this.directForm = document.getElementById('reset-direct-form') as HTMLFormElement | null;
        this.identifierInput = document.getElementById('reset-identifier') as HTMLInputElement | null;
        this.currentPassInput = document.getElementById('reset-current-password') as HTMLInputElement | null;
        this.newPassInput = document.getElementById('reset-new-password') as HTMLInputElement | null;
        this.confirmPassInput = document.getElementById('reset-confirm-password') as HTMLInputElement | null;
        this.errorEl = document.getElementById('reset-error');

        // Password visibility toggles
        const currentPassToggle = document.getElementById('reset-current-pass-toggle');
        if (currentPassToggle && this.currentPassInput && !currentPassToggle.dataset.bound) {
            currentPassToggle.dataset.bound = 'true';
            currentPassToggle.addEventListener('click', (e) => {
                e.preventDefault();
                if (!this.currentPassInput) return;
                const isPass = this.currentPassInput.type === 'password';
                this.currentPassInput.type = isPass ? 'text' : 'password';
                currentPassToggle.innerHTML = `<i data-lucide="${isPass ? 'eye-off' : 'eye'}"></i>`;
                if ((window as any).lucide && (window as any).lucide.createIcons) {
                    (window as any).lucide.createIcons();
                }
            });
        }

        const newPassToggle = document.getElementById('reset-new-pass-toggle');
        if (newPassToggle && this.newPassInput && !newPassToggle.dataset.bound) {
            newPassToggle.dataset.bound = 'true';
            newPassToggle.addEventListener('click', (e) => {
                e.preventDefault();
                if (!this.newPassInput) return;
                const isPass = this.newPassInput.type === 'password';
                this.newPassInput.type = isPass ? 'text' : 'password';
                newPassToggle.innerHTML = `<i data-lucide="${isPass ? 'eye-off' : 'eye'}"></i>`;
                if ((window as any).lucide && (window as any).lucide.createIcons) {
                    (window as any).lucide.createIcons();
                }
            });
        }

        const confirmPassToggle = document.getElementById('reset-confirm-pass-toggle');
        if (confirmPassToggle && this.confirmPassInput && !confirmPassToggle.dataset.bound) {
            confirmPassToggle.dataset.bound = 'true';
            confirmPassToggle.addEventListener('click', (e) => {
                e.preventDefault();
                if (!this.confirmPassInput) return;
                const isPass = this.confirmPassInput.type === 'password';
                this.confirmPassInput.type = isPass ? 'text' : 'password';
                confirmPassToggle.innerHTML = `<i data-lucide="${isPass ? 'eye-off' : 'eye'}"></i>`;
                if ((window as any).lucide && (window as any).lucide.createIcons) {
                    (window as any).lucide.createIcons();
                }
            });
        }

        if (this.directForm && !this.directForm.dataset.bound) {
            this.directForm.dataset.bound = 'true';
            this.directForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleDirectReset();
            });
        }

        const submitResetBtn = document.getElementById('btn-submit-reset-direct');
        if (submitResetBtn && !submitResetBtn.dataset.bound) {
            submitResetBtn.dataset.bound = 'true';
            submitResetBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleDirectReset();
            });
        }

        (window as any).openPasswordResetModal = () => this.open();
        (window as any).closePasswordResetModal = () => this.close();
    }

    static open() {
        this.init();
        if (!this.resetModal) {
            this.resetModal = document.getElementById('reset-password-modal');
        }
        if (!this.resetModal) return;

        if (this.directForm) this.directForm.reset();
        if (this.errorEl) this.errorEl.style.display = 'none';

        // Pre-fill with current user's email, roll number, or identifier
        let defaultId = '';
        try {
            const storedUser = readCurrentUser();
            defaultId = storedUser.email || storedUser.roll_number || storedUser.username || '';
        } catch { }

        if (!defaultId) {
            defaultId = localStorage.getItem('cicr_auth') || '';
        }
        if (!defaultId) {
            const currentLoginVal = (document.getElementById('login-username') as HTMLInputElement)?.value.trim();
            defaultId = currentLoginVal || '';
        }

        if (defaultId && this.identifierInput) {
            this.identifierInput.value = defaultId;
            this.identifierInput.readOnly = true;
        } else if (this.identifierInput) {
            this.identifierInput.readOnly = false;
        }

        this.resetModal.style.display = 'flex';
        void this.resetModal.offsetWidth;
        this.resetModal.classList.add('active');
        lucide.createIcons();

        if (defaultId && this.currentPassInput) {
            setTimeout(() => this.currentPassInput?.focus(), 150);
        } else if (this.identifierInput) {
            setTimeout(() => this.identifierInput?.focus(), 150);
        }
    }

    static close() {
        if (!this.resetModal) {
            this.resetModal = document.getElementById('reset-password-modal');
        }
        if (this.resetModal) {
            this.resetModal.classList.remove('active');
            setTimeout(() => {
                if (this.resetModal && !this.resetModal.classList.contains('active')) {
                    this.resetModal.style.display = 'none';
                }
            }, 260);
        }
    }

    private static async handleDirectReset() {
        if (!this.identifierInput || !this.currentPassInput || !this.newPassInput || !this.confirmPassInput) return;
        const identifier = this.identifierInput.value.trim();
        let currentPassword = this.currentPassInput.value;
        let newPassword = this.newPassInput.value;
        const confirmPassword = this.confirmPassInput.value;
        if (this.errorEl) this.errorEl.style.display = 'none';

        if (!identifier) {
            this.showError('Please enter your college email or enrollment number.');
            return;
        }

        if (!currentPassword) {
            this.showError('Please enter your current password to verify your identity.');
            return;
        }

        if (newPassword.length < 6) {
            this.showError('New password must be at least 6 characters.');
            return;
        }

        if (newPassword !== confirmPassword) {
            this.showError('New passwords do not match. Please verify and re-type.');
            return;
        }

        if (newPassword === currentPassword) {
            this.showError('New password cannot be the same as your current password.');
            return;
        }

        const rawCurrent = currentPassword;
        const rawNew = newPassword;

        // Clear sensitive plaintext inputs from DOM memory immediately
        if (this.currentPassInput) this.currentPassInput.value = '';
        if (this.newPassInput) this.newPassInput.value = '';
        if (this.confirmPassInput) this.confirmPassInput.value = '';

        const submitBtn = document.getElementById('btn-submit-reset-direct') as HTMLButtonElement | null;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Verifying Credentials...`;
            lucide.createIcons();
        }

        try {
            // Pre-hash passwords client-side so plaintext is never transmitted in Network tab
            const [hashedCurrentPassword, hashedNewPassword, legacyAuth] = await Promise.all([
                hashPasswordClient(rawCurrent),
                hashPasswordClient(rawNew),
                createLegacyAuthToken(rawCurrent)
            ]);

            const payload: Record<string, any> = {
                identifier,
                current_password: hashedCurrentPassword,
                new_password: hashedNewPassword
            };
            if (legacyAuth) {
                payload.legacy_auth = legacyAuth;
            }

            const res = await fetch(`${API_BASE}/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!res.ok) {
                this.showError(data.message || 'Password update failed. Please check your credentials.');
                return;
            }

            // Successfully updated password in database!
            ToastManager.show(
                'Password Updated & Synced',
                'Your account credentials have been securely verified and updated in the database.',
                'success'
            );

            this.close();

            const isCurrentlyLoggedIn = Boolean(localStorage.getItem('cicr_token') || localStorage.getItem('cicr_auth'));
            if (!isCurrentlyLoggedIn) {
                // Pre-populate login form with email and switch to login view
                const loginUser = document.getElementById('login-username') as HTMLInputElement | null;
                if (loginUser) loginUser.value = identifier;
                const loginPass = document.getElementById('login-password') as HTMLInputElement | null;
                if (loginPass) {
                    loginPass.value = '';
                    loginPass.focus();
                }
                newPassword = '';

                document.getElementById('go-to-login')?.click();
            }
            DatabaseManager.addLog('system', `Password successfully updated in vault database for ${identifier}.`);
        } catch (err) {
            this.showError('Network error. Unable to contact authentication server.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `<i data-lucide="shield-check"></i> Authenticate & Update Password`;
                lucide.createIcons();
            }
        }
    }

    private static showError(msg: string) {
        if (!this.errorEl) {
            this.errorEl = document.getElementById('reset-error');
        }
        if (this.errorEl) {
            this.errorEl.innerText = msg;
            this.errorEl.style.display = 'block';
            this.errorEl.style.animation = 'none';
            this.errorEl.offsetHeight;
            this.errorEl.style.animation = 'shake-error 0.4s ease';
        }
    }
}
