/**
 * ProfileViewManager — member profile HUD.
 * Renders active loans, pending requests, return history and the loan quota,
 * and syncs profile/requests/history from the backend.
 * Depends on: password-reset, profile-edit, auth, modal, core/state, core/ui. */

import { readCurrentUser } from './core/session';
import { PasswordResetManager } from './password-reset';
import { ProfileEditManager } from './profile-edit';
import { AuthManager } from './auth';
import { API_BASE } from './core/api';
import { escapeHtml, getStudentBranch } from './core/ui';
import { inventory } from './core/state';
import { ModalManager } from './modal';
import type { BorrowRecord, InventoryItem } from './types';

// ==========================================
// Profile View Manager System (Aesthetic Operator HUD)
// ==========================================
export class ProfileViewManager {
    private static isInitialized: boolean = false;
    public static activeTab: 'loans' | 'requests' | 'history' = 'loans';
    private static cachedRequests: any[] = [];
    public static cachedHistory: any[] = [];

    public static init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        // 1. Password Reset / Security button inside profile view
        const editBtn = document.getElementById('profile-edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof PasswordResetManager !== 'undefined' && typeof PasswordResetManager.open === 'function') {
                    PasswordResetManager.open();
                } else {
                    const modal = document.getElementById('reset-password-modal');
                    if (modal) modal.classList.add('active');
                }
            });
        }

        const secBtn = document.getElementById('profile-security-btn');
        if (secBtn) {
            secBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof PasswordResetManager !== 'undefined' && typeof PasswordResetManager.open === 'function') {
                    PasswordResetManager.open();
                } else {
                    const modal = document.getElementById('reset-password-modal');
                    if (modal) modal.classList.add('active');
                }
            });
        }

        // 2. Edit Profile Modal triggers (Aesthetic Operator HUD & Camera Click)
        const openEditBtn = document.getElementById('profile-open-edit-btn');
        if (openEditBtn) {
            openEditBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof ProfileEditManager !== 'undefined') {
                    ProfileEditManager.open();
                }
            });
        }

        const avatarTrigger = document.getElementById('profile-avatar-edit-trigger');
        if (avatarTrigger) {
            avatarTrigger.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof ProfileEditManager !== 'undefined') {
                    ProfileEditManager.open();
                }
            });
        }

        // 3. Profile Logout button inside profile view
        const logoutBtn = document.getElementById('profile-logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof AuthManager !== 'undefined' && typeof AuthManager.promptLogout === 'function') {
                    AuthManager.promptLogout();
                } else {
                    const navLogout = document.getElementById('nav-logout');
                    if (navLogout) navLogout.click();
                }
            });
        }

        // 4. Hardware Hub Tabs switching
        const tabBtns = document.querySelectorAll('.profile-hub-tab');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const targetTab = (btn as HTMLElement).dataset.hubTab as 'loans' | 'requests' | 'history';
                if (targetTab) {
                    this.switchTab(targetTab);
                }
            });
        });
    }

    public static switchTab(tab: 'loans' | 'requests' | 'history') {
        this.activeTab = tab;
        const tabBtns = document.querySelectorAll('.profile-hub-tab');
        tabBtns.forEach(btn => {
            const isMatch = (btn as HTMLElement).dataset.hubTab === tab;
            btn.classList.toggle('active', isMatch);
        });

        const paneLoans = document.getElementById('pane-active-loans');
        const paneRequests = document.getElementById('pane-pending-requests');
        const paneHistory = document.getElementById('pane-return-history');

        if (paneLoans) {
            paneLoans.style.display = tab === 'loans' ? 'block' : 'none';
            paneLoans.classList.toggle('active', tab === 'loans');
        }
        if (paneRequests) {
            paneRequests.style.display = tab === 'requests' ? 'block' : 'none';
            paneRequests.classList.toggle('active', tab === 'requests');
        }
        if (paneHistory) {
            paneHistory.style.display = tab === 'history' ? 'block' : 'none';
            paneHistory.classList.toggle('active', tab === 'history');
        }
    }

    public static async syncFromBackend() {
        const token = localStorage.getItem('cicr_token');
        if (!token) return;

        try {
            const headers = { 'Authorization': `Bearer ${token}` };

            // In parallel, fetch profile, hardware requests, and borrow history
            const [profileRes, requestsRes, historyRes] = await Promise.allSettled([
                fetch(`${API_BASE}/auth/profile`, { headers }),
                fetch(`${API_BASE}/borrow/requests`, { headers }),
                fetch(`${API_BASE}/borrow/history`, { headers })
            ]);

            // 1. Process profile
            if (profileRes.status === 'fulfilled' && profileRes.value.ok) {
                const json = await profileRes.value.json();
                if (json.status === 'success' && json.data) {
                    let user: any = {};
                    try {
                        user = readCurrentUser();
                    } catch { }
                    const merged = { ...user, ...json.data };
                    localStorage.setItem('cicr_user', JSON.stringify(merged));
                    if (json.data.username) {
                        localStorage.setItem('cicr_auth', json.data.username);
                    }
                }
            }

            // 2. Process hardware requests
            if (requestsRes.status === 'fulfilled' && requestsRes.value.ok) {
                const reqJson = await requestsRes.value.json();
                if (reqJson.status === 'success' && Array.isArray(reqJson.data)) {
                    this.cachedRequests = reqJson.data;
                }
            }

            // 3. Process borrow history
            if (historyRes.status === 'fulfilled' && historyRes.value.ok) {
                const histJson = await historyRes.value.json();
                if (histJson.status === 'success' && Array.isArray(histJson.data)) {
                    this.cachedHistory = histJson.data;
                }
            }

            this.render(false);
        } catch (e) {
            console.warn('[ProfileView] Backend sync notice:', e);
        }
    }

    public static render(triggerSync: boolean = true) {
        this.init();
        if (triggerSync) {
            this.syncFromBackend();
        }

        let user: any = {};
        try {
            user = readCurrentUser();
        } catch {
            user = {};
        }

        const authName = localStorage.getItem('cicr_auth') || '';
        const name = (user.name || user.username || authName || 'Operator').trim();
        const username = (user.username || (authName ? authName.toLowerCase() : 'operator')).trim();
        const role = (user.role || localStorage.getItem('cicr_user_role') || 'MEMBER').toUpperCase();
        const roll = (user.roll_number || user.roll || '').trim();
        const email = (user.email || (roll ? `${roll}@mail.jiit.ac.in` : '')).trim() || (authName.includes('@') ? authName : '');
        const branch = getStudentBranch(roll, user.branch || user.batch);

        // Hero initials & avatar image sync
        const heroAvatarFrame = document.getElementById('profile-hero-avatar-frame');
        const heroAvatarImg = document.getElementById('profile-hero-avatar-img') as HTMLImageElement;
        const heroInitial = document.getElementById('profile-hero-initial');
        if (heroAvatarImg && heroInitial) {
            if (user.avatar_url) {
                heroAvatarImg.src = user.avatar_url;
                heroAvatarImg.style.display = 'block';
                heroInitial.style.display = 'none';
                heroInitial.textContent = '';
                if (heroAvatarFrame) heroAvatarFrame.classList.add('has-avatar-img');
            } else {
                heroAvatarImg.src = '';
                heroAvatarImg.style.display = 'none';
                heroInitial.style.display = 'block';
                heroInitial.textContent = (name.charAt(0) || 'U').toUpperCase();
                if (heroAvatarFrame) heroAvatarFrame.classList.remove('has-avatar-img');
            }
        } else if (heroInitial) {
            heroInitial.textContent = (name.charAt(0) || 'U').toUpperCase();
        }

        // Sidebar avatar & initial sync
        const sidebarAvatarImg = document.getElementById('sidebar-avatar-img') as HTMLImageElement;
        const sidebarInitial = document.getElementById('profile-avatar-initial');
        if (sidebarAvatarImg && sidebarInitial) {
            const initialTextEl = document.getElementById('sidebar-avatar-initial-text');
            if (user.avatar_url) {
                sidebarAvatarImg.src = user.avatar_url;
                sidebarAvatarImg.style.display = 'block';
                sidebarInitial.classList.add('has-avatar-img');
                if (initialTextEl) {
                    initialTextEl.style.display = 'none';
                    initialTextEl.textContent = '';
                }
            } else {
                sidebarAvatarImg.src = '';
                sidebarAvatarImg.style.display = 'none';
                sidebarInitial.classList.remove('has-avatar-img');
                if (initialTextEl) {
                    initialTextEl.textContent = (name.charAt(0) || 'U').toUpperCase();
                    initialTextEl.style.display = 'flex';
                } else {
                    sidebarInitial.textContent = (name.charAt(0) || 'U').toUpperCase();
                }
            }
        } else if (sidebarInitial) {
            sidebarInitial.classList.remove('has-avatar-img');
            const initialTextEl = document.getElementById('sidebar-avatar-initial-text');
            if (initialTextEl) {
                initialTextEl.textContent = (name.charAt(0) || 'U').toUpperCase();
                initialTextEl.style.display = 'flex';
            } else {
                sidebarInitial.textContent = (name.charAt(0) || 'U').toUpperCase();
            }
        }

        const profileUserDisplay = document.getElementById('profile-username-display');
        if (profileUserDisplay) profileUserDisplay.textContent = name || username;

        const profileRoleDisplay = document.querySelector('.sidebar-profile-box .profile-role') as HTMLElement;
        if (profileRoleDisplay) {
            profileRoleDisplay.innerText = role;
            profileRoleDisplay.classList.toggle('role-admin', role === 'ADMIN');
            profileRoleDisplay.classList.toggle('role-member', role !== 'ADMIN');
            profileRoleDisplay.style.color = '';
        }

        const heroName = document.getElementById('profile-hero-display-name');
        if (heroName) heroName.textContent = name;

        const heroHandle = document.getElementById('profile-hero-handle');
        if (heroHandle) heroHandle.textContent = `@${username}`;

        const heroEmail = document.getElementById('profile-hero-email');
        if (heroEmail) heroEmail.textContent = email;

        const heroRollTag = document.getElementById('profile-hero-roll-text');
        if (heroRollTag) heroRollTag.textContent = roll ? `Roll No: ${roll}` : 'Roll: JIIT Member';

        const heroBranchTag = document.getElementById('profile-hero-branch-text');
        if (heroBranchTag) heroBranchTag.textContent = branch ? `Branch: ${branch}` : 'Branch: CSE';



        // Institutional Credentials
        const credName = document.getElementById('cred-full-name');
        if (credName) credName.textContent = name;

        const credRoll = document.getElementById('cred-roll-no');
        if (credRoll) credRoll.textContent = roll || 'Not Linked';

        const credMail = document.getElementById('cred-email');
        if (credMail) credMail.textContent = email;

        const credBranch = document.getElementById('cred-branch');
        if (credBranch) credBranch.textContent = branch || 'CSE';

        const credRol = document.getElementById('cred-role');
        if (credRol) {
            credRol.innerHTML = role === 'ADMIN'
                ? '<span class="role-pill-admin"><i data-lucide="shield-alert"></i> Administrator</span>'
                : '<span class="role-pill-member"><i data-lucide="shield-check"></i> Verified Member</span>';
        }

        // Active Hardware Loans Calculation
        const activeLoans: { item: InventoryItem; rec: BorrowRecord; origIdx: number }[] = [];
        let totalReturnedCount = 0;

        inventory.forEach(item => {
            (item.borrowedBy || []).forEach((rec, idx) => {
                if (ModalManager.isUserLoanMatch(rec)) {
                    if (rec.returned || (rec as any).status === 'RETURNED') {
                        totalReturnedCount += (rec.qty || (rec as any).quantity || 1);
                    } else {
                        activeLoans.push({ item, rec, origIdx: idx });
                    }
                }
            });
        });

        // Supplement with cachedHistory to guarantee active loans never disappear
        if (Array.isArray(this.cachedHistory)) {
            this.cachedHistory.forEach((h: any) => {
                if (h.status === 'RETURNED') {
                    if (!activeLoans.some(l => l.rec.id === h.id)) {
                        totalReturnedCount += (Number(h.quantity) || 1);
                    }
                } else if (h.status === 'BORROWED' || h.status === 'RETURN_REQUESTED') {
                    const alreadyIn = activeLoans.some(l => l.rec.id === h.id);
                    if (!alreadyIn) {
                        let item = inventory.find(i => String(i.id) === String(h.inventory_id || h.inventory?.id));
                        if (!item) {
                            item = {
                                id: String(h.inventory_id || h.inventory?.id || `item-${h.id}`),
                                name: h.inventory?.name || 'Hardware Component',
                                category: (h.inventory?.category || 'microcontrollers').toLowerCase(),
                                quantity: Number(h.quantity) || 1,
                                availableQuantity: 0,
                                location: 'Lab Shelf',
                                specs: 'Hardware Component',
                                image: h.inventory?.image || 'microchip.jpg',
                                tags: [],
                                borrowedBy: []
                            };
                        }
                        const rec: BorrowRecord = {
                            id: h.id,
                            name: h.borrower_name || h.users?.name || 'Member',
                            userName: h.borrower_name || h.users?.name || 'Member',
                            borrowerName: h.borrower_name || h.users?.name || 'Member',
                            roll: h.roll_number || h.users?.roll_number || '',
                            userRoll: h.roll_number || h.users?.roll_number || '',
                            email: h.borrower_email || h.users?.email || '',
                            userEmail: h.borrower_email || h.users?.email || '',
                            userId: h.user_id,
                            qty: Number(h.quantity) || 1,
                            purpose: h.purpose || 'Active Loan',
                            date: h.borrowed_at || new Date().toISOString(),
                            dueDate: h.due_date || null,
                            status: h.status,
                            returned: false
                        };
                        activeLoans.push({ item, rec, origIdx: 0 });
                    }
                }
            });
        }

        const MAX_LOAN_QUOTA = 5;
        const activeCount = activeLoans.length;

        // Pending requests calculation
        const pendingReqs = this.cachedRequests.filter(r => {
            const s = (r.status || '').toUpperCase();
            return s === 'PENDING' || s === 'SUBMITTED' || s === 'RETURN_REQUESTED';
        });
        const pendingCount = pendingReqs.length;

        // 1. Metric: Active Loans
        const metricActiveCount = document.getElementById('profile-metric-active-count');
        if (metricActiveCount) metricActiveCount.textContent = String(activeCount);

        const quotaPill = document.getElementById('profile-loans-quota-pill');
        if (quotaPill) quotaPill.textContent = `${activeCount} / ${MAX_LOAN_QUOTA} Slots`;

        const progressFill = document.getElementById('profile-loan-progress-fill');
        if (progressFill) {
            const pct = Math.min(100, Math.round((activeCount / MAX_LOAN_QUOTA) * 100));
            progressFill.style.width = `${pct}%`;
            progressFill.style.background = activeCount >= MAX_LOAN_QUOTA
                ? 'var(--neon-pink, #ff007a)'
                : 'linear-gradient(90deg, var(--neon-cyan, #00f0ff), #8b5cf6)';
        }

        // 2. Metric: Pending Requests
        const metricPendingCount = document.getElementById('profile-metric-pending-count');
        if (metricPendingCount) metricPendingCount.textContent = String(pendingCount);

        const pendingSub = document.getElementById('profile-pending-sub');
        if (pendingSub) {
            pendingSub.textContent = pendingCount === 0
                ? 'All manifests verified'
                : `${pendingCount} awaiting approval`;
        }

        // 3. Metric: Return History & Standing
        const metricHistory = document.getElementById('profile-metric-history-count');
        if (metricHistory) metricHistory.textContent = String(totalReturnedCount);

        const now = new Date();
        const hasOverdue = activeLoans.some(l => {
            if (!l.rec.dueDate) return false;
            const d = new Date(l.rec.dueDate);
            return !isNaN(d.getTime()) && d < now;
        });

        const metricStanding = document.getElementById('profile-metric-standing');
        if (metricStanding) {
            if (hasOverdue) {
                metricStanding.textContent = 'Action Required';
                metricStanding.className = 'metric-sub-note text-pink font-bold';
            } else {
                metricStanding.textContent = 'Clear Standing';
                metricStanding.className = 'metric-sub-note text-green';
            }
        }



        // Tab count badges
        const tabCountLoans = document.getElementById('profile-tab-count-loans');
        if (tabCountLoans) tabCountLoans.textContent = String(activeCount);

        const tabCountRequests = document.getElementById('profile-tab-count-requests');
        if (tabCountRequests) tabCountRequests.textContent = String(pendingCount);

        // Render Tab 1: Active Loans List
        const loansContainer = document.getElementById('profile-active-loans-list');
        if (loansContainer) {
            if (activeLoans.length === 0) {
                loansContainer.innerHTML = `
                    <div class="profile-empty-loans">
                        <div class="empty-icon-shield">
                            <i data-lucide="shield-check"></i>
                        </div>
                        <h4 class="empty-loans-title">All Hardware Returned & Clear</h4>
                        <p class="empty-loans-desc">You currently have no pending hardware checkouts. Your full borrowing allowance (${MAX_LOAN_QUOTA} slots) is ready for use.</p>
                        <button type="button" class="profile-browse-vault-btn" id="profile-browse-vault-btn">
                            <i data-lucide="layers"></i>
                            <span>Explore Inventory Vault</span>
                        </button>
                    </div>
                `;
                const browseBtn = document.getElementById('profile-browse-vault-btn');
                if (browseBtn) {
                    browseBtn.addEventListener('click', () => {
                        if ((window as any).switchSection) {
                            (window as any).switchSection('inventory-view');
                        }
                    });
                }
            } else {
                loansContainer.innerHTML = activeLoans.map(({ item, rec, origIdx }) => {
                    const isOverdue = rec.dueDate && new Date(rec.dueDate) < now;
                    const isReturnRequested = (rec as any).status === 'RETURN_REQUESTED';
                    const dueDateStr = rec.dueDate ? new Date(rec.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No Due Date';
                    const borrowDateStr = rec.date ? new Date(rec.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
                    const qty = rec.qty || (rec as any).quantity || 1;

                    return `
                        <div class="profile-loan-card glass ${isOverdue ? 'loan-card-overdue' : ''}">
                            <div class="loan-card-top-row">
                                <div class="loan-card-cat-wrap">
                                    <span class="loan-cat-pill">${escapeHtml((item.category || 'COMPONENT').toUpperCase())}</span>
                                    ${isOverdue ? '<span class="loan-tag tag-overdue"><i data-lucide="alert-triangle"></i> OVERDUE</span>' : ''}
                                    ${isReturnRequested ? '<span class="loan-tag tag-pending"><i data-lucide="clock"></i> RETURN REQUESTED</span>' : '<span class="loan-tag tag-active"><i data-lucide="check-circle-2"></i> ACTIVE LOAN</span>'}
                                </div>
                                <span class="loan-qty-badge">${qty} ${qty === 1 ? 'Unit' : 'Units'}</span>
                            </div>

                            <div class="loan-card-info-row">
                                <div class="loan-icon-thumb">
                                    <i data-lucide="cpu"></i>
                                </div>
                                <div class="loan-details-wrap">
                                    <h4 class="loan-item-title">${escapeHtml(item.name)}</h4>
                                    <div class="loan-meta-pills">
                                        <span><i data-lucide="calendar"></i> Borrowed: ${borrowDateStr}</span>
                                        <span class="${isOverdue ? 'text-pink font-bold' : ''}"><i data-lucide="clock"></i> Due: ${dueDateStr}</span>
                                    </div>
                                </div>
                            </div>

                            <div class="loan-card-action-bar">
                                <button type="button" class="profile-return-hw-btn ${isReturnRequested ? 'disabled' : ''}" 
                                    data-item-id="${item.id}" data-rec-idx="${origIdx}" ${isReturnRequested ? 'disabled' : ''}>
                                    <i data-lucide="${isReturnRequested ? 'clock' : 'corner-up-left'}"></i>
                                    <span>${isReturnRequested ? 'Return Pending Approval' : 'Return Component'}</span>
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');

                const returnButtons = loansContainer.querySelectorAll('.profile-return-hw-btn');
                returnButtons.forEach(btn => {
                    btn.addEventListener('click', () => {
                        const itemId = (btn as HTMLElement).dataset.itemId;
                        const origIdx = parseInt((btn as HTMLElement).dataset.recIdx || '0', 10);
                        const targetItem = inventory.find(i => String(i.id) === String(itemId))
                            || activeLoans.find(l => String(l.item.id) === String(itemId))?.item;
                        const matchingLoan = targetItem?.borrowedBy?.[origIdx]
                            || targetItem?.borrowedBy?.find((b: any) => ModalManager.isUserLoanMatch(b))
                            || activeLoans.find(l => String(l.item.id) === String(itemId))?.rec;
                        if (targetItem && matchingLoan) {
                            ModalManager.openReturnModal(matchingLoan, targetItem, origIdx);
                        }
                    });
                });
            }
        }

        // Render Tab 2: Pending Requests List
        const requestsContainer = document.getElementById('profile-pending-requests-list');
        if (requestsContainer) {
            if (this.cachedRequests.length === 0) {
                requestsContainer.innerHTML = `
                    <div class="profile-empty-loans">
                        <div class="empty-icon-shield" style="background: rgba(189, 0, 255, 0.12); border-color: rgba(189, 0, 255, 0.3); color: var(--neon-purple);">
                            <i data-lucide="check-check"></i>
                        </div>
                        <h4 class="empty-loans-title">No Pending Requests</h4>
                        <p class="empty-loans-desc">You have no hardware checkout requests currently awaiting administrator review.</p>
                        <button type="button" class="profile-browse-vault-btn" id="profile-req-browse-btn">
                            <i data-lucide="shopping-bag"></i>
                            <span>Browse Vault & Request Hardware</span>
                        </button>
                    </div>
                `;
                document.getElementById('profile-req-browse-btn')?.addEventListener('click', () => {
                    if ((window as any).switchSection) (window as any).switchSection('inventory-view');
                });
            } else {
                requestsContainer.innerHTML = this.cachedRequests.map(req => {
                    const status = (req.status || 'PENDING').toUpperCase();
                    const statusClass = status === 'APPROVED' ? 'tag-active' : (status === 'REJECTED' ? 'tag-overdue' : 'tag-pending');
                    const reqDate = req.created_at ? new Date(req.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';
                    const items = Array.isArray(req.items) ? req.items : (req.item ? [req.item] : []);

                    return `
                        <div class="profile-request-card">
                            <div class="profile-request-header">
                                <span class="profile-request-title"><i data-lucide="file-text" style="width:13px;height:13px;display:inline-block;vertical-align:middle;"></i> Request #${String(req.id).slice(0, 8)}</span>
                                <span class="loan-tag ${statusClass}">${status}</span>
                            </div>
                            <div style="font-size: 11.5px; color: #94a3b8; display:flex; gap: 12px; flex-wrap: wrap;">
                                <span><i data-lucide="calendar" style="width:11px;height:11px;display:inline-block;vertical-align:middle;"></i> ${reqDate}</span>
                                ${req.purpose ? `<span><i data-lucide="target" style="width:11px;height:11px;display:inline-block;vertical-align:middle;"></i> ${escapeHtml(req.purpose)}</span>` : ''}
                            </div>
                            ${items.length > 0 ? `
                                <div class="profile-request-items-list">
                                    ${items.map((it: any) => `
                                        <div class="profile-request-item-row">
                                            <span>${escapeHtml(it.name || it.item_name || 'Component')}</span>
                                            <span style="color: var(--neon-cyan); font-weight:700;">x${it.quantity || it.qty || 1}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('');
            }
        }

        // Render Tab 3: Return History List
        const historyContainer = document.getElementById('profile-return-history-list');
        if (historyContainer) {
            const returnedRecords = this.cachedHistory.filter(h => h.status === 'RETURNED' || h.returned_at);
            if (returnedRecords.length === 0) {
                historyContainer.innerHTML = `
                    <div class="profile-empty-loans">
                        <div class="empty-icon-shield">
                            <i data-lucide="history"></i>
                        </div>
                        <h4 class="empty-loans-title">No Return Records</h4>
                        <p class="empty-loans-desc">Completed return transactions and inspection logs will appear here.</p>
                    </div>
                `;
            } else {
                historyContainer.innerHTML = returnedRecords.map(rec => {
                    const retDate = rec.returned_at ? new Date(rec.returned_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Verified';
                    const itemName = rec.inventory?.name || rec.item_name || rec.borrower_name || 'Lab Asset';
                    const qty = rec.quantity || rec.qty || 1;

                    return `
                        <div class="profile-loan-card">
                            <div class="loan-card-top-row">
                                <div class="loan-card-cat-wrap">
                                    <span class="loan-cat-pill">RETURNED</span>
                                    <span class="loan-tag tag-active"><i data-lucide="check"></i> VERIFIED BY ADMIN</span>
                                </div>
                                <span class="loan-qty-badge">${qty} ${qty === 1 ? 'Unit' : 'Units'}</span>
                            </div>
                            <div class="loan-card-info-row">
                                <div class="loan-icon-thumb" style="color: #10b981; border-color: rgba(16, 185, 129, 0.25); background: rgba(16, 185, 129, 0.1);">
                                    <i data-lucide="package-check"></i>
                                </div>
                                <div class="loan-details-wrap">
                                    <h4 class="loan-item-title">${itemName}</h4>
                                    <div class="loan-meta-pills">
                                        <span><i data-lucide="calendar"></i> Returned On: ${retDate}</span>
                                        <span><i data-lucide="shield-check"></i> Restocked to Vault</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // Recreate Lucide icons for freshly injected HTML
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }
    }
}

(window as any).ProfileViewManager = ProfileViewManager;
