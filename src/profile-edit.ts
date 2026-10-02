/**
 * ProfileEditManager — profile edit modal, avatar crop/upload and profile save.
 * Depends on: password-reset, toast, profile-view, admin, core/api, core/ui. */

import { readCurrentUser } from './core/session';
import { PasswordResetManager } from './password-reset';
import { ToastManager } from './toast';
import { getStudentBranch } from './core/ui';
import { API_BASE } from './core/api';
import { ProfileViewManager } from './profile-view';
import { AdminManager } from './admin';

// ==========================================
// Profile Edit Manager System (Avatar & Details Sync)
// ==========================================
export class ProfileEditManager {
    private static isInitialized = false;
    private static pendingAvatarUrl: string | null | undefined = undefined;

    public static init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        const modal = document.getElementById('edit-profile-modal');
        const closeBtn = document.getElementById('close-edit-profile-modal');
        const cancelBtn = document.getElementById('cancel-edit-profile-btn');
        const form = document.getElementById('edit-profile-form') as HTMLFormElement;
        const fileInput = document.getElementById('edit-avatar-file-input') as HTMLInputElement;
        const resetAvatarBtn = document.getElementById('edit-avatar-remove-btn');
        const modalSecurityBtn = document.getElementById('edit-profile-security-btn');

        if (closeBtn) closeBtn.addEventListener('click', () => this.close());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.close());

        if (modalSecurityBtn) {
            modalSecurityBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.close();
                if (typeof PasswordResetManager !== 'undefined' && typeof PasswordResetManager.open === 'function') {
                    PasswordResetManager.open();
                } else if ((window as any).openPasswordResetModal) {
                    (window as any).openPasswordResetModal();
                } else {
                    const resetModal = document.getElementById('reset-password-modal');
                    if (resetModal) resetModal.classList.add('active');
                }
            });
        }

        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.close();
            });
        }

        if (fileInput) {
            fileInput.addEventListener('change', async (e) => {
                const files = (e.target as HTMLInputElement).files;
                if (!files || files.length === 0) return;
                const file = files[0];

                if (!file.type.startsWith('image/')) {
                    ToastManager.show('Invalid Format', 'Please choose a PNG, JPG, or WEBP image file.', 'warning');
                    return;
                }

                if (file.size > 8 * 1024 * 1024) {
                    ToastManager.show('File Too Large', 'Please select an image smaller than 8MB.', 'warning');
                    return;
                }

                try {
                    const compressedBase64 = await this.compressAndCropAvatar(file);
                    this.pendingAvatarUrl = compressedBase64;
                    this.updatePreview(compressedBase64);
                } catch (err: any) {
                    ToastManager.show('Image Processing Error', 'Could not process selected image.', 'error');
                }
            });
        }

        if (resetAvatarBtn) {
            resetAvatarBtn.addEventListener('click', () => {
                this.pendingAvatarUrl = '';
                this.updatePreview('');
            });
        }

        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.saveProfile();
            });
        }
    }

    private static updatePreview(avatarUrl: string | null | undefined) {
        const previewImg = document.getElementById('edit-avatar-img-preview') as HTMLImageElement;
        const previewInitial = document.getElementById('edit-avatar-initial-preview');
        const nameInput = document.getElementById('edit-profile-name') as HTMLInputElement;
        const char = (nameInput?.value || 'U').charAt(0).toUpperCase();

        const editFrame = document.getElementById('edit-avatar-preview-frame');
        if (previewImg && previewInitial) {
            if (avatarUrl) {
                previewImg.src = avatarUrl;
                previewImg.style.display = 'block';
                previewInitial.style.display = 'none';
                previewInitial.textContent = '';
                if (editFrame) editFrame.classList.add('has-avatar-img');
            } else {
                previewImg.src = '';
                previewImg.style.display = 'none';
                previewInitial.textContent = char;
                previewInitial.style.display = 'flex';
                if (editFrame) editFrame.classList.remove('has-avatar-img');
            }
        }
    }

    private static compressAndCropAvatar(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (readerEvent) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const size = 256;
                    canvas.width = size;
                    canvas.height = size;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('Canvas context not available'));
                        return;
                    }

                    // Crop to center square
                    const minDim = Math.min(img.width, img.height);
                    const startX = (img.width - minDim) / 2;
                    const startY = (img.height - minDim) / 2;

                    ctx.drawImage(img, startX, startY, minDim, minDim, 0, 0, size, size);

                    try {
                        const dataUrl = canvas.toDataURL('image/webp', 0.86);
                        if (dataUrl && dataUrl.startsWith('data:image/webp')) {
                            resolve(dataUrl);
                            return;
                        }
                    } catch { }

                    resolve(canvas.toDataURL('image/jpeg', 0.86));
                };
                img.onerror = reject;
                img.src = readerEvent.target?.result as string;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    public static open() {
        this.init();

        let user: any = {};
        try {
            user = readCurrentUser();
        } catch {
            user = {};
        }

        const nameInput = document.getElementById('edit-profile-name') as HTMLInputElement;
        const usernameInput = document.getElementById('edit-profile-username') as HTMLInputElement;
        const branchInput = document.getElementById('edit-profile-branch') as HTMLInputElement;
        const emailInput = document.getElementById('edit-profile-email') as HTMLInputElement;
        const rollInput = document.getElementById('edit-profile-roll') as HTMLInputElement;
        const errorEl = document.getElementById('edit-profile-error');

        const authName = localStorage.getItem('cicr_auth') || '';
        const name = (user.name || user.username || authName || '').trim();
        const username = (user.username || (authName ? authName.toLowerCase() : '')).trim();
        const roll = (user.roll_number || user.roll || '').trim();
        const email = (user.email || (roll ? `${roll}@mail.jiit.ac.in` : '')).trim();
        const branch = getStudentBranch(roll, user.branch || user.batch);

        if (nameInput) nameInput.value = name;
        if (usernameInput) usernameInput.value = username;
        if (branchInput) branchInput.value = branch;
        if (emailInput) {
            emailInput.value = email || (roll ? `${roll}@mail.jiit.ac.in` : '');
            emailInput.readOnly = true;
            emailInput.disabled = true;
        }
        if (rollInput) {
            rollInput.value = roll || '';
            rollInput.readOnly = false;
            rollInput.disabled = false;
        }

        this.pendingAvatarUrl = user.avatar_url;
        this.updatePreview(user.avatar_url);

        if (errorEl) {
            errorEl.style.display = 'none';
            errorEl.textContent = '';
        }

        const modal = document.getElementById('edit-profile-modal');
        if (modal) {
            modal.classList.add('active');
            modal.style.display = 'flex';
        }

        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }
    }

    public static close() {
        const modal = document.getElementById('edit-profile-modal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
        }
        this.pendingAvatarUrl = undefined;
    }

    private static async saveProfile() {
        const nameInput = document.getElementById('edit-profile-name') as HTMLInputElement;
        const usernameInput = document.getElementById('edit-profile-username') as HTMLInputElement;
        const branchInput = document.getElementById('edit-profile-branch') as HTMLInputElement;
        const rollInput = document.getElementById('edit-profile-roll') as HTMLInputElement;
        const saveBtn = document.getElementById('save-edit-profile-btn') as HTMLButtonElement;
        const errorEl = document.getElementById('edit-profile-error');

        const newName = nameInput ? nameInput.value.trim() : '';
        const newUsername = usernameInput ? usernameInput.value.trim() : '';
        const newBranch = branchInput ? branchInput.value.trim() : '';
        const newRoll = rollInput ? rollInput.value.trim() : '';

        if (!newName) {
            if (errorEl) {
                errorEl.textContent = 'Full name is required.';
                errorEl.style.display = 'block';
            }
            return;
        }

        if (errorEl) {
            errorEl.style.display = 'none';
            errorEl.textContent = '';
        }

        const origBtnHtml = saveBtn ? saveBtn.innerHTML : 'Save & Sync';
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> <span>Saving to Vault...</span>';
            if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
        }

        let user: any = {};
        try {
            user = readCurrentUser();
        } catch { }

        const token = localStorage.getItem('cicr_token') || '';
        const payload: any = {
            name: newName,
            username: newUsername || undefined,
            branch: newBranch || undefined,
            batch: newBranch || undefined,
            roll_number: newRoll || undefined
        };

        if (this.pendingAvatarUrl !== undefined) {
            payload.avatar_url = this.pendingAvatarUrl || null;
        }

        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            let cloudSync = false;
            let updatedUser: any = null;

            try {
                const res = await fetch(`${API_BASE}/auth/profile`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify(payload)
                });

                const data = await res.json().catch(() => ({}));

                if (res.ok && data.status === 'success') {
                    cloudSync = true;
                    updatedUser = data.data;
                } else {
                    console.warn('Backend profile update note:', data.message);
                }
            } catch (netErr) {
                console.warn('Backend unreachable, saving profile locally:', netErr);
            }

            if (!updatedUser) {
                updatedUser = {
                    ...user,
                    name: newName,
                    username: newUsername || user.username,
                    branch: newBranch || user.branch,
                    batch: newBranch || user.batch,
                    roll_number: newRoll || user.roll_number,
                    avatar_url: this.pendingAvatarUrl !== undefined ? (this.pendingAvatarUrl || null) : user.avatar_url
                };
            }

            // Update local storage
            localStorage.setItem('cicr_user', JSON.stringify(updatedUser));
            if (updatedUser.username) {
                localStorage.setItem('cicr_auth', updatedUser.username);
            }
            if (updatedUser.role) {
                localStorage.setItem('cicr_role', updatedUser.role);
            }

            // Sync with other active UI components
            const navUserName = document.getElementById('nav-user-name');
            if (navUserName) navUserName.textContent = updatedUser.name || updatedUser.username;

            const profileUserDisplay = document.getElementById('profile-username-display');
            if (profileUserDisplay) profileUserDisplay.textContent = updatedUser.name || updatedUser.username;

            // Update avatar in sidebar & profile view
            ProfileViewManager.render(false);

            // Synchronize with AdminManager so dashboard queues and user tables update immediately
            if (typeof AdminManager !== 'undefined' && typeof AdminManager.syncFromBackend === 'function') {
                AdminManager.syncFromBackend(true);
            }

            if (cloudSync) {
                ToastManager.show('Profile Synchronized', 'Your identity and profile picture are securely saved in the database.', 'success');
            } else {
                ToastManager.show('Profile Saved', 'Profile details updated and cached locally.', 'success');
            }
            this.close();
        } catch (err: any) {
            console.error('Save profile error:', err);
            if (errorEl) {
                errorEl.textContent = err.message || 'Error synchronizing with backend.';
                errorEl.style.display = 'block';
            }
            ToastManager.show('Update Failed', err.message || 'Could not update profile.', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = origBtnHtml;
                if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
            }
        }
    }
}

(window as any).ProfileEditManager = ProfileEditManager;

(window as any).openProfileEditModal = () => ProfileEditManager.open();

(window as any).closeProfileEditModal = () => ProfileEditManager.close();
