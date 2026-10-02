/**
 * AdminManager — the administrator control center.
 *
 * Responsibilities
 * - Member approval/rejection queue and role changes.
 * - Hardware issue/return request queue (approve/reject).
 * - 7-day audit stream with category filters, search and telemetry.
 * - Inventory add/delete actions and the user profile inspector.
 *
 * Large by nature; logical sections are marked with banner comments.
 * Depends on: toast, modal, database, notification-center, hardware-ledger,
 * dashboard, auth, core/state, core/api, core/ui, core/domain. */

import { readCurrentUser } from './core/session';
import { ToastManager } from './toast';
import { ModalManager } from './modal';
import { API_BASE } from './core/api';
import { inventory, requests, selectedItem, setInventory } from './core/state';
import { DatabaseManager } from './database';
import { escapeHtml, getStudentBranch, renderLucideIcons } from './core/ui';
import { NotificationCenterManager } from './notification-center';
import { HardwareLedgerManager } from './hardware-ledger';
import { DashboardManager } from './dashboard';
import { AuthManager } from './auth';
import type { AdminHardwareRequest } from './core/domain';
import type { RequestRecord } from './types';
import { buildAuditCard, computeAuditCategoryCounts, filterAuditLogsByCategory, filterAuditLogsByRange, filterAuditLogsBySearch } from './admin-audit';

interface AdminUserRecord {
    id: string;
    name: string;
    email: string;
    username?: string | null;
    batch?: string | null;
    branch?: string | null;
    roll_number: string | null;
    avatar_url?: string | null;
    role: 'ADMIN' | 'MEMBER';
    status: 'APPROVED' | 'PENDING' | 'REJECTED';
    isMasterAdmin?: boolean;
    created_at: string;
}

export class AdminManager {
    public static users: AdminUserRecord[] = [];
    public static hardwareRequests: AdminHardwareRequest[] = [];
    public static userHardwareRequests: AdminHardwareRequest[] = [];
    public static auditLogs: any[] = [];

    public static getUserAvatar(emailOrId?: string | null): string | null {
        if (!emailOrId) return null;
        const clean = emailOrId.toLowerCase().trim();
        const match = this.users.find(u =>
            (u.email && u.email.toLowerCase() === clean) ||
            (u.id && u.id === emailOrId) ||
            (u.roll_number && u.roll_number.toLowerCase() === clean)
        );
        if (match?.avatar_url) return match.avatar_url;

        try {
            const current = readCurrentUser();
            if (current && ((current.email && current.email.toLowerCase() === clean) || current.id === emailOrId)) {
                if (current.avatar_url) return current.avatar_url;
            }
        } catch {}

        return null;
    }
    private static activeAuditCategory = 'all';
    private static auditSearchTerm = '';
    private static activeUserRoleFilter = 'all';
    private static isInitialized = false;
    private static lastHardwareQueueFingerprint = '';
    private static lastPendingQueueFingerprint = '';
    private static lastUsersTableFingerprint = '';

    static init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        const refreshBtn = document.getElementById('admin-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                const icon = refreshBtn.querySelector('i');
                if (icon) icon.classList.add('animate-spin');
                refreshBtn.setAttribute('disabled', 'true');
                try {
                    await this.loadUsers(true);
                    ToastManager.show('Directory Refreshed', 'User accounts and roles updated.', 'info');
                } finally {
                    if (icon) icon.classList.remove('animate-spin');
                    refreshBtn.removeAttribute('disabled');
                }
            });
        }

        const hwRefreshBtn = document.getElementById('admin-hw-refresh-btn');
        if (hwRefreshBtn) {
            hwRefreshBtn.addEventListener('click', async () => {
                const icon = hwRefreshBtn.querySelector('i');
                if (icon) icon.classList.add('animate-spin');
                hwRefreshBtn.setAttribute('disabled', 'true');
                try {
                    await this.loadHardwareRequests(true);
                    ToastManager.show('Queue Refreshed', 'Hardware issue requests updated.', 'info');
                } finally {
                    if (icon) icon.classList.remove('animate-spin');
                    hwRefreshBtn.removeAttribute('disabled');
                }
            });
        }

        const rolePills = document.getElementById('admin-users-role-pills');
        if (rolePills) {
            rolePills.querySelectorAll<HTMLButtonElement>('.audit-pill').forEach(pill => {
                pill.addEventListener('click', () => {
                    const filter = pill.getAttribute('data-user-filter') || 'all';
                    this.activeUserRoleFilter = filter;
                    rolePills.querySelectorAll('.audit-pill').forEach(p => p.classList.toggle('active', p === pill));
                    const searchInput = document.getElementById('admin-users-search') as HTMLInputElement;
                    this.renderUsersTable(this.filterUsers(searchInput ? searchInput.value : ''));
                });
            });
        }

        const searchInput = document.getElementById('admin-users-search') as HTMLInputElement;
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.renderUsersTable(this.filterUsers(searchInput.value));
            });
        }

        const auditRefreshBtn = document.getElementById('admin-audit-refresh-btn');
        if (auditRefreshBtn) {
            auditRefreshBtn.addEventListener('click', async () => {
                const icon = auditRefreshBtn.querySelector('i');
                if (icon) icon.classList.add('animate-spin');
                auditRefreshBtn.setAttribute('disabled', 'true');
                try {
                    await this.loadAuditLogs();
                    ToastManager.show('Audit Refreshed', '7-Day system audit logs updated.', 'info');
                } finally {
                    if (icon) icon.classList.remove('animate-spin');
                    auditRefreshBtn.removeAttribute('disabled');
                }
            });
        }

        const show7DaysBtn = document.getElementById('admin-audit-show-7days-btn');
        if (show7DaysBtn) {
            show7DaysBtn.addEventListener('click', async () => {
                const icon = show7DaysBtn.querySelector('i');
                if (icon) icon.classList.add('animate-spin');
                show7DaysBtn.setAttribute('disabled', 'true');
                try {
                    await this.loadAuditLogs(true);
                    ToastManager.show('7-Day History Loaded', `Displaying complete 7-day activity ledger (${this.auditLogs.length} events).`, 'success');
                } finally {
                    if (icon) icon.classList.remove('animate-spin');
                    show7DaysBtn.removeAttribute('disabled');
                }
            });
        }

        const footerAllBtn = document.getElementById('admin-audit-footer-all-btn');
        if (footerAllBtn) {
            footerAllBtn.addEventListener('click', async () => {
                await this.loadAuditLogs(true);
                ToastManager.show('7-Day History Loaded', `Displaying all ${this.auditLogs.length} records across 7 days.`, 'success');
            });
        }

        const rangePills = document.querySelectorAll('#admin-audit-range-pills .audit-range-pill');
        rangePills.forEach(pill => {
            pill.addEventListener('click', async () => {
                rangePills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.activeAuditDaysRange = Number(pill.getAttribute('data-range-days') || '7');
                this.activeAuditDay = 'all';
                // Immediate client-side re-render for instantaneous tactile responsiveness
                this.renderAuditLogs();
                await this.loadAuditLogs();
            });
        });

        const auditExportBtn = document.getElementById('admin-audit-export-btn');
        if (auditExportBtn) {
            auditExportBtn.addEventListener('click', () => {
                this.exportAuditLogsCSV();
            });
        }

        const auditCleanupBtn = document.getElementById('admin-audit-cleanup-btn');
        if (auditCleanupBtn) {
            auditCleanupBtn.addEventListener('click', async () => {
                await this.triggerAuditRetentionCleanup();
            });
        }

        const auditSearch = document.getElementById('admin-audit-search') as HTMLInputElement;
        const auditSearchClear = document.getElementById('admin-audit-search-clear');
        if (auditSearch) {
            auditSearch.addEventListener('input', () => {
                this.auditSearchTerm = auditSearch.value.trim().toLowerCase();
                if (auditSearchClear) {
                    auditSearchClear.style.display = this.auditSearchTerm ? 'inline-flex' : 'none';
                }
                this.renderAuditLogs();
            });
        }
        if (auditSearchClear && auditSearch) {
            auditSearchClear.addEventListener('click', () => {
                auditSearch.value = '';
                this.auditSearchTerm = '';
                auditSearchClear.style.display = 'none';
                this.renderAuditLogs();
            });
        }

        const auditPills = document.querySelectorAll('#admin-audit-pills .audit-pill');
        auditPills.forEach(pill => {
            pill.addEventListener('click', () => {
                auditPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.activeAuditCategory = (pill as HTMLElement).dataset.auditCat || 'all';
                this.loadAuditLogs();
            });
        });

        // Wire Audit Detail modal close & copy JSON
        const closeAuditModal = document.getElementById('close-audit-detail');
        const auditModal = document.getElementById('audit-detail-modal');
        if (closeAuditModal && auditModal) {
            closeAuditModal.addEventListener('click', () => {
                auditModal.classList.remove('active');
            });
            auditModal.addEventListener('click', (e) => {
                if (e.target === auditModal) auditModal.classList.remove('active');
            });
        }
        const copyJsonBtn = document.getElementById('audit-copy-json-btn');
        if (copyJsonBtn) {
            copyJsonBtn.addEventListener('click', () => {
                const pre = document.getElementById('audit-modal-json');
                if (pre && pre.innerText) {
                    navigator.clipboard.writeText(pre.innerText).then(() => {
                        ToastManager.show('Copied', 'Raw telemetry event JSON copied to clipboard.', 'success');
                    }).catch(() => {});
                }
            });
        }

        // Wire User Profile Inspector for clickable user items in Admin Portal & Ledger
        document.addEventListener('click', (e) => {
            const target = (e.target as HTMLElement).closest('.admin-user-clickable') as HTMLElement | null;
            if (target) {
                e.preventDefault();
                e.stopPropagation();
                AdminManager.inspectUserProfile({
                    id: target.dataset.userId,
                    name: target.dataset.userName,
                    email: target.dataset.userEmail,
                    roll: target.dataset.userRoll,
                    batch: target.dataset.userBatch
                });
            }
        });

        // Secure event delegation for admin actions (prevents global window exposure and inline script execution)
        const pendingContainer = document.getElementById('admin-pending-list');
        if (pendingContainer && !pendingContainer.dataset.boundDelegation) {
            pendingContainer.dataset.boundDelegation = 'true';
            pendingContainer.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const approveBtn = target.closest<HTMLElement>('[data-action="approve"]');
                if (approveBtn) {
                    e.stopPropagation();
                    const id = approveBtn.dataset.userId;
                    if (id) this.approveUser(id);
                    return;
                }
                const rejectBtn = target.closest<HTMLElement>('[data-action="reject"]');
                if (rejectBtn) {
                    e.stopPropagation();
                    const id = rejectBtn.dataset.userId;
                    if (id) this.rejectUser(id);
                    return;
                }
            });
        }

        const usersTbody = document.getElementById('admin-users-tbody');
        if (usersTbody && !usersTbody.dataset.boundDelegation) {
            usersTbody.dataset.boundDelegation = 'true';
            usersTbody.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const setRoleBtn = target.closest<HTMLElement>('[data-action="set-role"]');
                if (setRoleBtn) {
                    e.stopPropagation();
                    const id = setRoleBtn.dataset.userId;
                    const role = setRoleBtn.dataset.role as 'ADMIN' | 'MEMBER';
                    if (id && role) this.setRole(id, role);
                    return;
                }
                const delBtn = target.closest<HTMLElement>('[data-action="delete"]');
                if (delBtn) {
                    e.stopPropagation();
                    const id = delBtn.dataset.userId;
                    const name = delBtn.dataset.userName || '';
                    if (id) this.deleteUser(id, name);
                    return;
                }
            });
        }

        const hwList = document.getElementById('admin-hardware-list');
        if (hwList && !hwList.dataset.boundDelegation) {
            hwList.dataset.boundDelegation = 'true';
            hwList.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const approveBtn = target.closest<HTMLElement>('[data-action="hw-approve"]');
                if (approveBtn) {
                    e.stopPropagation();
                    const id = approveBtn.dataset.requestId;
                    if (id) this.approveHardware(id);
                    return;
                }
                const rejectBtn = target.closest<HTMLElement>('[data-action="hw-reject"]');
                if (rejectBtn) {
                    e.stopPropagation();
                    const id = rejectBtn.dataset.requestId;
                    if (id) this.rejectHardware(id);
                    return;
                }
            });
        }

        const auditList = document.getElementById('admin-audit-stream') || document.getElementById('admin-audit-list');
        if (auditList && !auditList.dataset.boundDelegation) {
            auditList.dataset.boundDelegation = 'true';
            auditList.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const card = target.closest<HTMLElement>('[data-log-id]');
                if (card && card.dataset.logId) {
                    this.openAuditDetail(card.dataset.logId);
                }
            });
        }

        (window as any).openBulkReturnModal = () => ModalManager.openBulkReturnModal();
        (window as any).inspectUserProfile = (info: any) => AdminManager.inspectUserProfile(info);
    }

    public static async syncFromBackend(force = false) {
        await this.loadUsers(force);
    }

    static async loadUsers(force = false) {
        const token = localStorage.getItem('cicr_token');
        const isAuth = document.body.classList.contains('authenticated') || document.documentElement.classList.contains('is-authenticated');

        if (token && isAuth) {
            try {
                const res = await fetch(`${API_BASE}/auth/admin/users${force ? '?force=true' : ''}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (res.ok) {
                    const result = await res.json();
                    if (Array.isArray(result.data)) {
                        this.users = result.data.filter((u: any) => {
                            const email = (u?.email || '').toLowerCase().trim();
                            const name = (u?.name || '').toLowerCase().trim();
                            if (email.endsWith('.test') || email.includes('cicr.test')) return false;
                            if (name === 'test user' || name === 'test admin' || name === 'admin user' || name === 'test student') return false;
                            return true;
                        });
                    }
                } else if (res.status === 401 || res.status === 403) {
                    console.warn('[AdminManager] Admin users access restricted.');
                    return;
                }
            } catch (err) {
                console.error('Failed to fetch admin users:', err);
            }
        }


        this.updateStats();
        this.renderPendingQueue(force);

        const searchInput = document.getElementById('admin-users-search') as HTMLInputElement;
        const query = searchInput ? searchInput.value : '';
        this.renderUsersTable(this.filterUsers(query), force);
    }

    static getHandledRequestIds(): Set<string> {
        try {
            const raw = localStorage.getItem('cicr_dismissed_requests');
            return new Set<string>(raw ? JSON.parse(raw) : []);
        } catch {
            return new Set<string>();
        }
    }

    static getRequestCanonicalKey(r: any): string {
        if (!r) return '';
        const isReturn = r.type === 'RETURN' || Boolean(r.borrowId);
        if (isReturn) {
            const bId = (r.borrowId || r.id || '').toString().trim().toLowerCase();
            return `ret__${bId}`;
        }
        const email = (r.borrowerEmail || r.email || '').toString().toLowerCase().trim();
        const name = (r.borrowerName || r.name || '').toString().toLowerCase().trim();
        const roll = (r.rollNumber || r.roll || '').toString().toLowerCase().trim();
        const item = (r.itemId || r.itemName || '').toString().toLowerCase().trim();
        const qty = Number(r.quantity || r.qty) || 1;
        const purpose = (r.purpose || '').toString().toLowerCase().trim();
        const borrower = roll || email || name;
        return `iss__${borrower}__${item}__${qty}__${purpose}`;
    }

    static markRequestHandled(...ids: (string | undefined | null)[]) {
        try {
            const raw = localStorage.getItem('cicr_dismissed_requests');
            const list: string[] = raw ? JSON.parse(raw) : [];
            let changed = false;
            for (const id of ids) {
                if (id && typeof id === 'string' && !list.includes(id)) {
                    list.push(id);
                    changed = true;
                }
            }
            if (changed) {
                if (list.length > 300) list.splice(0, list.length - 300);
                localStorage.setItem('cicr_dismissed_requests', JSON.stringify(list));
            }
        } catch { }
    }

    static async loadHardwareRequests(force = false) {
        const token = localStorage.getItem('cicr_token');
        const isAuth = document.body.classList.contains('authenticated') || document.documentElement.classList.contains('is-authenticated');
        if (!token || !isAuth) return;

        const handledIds = this.getHandledRequestIds();
        let serverList: AdminHardwareRequest[] = [];
        let serverFetchSucceeded = false;

        // 1. Fetch from hardware requests endpoint (backend merges local requests & Supabase pending records)
        try {
            const res = await fetch(`${API_BASE}/borrow/requests${force ? '?force=true' : ''}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                const result = await res.json();
                serverList = result.data || [];
                serverFetchSucceeded = true;
            } else if (res.status === 401 || res.status === 403) {
                console.warn('[AdminManager] Hardware requests access restricted.');
                return;
            }
        } catch (err) {
            console.error('Failed to fetch hardware requests:', err);
        }

        const isTestItem = (r: any): boolean => {
            const em = (r?.email || r?.borrowerEmail || '').toLowerCase().trim();
            const nm = (r?.name || r?.borrowerName || '').toLowerCase().trim();
            if (em.includes('.test') || em.includes('cicr.test') || em === 'member@cicr.test') return true;
            if (nm === 'stu' || nm === 'test member' || nm === 'test user') return true;
            return false;
        };

        serverList = serverList.filter(item => !isTestItem(item));

        // 2. Collect from local requests state and localStorage
        const localStoredRaw = localStorage.getItem('cicr_requests');
        let localRequests: RequestRecord[] = [];
        if (localStoredRaw) {
            try {
                localRequests = JSON.parse(localStoredRaw);
                const cleaned = localRequests.filter(r => !isTestItem(r));
                if (cleaned.length !== localRequests.length) {
                    localStorage.setItem('cicr_requests', JSON.stringify(cleaned));
                    localRequests = cleaned;
                }
            } catch { }
        }
        const combinedLocal = [...(requests || []).filter(r => !isTestItem(r)), ...localRequests];
        const localPending: AdminHardwareRequest[] = combinedLocal
            .filter((r) => r.status === 'PENDING')
            .map((r) => ({
                id: r.id,
                type: (r as any).type || ((r as any).borrowId ? 'RETURN' : 'ISSUE'),
                borrowId: (r as any).borrowId,
                returnQuantity: (r as any).returnQuantity,
                itemId: r.itemId,
                itemName: r.itemName,
                borrowerName: r.name,
                borrowerEmail: (r as any).email || (r as any).borrowerEmail || (r.roll ? `${r.roll}@mail.jiit.ac.in` : ''),
                rollNumber: r.roll || null,
                quantity: Number(r.qty) || 1,
                purpose: r.purpose || 'Testing',
                durationDays: 7,
                dueDate: r.dueDate || '7 Days',
                status: 'PENDING' as const,
                requestedAt: r.requestedAt || new Date().toISOString()
            }));

        const isItemDismissed = (item: any): boolean => {
            if (!item) return true;
            if (item.status !== 'PENDING') return false;
            if (handledIds.has(item.id)) return true;
            if (item.borrowId && handledIds.has(item.borrowId)) return true;
            const key = this.getRequestCanonicalKey(item);
            if (key && handledIds.has(key)) return true;
            return false;
        };

        const role = ModalManager.getCurrentRole();
        const isAdmin = role === 'ADMIN';

        if (!isAdmin) {
            // Member: Store all returned requests across all statuses (PENDING, APPROVED, REJECTED)
            this.userHardwareRequests = serverList.slice().sort((a, b) => {
                return new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime();
            });
            // Also keep local pending submissions if any (only belonging to current user)
            for (const lp of localPending.filter(r => ModalManager.isUserRequestMatch(r))) {
                if (!this.userHardwareRequests.some(r => r.id === lp.id || (r.borrowId && r.borrowId === lp.borrowId))) {
                    this.userHardwareRequests.unshift(lp);
                }
            }
            this.hardwareRequests = this.userHardwareRequests;
        } else {
            const canonicalQueue = new Map<string, AdminHardwareRequest>();

            // 1. Process server list first (canonical source of truth for admin)
            for (const item of serverList) {
                if (!item) continue;
                if (item.status === 'PENDING' && isItemDismissed(item)) continue;
                const key = `${this.getRequestCanonicalKey(item) || item.id}__${item.status || 'PENDING'}`;
                if (!canonicalQueue.has(key)) {
                    canonicalQueue.set(key, item);
                }
            }

            // 2. Add localPending items ONLY if server request failed OR item is a recent in-flight submission (< 60s)
            const now = Date.now();
            for (const item of localPending) {
                if (!item) continue;
                if (item.status === 'PENDING' && isItemDismissed(item)) continue;
                const isRecent = item.requestedAt ? (now - new Date(item.requestedAt).getTime() < 60000) : false;
                // Keep stale local submissions only when the server list could not be fetched.
                if (!isRecent && serverFetchSucceeded) continue;
                const key = `${this.getRequestCanonicalKey(item) || item.id}__${item.status || 'PENDING'}`;
                if (!canonicalQueue.has(key)) {
                    canonicalQueue.set(key, item);
                }
            }

            this.hardwareRequests = Array.from(canonicalQueue.values()).sort((a, b) => {
                return new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime();
            });
        }
        this.updateStats();
        this.renderHardwareQueue(force);
        DatabaseManager.updateNotificationBadges();
    }

    private static updateStats() {
        const pendingUsers = this.users.filter(u => u.status === 'PENDING').length;
        const pendingHardware = this.hardwareRequests.filter(r => r.status === 'PENDING').length;
        const approved = this.users.filter(u => u.status === 'APPROVED').length;
        const admins = this.users.filter(u => u.role === 'ADMIN').length;

        const statPendingUsers = document.getElementById('admin-stat-pending');
        const statPendingHw = document.getElementById('admin-stat-hw-pending');
        const statApproved = document.getElementById('admin-stat-approved');
        const statAdmins = document.getElementById('admin-stat-admins');
        const pendingTag = document.getElementById('admin-pending-count-tag');
        const hwTag = document.getElementById('admin-hw-count-tag');
        const sidebarBadge = document.getElementById('admin-pending-badge');

        const pUserStr = pendingUsers.toString();
        const pHwStr = pendingHardware.toString();
        const appStr = approved.toString();
        const admStr = admins.toString();
        const pTagStr = `${pendingUsers} PENDING`;
        const hwTagStr = `${pendingHardware} PENDING`;

        if (statPendingUsers && statPendingUsers.innerText !== pUserStr) statPendingUsers.innerText = pUserStr;
        if (statPendingHw && statPendingHw.innerText !== pHwStr) statPendingHw.innerText = pHwStr;
        if (statApproved && statApproved.innerText !== appStr) statApproved.innerText = appStr;
        if (statAdmins && statAdmins.innerText !== admStr) statAdmins.innerText = admStr;
        if (pendingTag && pendingTag.innerText !== pTagStr) pendingTag.innerText = pTagStr;
        if (hwTag && hwTag.innerText !== hwTagStr) hwTag.innerText = hwTagStr;

        const totalPending = pendingUsers + pendingHardware;
        if (sidebarBadge) {
            if (totalPending > 0) {
                sidebarBadge.style.display = 'inline-flex';
                sidebarBadge.innerText = totalPending.toString();
            } else {
                sidebarBadge.style.display = 'none';
                sidebarBadge.innerText = '0';
            }
        }
    }

    private static renderHardwareQueue(force = false) {
        const container = document.getElementById('admin-hardware-list');
        if (!container) return;

        const pendingRequests = this.hardwareRequests
            .filter(r => r.status === 'PENDING')
            .sort((a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime());
        const fingerprint = pendingRequests.map(r => `${r.id}_${r.status}_${r.quantity}_${r.returnQuantity || ''}_${r.borrowerEmail}_${r.itemName}_${r.type || ''}`).join('|');

        if (!force && this.lastHardwareQueueFingerprint === fingerprint && container.children.length === (pendingRequests.length === 0 ? 1 : pendingRequests.length)) {
            return;
        }
        this.lastHardwareQueueFingerprint = fingerprint;

        if (pendingRequests.length === 0) {
            container.innerHTML = `
                <div class="admin-empty-state">
                    <i data-lucide="package-check"></i>
                    <p>No pending component requests in queue. Vault operations nominal.</p>
                </div>
            `;
            renderLucideIcons(container);
            return;
        }

        container.innerHTML = pendingRequests.map(r => {
            const isReturn = r.type === 'RETURN';
            const returnQty = Number(r.returnQuantity || r.quantity) || 1;
            const origQty = Number(r.originalQuantity) || 0;
            const isQueueAdjusted = !isReturn && origQty > 0 && origQty > r.quantity;
            return `
            <div class="hardware-request-card glass" data-request-id="${escapeHtml(r.id)}">
                <div class="hw-card-header">
                    <div class="hw-card-chip">
                        <i data-lucide="${isReturn ? 'corner-up-left' : 'cpu'}" style="width:14px; height:14px; color:var(--neon-cyan);"></i>
                        <span class="hw-item-name">${escapeHtml(r.itemName)}</span>
                        ${r.queuePosition ? `<span class="hw-queue-pos" style="font-size:10px; background:rgba(99,102,241,0.18); border:1px solid rgba(99,102,241,0.35); color:#a5b4fc; border-radius:4px; padding:1px 6px; margin-left:6px;"><i data-lucide="layers" style="width:10px;height:10px;display:inline-block;vertical-align:middle;"></i> Queue #${r.queuePosition}</span>` : ''}
                    </div>
                    <span class="hw-qty-badge" style="${isQueueAdjusted ? 'background:rgba(245,158,11,0.2); border-color:rgba(245,158,11,0.45); color:#fbbf24;' : ''}">
                        ${isReturn ? 'RETURN' : 'ISSUE'} · ${isReturn ? returnQty : r.quantity}x
                        ${isQueueAdjusted ? ` (of ${origQty}x)` : ''}
                    </span>
                </div>

                <div class="hw-card-requester">
                    ${(() => {
                        const borrowerAvatar = AdminManager.getUserAvatar(r.borrowerEmail);
                        return `<div class="hw-avatar admin-user-clickable ${borrowerAvatar ? 'has-custom-avatar' : ''}" data-user-name="${this.escapeHtml(r.borrowerName)}" data-user-email="${this.escapeHtml(r.borrowerEmail)}" data-user-roll="${this.escapeHtml(r.rollNumber || '')}" title="Inspect Member Profile">
                            ${borrowerAvatar ? `<img src="${escapeHtml(borrowerAvatar)}" class="hw-avatar-img" alt="${escapeHtml(r.borrowerName || 'User')}" />` : (r.borrowerName ? escapeHtml(r.borrowerName.charAt(0).toUpperCase()) : 'U')}
                        </div>`;
                    })()}
                    <div class="hw-meta-col">
                        <span class="hw-requester-name admin-user-clickable" data-user-name="${this.escapeHtml(r.borrowerName)}" data-user-email="${this.escapeHtml(r.borrowerEmail)}" data-user-roll="${this.escapeHtml(r.rollNumber || '')}" title="Inspect Member Profile">${escapeHtml(r.borrowerName)}</span>
                        <span class="hw-requester-email">${escapeHtml(r.borrowerEmail)}</span>
                    </div>
                </div>

                <div class="hw-card-details">
                    ${r.rollNumber ? `<div class="hw-detail-row"><span class="hw-lbl">ROLL:</span> <span class="hw-val mono">${escapeHtml(r.rollNumber)}</span></div>` : ''}
                    ${isReturn
                    ? `<div class="hw-detail-row"><span class="hw-lbl">RETURNING:</span> <span class="hw-val">${returnQty}x ${escapeHtml(r.itemName)}</span></div>`
                    : `<div class="hw-detail-row"><span class="hw-lbl">PURPOSE:</span> <span class="hw-val">${escapeHtml(r.purpose)}</span></div>`}
                    ${isQueueAdjusted ? `<div class="hw-detail-row"><span class="hw-lbl">QUEUE MATH:</span> <span class="hw-val" style="color:#fbbf24; font-weight:700;">Auto-Allocated ${r.quantity} of ${origQty} units (Remaining stock: ${r.queueAvailable !== undefined ? r.queueAvailable : r.quantity})</span></div>` : ''}
                    ${isReturn ? '' : `<div class="hw-detail-row"><span class="hw-lbl">DUE DATE:</span> <span class="hw-val due">${escapeHtml(r.dueDate || '7 Days')}</span></div>`}
                    <div class="hw-detail-row"><span class="hw-lbl">REQUESTED:</span> <span class="hw-val date">${new Date(r.requestedAt).toLocaleString()}</span></div>
                </div>

                <div class="hw-card-actions">
                    <button class="btn-hw-approve" data-action="hw-approve" data-request-id="${escapeHtml(r.id)}">
                        <i data-lucide="check"></i> ${isReturn ? 'Approve Return' : 'Approve Issue'}
                    </button>
                    <button class="btn-hw-reject" data-action="hw-reject" data-request-id="${escapeHtml(r.id)}">
                        <i data-lucide="x"></i> Reject
                    </button>
                </div>
            </div>
            `;
        }).join('');

        renderLucideIcons(container);
    }

    private static pendingActionIds = new Set<string>();

    static async approveHardware(id: string) {
        if (this.pendingActionIds.has(id)) return;
        this.pendingActionIds.add(id);
        setTimeout(() => this.pendingActionIds.delete(id), 2500);

        const token = localStorage.getItem('cicr_token');
        const targetReq = this.hardwareRequests.find(r => r.id === id)
            || (requests.find(r => r.id === id) as any);
        const reqSnapshot = targetReq ? { ...targetReq } : null;
        const targetKey = this.getRequestCanonicalKey(targetReq);

        const isReturnReq = reqSnapshot?.type === 'RETURN' || Boolean(reqSnapshot?.borrowId);

        // Queue math stock auto-cap: if stock is depleted by earlier approved requests
        if (reqSnapshot && !isReturnReq) {
            const targetItem = inventory.find(i => String(i.id) === String(reqSnapshot.itemId));
            if (targetItem) {
                const avail = typeof targetItem.availableQuantity === 'number' ? targetItem.availableQuantity : targetItem.quantity;
                if (avail < reqSnapshot.quantity && avail > 0) {
                    reqSnapshot.quantity = avail;
                    ToastManager.show('Queue Auto-Adjusted', `Stock is limited to ${avail}. Authorizing ${avail}x ${targetReq.itemName}.`, 'info');
                }
            }
        }

        // Strict Order Check: If approving a RETURN, ensure there is NO pending ISSUE request for this item & borrower
        if (isReturnReq) {
            const hasPendingIssue = this.hardwareRequests.some(r => {
                if (r.id === id || r.status !== 'PENDING' || r.type === 'RETURN' || Boolean(r.borrowId)) return false;
                const sameItem = r.itemId === reqSnapshot?.itemId;
                const sameEmail = Boolean(r.borrowerEmail && reqSnapshot?.borrowerEmail && r.borrowerEmail.toLowerCase().trim() === reqSnapshot.borrowerEmail.toLowerCase().trim());
                const sameName = Boolean(r.borrowerName && reqSnapshot?.borrowerName && r.borrowerName.toLowerCase().trim() === reqSnapshot.borrowerName.toLowerCase().trim());
                return sameItem && (sameEmail || sameName);
            });
            if (hasPendingIssue) {
                ToastManager.show('Order Violation Blocked', 'Cannot approve return before the component issue request is approved first.', 'warning');
                this.pendingActionIds.delete(id);
                return;
            }
        }

        const matchesTarget = (r: any): boolean => {
            if (!r) return false;
            if (r.id === id) return true;
            if (targetReq?.id && r.id === targetReq.id) return true;
            if (targetReq?.borrowId && (r.borrowId === targetReq.borrowId || r.id === targetReq.borrowId)) return true;
            if (r.borrowId && (r.borrowId === id || r.id === id)) return true;
            if (targetKey) {
                const k = AdminManager.getRequestCanonicalKey(r);
                if (k && k === targetKey) return true;
            }
            return false;
        };

        const currentAdminName = (() => {
            try {
                const u = readCurrentUser();
                return u.name || u.username || 'Lab Administrator';
            } catch { return 'Lab Administrator'; }
        })();

        // Permanently record as handled so it NEVER resurrects in UI
        this.markRequestHandled(id, targetReq?.id, targetReq?.borrowId, targetKey);

        // 1. INSTANT 1-CLICK OPTIMISTIC UI UPDATE (Zero Latency)
        this.hardwareRequests.forEach(r => {
            if (matchesTarget(r)) {
                r.status = 'APPROVED';
                r.reviewedBy = currentAdminName;
                r.reviewedAt = new Date().toISOString();
            }
        });
        requests.forEach(r => {
            if (matchesTarget(r)) {
                r.status = 'APPROVED';
            }
        });
        if (Array.isArray(this.userHardwareRequests)) {
            this.userHardwareRequests.forEach(r => {
                if (matchesTarget(r)) {
                    r.status = 'APPROVED';
                    r.reviewedBy = currentAdminName;
                    r.reviewedAt = new Date().toISOString();
                }
            });
        }
        this.updateStats();
        this.renderHardwareQueue(true);

        // Immediately purge from localStorage
        const localStoredRaw = localStorage.getItem('cicr_requests');
        if (localStoredRaw) {
            try {
                const parsed = JSON.parse(localStoredRaw);
                const filtered = parsed.filter((r: any) => !matchesTarget(r));
                localStorage.setItem('cicr_requests', JSON.stringify(filtered));
            } catch { }
        }

        if (reqSnapshot) {
            const targetItem = inventory.find(i => String(i.id) === String(reqSnapshot.itemId));
            if (targetItem) {
                if (!targetItem.borrowedBy) targetItem.borrowedBy = [];
                if (isReturnReq) {
                    const bRec = targetItem.borrowedBy.find((b: any) =>
                        (reqSnapshot.borrowId && (b.id === reqSnapshot.borrowId || b._id === reqSnapshot.borrowId)) ||
                        (!b.returned && (b.userName === reqSnapshot.borrowerName || b.name === reqSnapshot.borrowerName || b.email === reqSnapshot.borrowerEmail))
                    );
                    if (bRec) {
                        bRec.returned = true;
                        bRec.status = 'RETURNED';
                        bRec.returnDate = new Date().toISOString();
                        bRec.adminApprovedBy = `${currentAdminName} (Admin)`;
                        bRec.approvedBy = currentAdminName;
                    }
                } else {
                    targetItem.borrowedBy.push({
                        id: reqSnapshot.id || `borrow-${Date.now()}`,
                        name: reqSnapshot.borrowerName,
                        userName: reqSnapshot.borrowerName,
                        borrowerName: reqSnapshot.borrowerName,
                        roll: reqSnapshot.rollNumber,
                        userRoll: reqSnapshot.rollNumber,
                        email: reqSnapshot.borrowerEmail,
                        userEmail: reqSnapshot.borrowerEmail,
                        qty: reqSnapshot.quantity,
                        purpose: reqSnapshot.purpose,
                        date: new Date().toISOString(),
                        dueDate: reqSnapshot.dueDate || null,
                        adminApprovedBy: `${currentAdminName} (Admin)`,
                        approvedBy: currentAdminName,
                        reviewedBy: currentAdminName,
                        status: 'BORROWED'
                    });
                }
            }
        }

        DatabaseManager.save();
        DatabaseManager.updateNotificationBadges();
        if (typeof ModalManager !== 'undefined' && typeof ModalManager.renderLogsDrawer === 'function') {
            ModalManager.renderLogsDrawer();
        }
        if (typeof NotificationCenterManager !== 'undefined' && typeof NotificationCenterManager.updateNotifications === 'function') {
            NotificationCenterManager.updateNotifications();
        }

        ToastManager.show(
            isReturnReq ? 'Return Authorized' : 'Request Authorized',
            `${isReturnReq ? 'Return' : 'Component issue'} for "${reqSnapshot?.itemName || 'Hardware'}" approved.`,
            'success'
        );
        DatabaseManager.addLog('approve', `Admin ${currentAdminName} authorized ${isReturnReq ? 'return' : 'hardware issue'} for "${reqSnapshot?.itemName || 'Hardware'}"`);

        // 2. Perform background sync to server
        try {
            const approvalPayload = {
                ...(reqSnapshot || {}),
                adminName: currentAdminName,
                admin_name: currentAdminName,
                admin_approved_by: currentAdminName,
                reviewedBy: currentAdminName
            };
            const res = await fetch(`${API_BASE}/borrow/requests/${id}/approve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(approvalPayload)
            });

            if (!res.ok) {
                // If backend couldn't decrement stock (e.g. unlisted/mock item), tell backend to mark/clear the request
                await fetch(`${API_BASE}/borrow/requests/${id}/reject`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ reason: 'Approved offline / unlisted inventory item.', adminName: currentAdminName })
                }).catch(() => { });
            }
        } catch (e) {
            console.warn('Background approval sync note:', e);
        }

        // Non-blocking telemetry refresh in background
        this.loadAuditLogs();
        DatabaseManager.syncFromBackend();
        if (typeof HardwareLedgerManager !== 'undefined') {
            HardwareLedgerManager.fetchLedger(true).then(() => HardwareLedgerManager.renderTable()).catch(() => {});
        }
    }

    static async rejectHardware(id: string) {
        if (this.pendingActionIds.has(id)) return;
        this.pendingActionIds.add(id);
        setTimeout(() => this.pendingActionIds.delete(id), 2500);

        const token = localStorage.getItem('cicr_token');
        const targetReq = this.hardwareRequests.find(r => r.id === id)
            || (requests.find(r => r.id === id) as any);
        const itemName = targetReq?.itemName || 'Component';
        const targetKey = this.getRequestCanonicalKey(targetReq);

        const matchesTarget = (r: any): boolean => {
            if (!r) return false;
            if (r.id === id) return true;
            if (targetReq?.id && r.id === targetReq.id) return true;
            if (targetReq?.borrowId && (r.borrowId === targetReq.borrowId || r.id === targetReq.borrowId)) return true;
            if (r.borrowId && (r.borrowId === id || r.id === id)) return true;
            if (targetKey) {
                const k = AdminManager.getRequestCanonicalKey(r);
                if (k && k === targetKey) return true;
            }
            return false;
        };

        const currentAdminName = (() => {
            try {
                const u = readCurrentUser();
                return u.name || u.username || 'Lab Administrator';
            } catch { return 'Lab Administrator'; }
        })();

        // Permanently record as handled so it NEVER resurrects in UI
        this.markRequestHandled(id, targetReq?.id, targetReq?.borrowId, targetKey);

        // 1. INSTANT 1-CLICK OPTIMISTIC UI UPDATE (Zero Latency)
        this.hardwareRequests.forEach(r => {
            if (matchesTarget(r)) {
                r.status = 'REJECTED';
                r.reviewNote = 'Declined by Administrator.';
                r.reviewedBy = currentAdminName;
                r.reviewedAt = new Date().toISOString();
            }
        });
        requests.forEach(r => {
            if (matchesTarget(r)) {
                r.status = 'REJECTED';
                r.reviewNote = 'Declined by Administrator.';
            }
        });
        if (Array.isArray(this.userHardwareRequests)) {
            this.userHardwareRequests.forEach(r => {
                if (matchesTarget(r)) {
                    r.status = 'REJECTED';
                    r.reviewNote = 'Declined by Administrator.';
                    r.reviewedBy = currentAdminName;
                    r.reviewedAt = new Date().toISOString();
                }
            });
        }
        this.updateStats();
        this.renderHardwareQueue(true);

        // Immediately update localStorage
        const localStoredRaw = localStorage.getItem('cicr_requests');
        if (localStoredRaw) {
            try {
                const parsed = JSON.parse(localStoredRaw);
                const updated = parsed.map((r: any) => {
                    if (matchesTarget(r)) {
                        return { ...r, status: 'REJECTED', reviewNote: 'Declined by Administrator.' };
                    }
                    return r;
                });
                localStorage.setItem('cicr_requests', JSON.stringify(updated));
            } catch { }
        }
        DatabaseManager.save();
        DatabaseManager.updateNotificationBadges();
        if (typeof ModalManager !== 'undefined' && typeof ModalManager.renderLogsDrawer === 'function') {
            ModalManager.renderLogsDrawer();
        }
        if (typeof NotificationCenterManager !== 'undefined' && typeof NotificationCenterManager.updateNotifications === 'function') {
            NotificationCenterManager.updateNotifications();
        }

        ToastManager.show('Request Declined', `Hardware issue request for "${itemName}" declined.`, 'info');
        DatabaseManager.addLog('reject', `Admin ${currentAdminName} declined hardware issue request for "${itemName}"`);

        // 2. Perform background notification to server with full borrower details guaranteed
        const reqPayload = targetReq ? {
            ...targetReq,
            adminName: currentAdminName,
            reviewedBy: currentAdminName,
            reason: 'Declined by Administrator.',
            borrowerEmail: targetReq.borrowerEmail,
            borrowerName: targetReq.borrowerName,
            itemName: targetReq.itemName,
            quantity: targetReq.quantity,
            purpose: targetReq.purpose,
            type: targetReq.type,
            borrowId: targetReq.borrowId
        } : { adminName: currentAdminName, reviewedBy: currentAdminName, reason: 'Declined by Administrator.' };

        try {
            await fetch(`${API_BASE}/borrow/requests/${id}/reject`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(reqPayload)
            });
        } catch (e) {
            console.warn('Background rejection sync note:', e);
        }

        this.loadAuditLogs();
        DatabaseManager.syncFromBackend();
        if (typeof HardwareLedgerManager !== 'undefined') {
            HardwareLedgerManager.fetchLedger(true).then(() => HardwareLedgerManager.renderTable()).catch(() => {});
        }
    }

    private static renderPendingQueue(force = false) {
        const container = document.getElementById('admin-pending-list');
        if (!container) return;

        const pendingUsers = this.users.filter(u => u.status === 'PENDING');
        const fingerprint = pendingUsers.map(u => `${u.id}_${u.status}_${u.name}_${u.email}_${u.roll_number || ''}_${u.batch || ''}`).join('|');

        if (!force && this.lastPendingQueueFingerprint === fingerprint && container.children.length === (pendingUsers.length === 0 ? 1 : pendingUsers.length)) {
            return;
        }
        this.lastPendingQueueFingerprint = fingerprint;

        if (pendingUsers.length === 0) {
            container.innerHTML = `
                <div class="admin-empty-state">
                    <i data-lucide="check-circle-2"></i>
                    <p>No pending registration requests. All accounts are up to date!</p>
                </div>
            `;
            renderLucideIcons(container);
            return;
        }

        container.innerHTML = pendingUsers.map(u => {
            const dt = DashboardManager.formatLogDateTime(u.created_at);
            return `
            <div class="pending-request-card glass" data-user-id="${escapeHtml(u.id)}">
                <div class="pending-card-top">
                    ${(() => {
                        const pendingAvatar = u.avatar_url || AdminManager.getUserAvatar(u.email);
                        return `<div class="pending-card-avatar admin-user-clickable ${pendingAvatar ? 'has-custom-avatar' : ''}" data-user-id="${escapeHtml(u.id)}" data-user-name="${this.escapeHtml(u.name)}" data-user-email="${this.escapeHtml(u.email)}" data-user-roll="${this.escapeHtml(u.roll_number || '')}" data-user-batch="${this.escapeHtml(u.batch || '')}" title="Inspect Profile">
                            ${pendingAvatar ? `<img src="${escapeHtml(pendingAvatar)}" class="pending-card-avatar-img" alt="${escapeHtml(u.name || 'User')}" />` : (u.name ? escapeHtml(u.name.charAt(0).toUpperCase()) : 'U')}
                        </div>`;
                    })()}
                    <div class="pending-card-meta">
                        <span class="pending-card-name admin-user-clickable" data-user-id="${escapeHtml(u.id)}" data-user-name="${this.escapeHtml(u.name)}" data-user-email="${this.escapeHtml(u.email)}" data-user-roll="${this.escapeHtml(u.roll_number || '')}" data-user-batch="${this.escapeHtml(u.batch || '')}" title="Inspect Profile">${this.escapeHtml(u.name)}</span>
                        <span class="pending-card-email">${this.escapeHtml(u.email)}</span>
                    </div>
                </div>
                <div class="pending-card-extra">
                    <span><i data-lucide="calendar" style="width:11px; height:11px; vertical-align:middle;"></i> ${escapeHtml(dt.dateStr)}${dt.timeStr ? ` • ${escapeHtml(dt.timeStr)}` : ''}</span>
                    ${u.roll_number ? `<span>• Roll: ${this.escapeHtml(u.roll_number)}</span>` : ''}
                    <span>• Branch: ${this.escapeHtml(getStudentBranch(u.roll_number, u.batch))}</span>
                </div>
                <div class="pending-card-actions">
                    <button class="btn-approve" data-action="approve" data-user-id="${escapeHtml(u.id)}">
                        <i data-lucide="check"></i> Approve
                    </button>
                    <button class="btn-reject" data-action="reject" data-user-id="${escapeHtml(u.id)}">
                        <i data-lucide="x"></i> Reject
                    </button>
                </div>
            </div>
            `;
        }).join('');

        renderLucideIcons(container);
    }

    private static filterUsers(query: string) {
        if (!query || !query.trim()) return this.users;
        const q = query.toLowerCase().trim();
        return this.users.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }

    private static renderUsersTable(usersList: AdminUserRecord[], force = false) {
        const tbody = document.getElementById('admin-users-tbody');
        if (!tbody) return;

        const totalBadge = document.getElementById('admin-users-total-badge');
        const totalText = `${this.users.length} USERS`;
        if (totalBadge && totalBadge.innerText !== totalText) totalBadge.innerText = totalText;

        const allAdmins = this.users.filter(u => u.isMasterAdmin || u.role === 'ADMIN');
        const allMembers = this.users.filter(u => !(u.isMasterAdmin || u.role === 'ADMIN'));

        const pillAll = document.getElementById('pill-filter-all');
        const pillAdmin = document.getElementById('pill-filter-admin');
        const pillMember = document.getElementById('pill-filter-member');

        const allText = `ALL (${this.users.length})`;
        if (pillAll && pillAll.innerText !== allText) pillAll.innerText = allText;
        const adminText = `ADMINS (${allAdmins.length})`;
        if (pillAdmin && pillAdmin.innerText !== adminText) pillAdmin.innerText = adminText;
        const memberText = `MEMBERS (${allMembers.length})`;
        if (pillMember && pillMember.innerText !== memberText) pillMember.innerText = memberText;

        const usersFingerprint = `${this.activeUserRoleFilter}_` + usersList.map(u => `${u.id}_${u.role}_${u.status}_${u.name}_${u.email}_${u.roll_number || ''}_${u.batch || ''}`).join('|');
        if (!force && this.lastUsersTableFingerprint === usersFingerprint && tbody.children.length > 0) {
            return;
        }
        this.lastUsersTableFingerprint = usersFingerprint;

        // Separate current filtered users into Admins and Members
        const adminUsers = usersList.filter(u => u.isMasterAdmin || u.role === 'ADMIN');
        const memberUsers = usersList.filter(u => !(u.isMasterAdmin || u.role === 'ADMIN'));

        const renderRow = (u: AdminUserRecord): string => {
            const statusClass = u.status === 'APPROVED' ? 'approved' : u.status === 'PENDING' ? 'pending' : 'rejected';
            const isMaster = Boolean(u.isMasterAdmin);

            // Format registration date & time in 2 separate lines
            const dt = DashboardManager.formatLogDateTime(u.created_at);
            const dateHtml = `
                <div class="user-reg-date-wrap">
                    <span class="user-reg-date">${escapeHtml(dt.dateStr)}</span>
                    <span class="user-reg-time"><i data-lucide="clock"></i>${escapeHtml(dt.timeStr || '--:--')}</span>
                </div>
            `;

            // Elegant, Non-Neon Theme Avatars
            const avatarGradient = isMaster
                ? 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)'
                : u.role === 'ADMIN'
                    ? 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)'
                    : 'linear-gradient(135deg, #475569 0%, #334155 100%)';

            const avatarShadow = isMaster
                ? '0 2px 6px rgba(79, 70, 229, 0.28)'
                : u.role === 'ADMIN'
                    ? '0 2px 6px rgba(124, 58, 237, 0.28)'
                    : '0 2px 5px rgba(0, 0, 0, 0.12)';

            const userAvatarImg = u.avatar_url || AdminManager.getUserAvatar(u.email);
            const avatarStyle = userAvatarImg
                ? 'background: rgba(124, 58, 237, 0.08); border: 1.5px solid rgba(124, 58, 237, 0.25); box-shadow: 0 1px 3px rgba(0,0,0,0.1);'
                : `background: ${avatarGradient}; box-shadow: ${avatarShadow}; border: 1px solid rgba(255, 255, 255, 0.15);`;

            const avatarContent = userAvatarImg
                ? `<img src="${escapeHtml(userAvatarImg)}" class="user-cell-avatar-img" alt="${escapeHtml(u.name || 'User')}" />`
                : `${u.name ? escapeHtml(u.name.charAt(0).toUpperCase()) : 'U'}`;

            const roleBadge = isMaster
                ? `<span class="badge-role master"><i data-lucide="crown"></i> MASTER ADMIN</span>`
                : u.role === 'ADMIN'
                    ? `<span class="badge-role admin"><i data-lucide="shield"></i> ADMIN</span>`
                    : `<span class="badge-role member"><i data-lucide="user"></i> MEMBER</span>`;

            let actionsHtml = '';
            if (isMaster) {
                actionsHtml = `<span class="badge-perm-admin"><i data-lucide="shield-check"></i> ROOT ACCESS</span>`;
            } else {
                const roleBtn = u.role === 'ADMIN'
                    ? `<button class="btn-table-action btn-demote" data-action="set-role" data-user-id="${escapeHtml(u.id)}" data-role="MEMBER" title="Demote to Member"><i data-lucide="shield-off"></i> Demote</button>`
                    : `<button class="btn-table-action btn-make-admin" data-action="set-role" data-user-id="${escapeHtml(u.id)}" data-role="ADMIN" title="Promote to Admin"><i data-lucide="shield-alert"></i> Make Admin</button>`;

                const deleteBtn = `<button class="btn-table-action btn-del" data-action="delete" data-user-id="${escapeHtml(u.id)}" data-user-name="${this.escapeHtml(u.name)}" title="Permanently Delete User"><i data-lucide="trash-2"></i></button>`;

                actionsHtml = `${roleBtn} ${deleteBtn}`;
            }

            const userBranch = getStudentBranch(u.roll_number, u.batch);
            const metaSub = `<span class="user-cell-subtext">${u.roll_number ? `Roll: ${this.escapeHtml(u.roll_number)}` : ''}${u.roll_number && userBranch ? ' • ' : ''}${userBranch ? `Branch: ${this.escapeHtml(userBranch)}` : ''}</span>`;

            return `
                <tr data-user-id="${u.id}">
                    <td>
                        <div class="user-cell-name">
                            <div class="user-cell-avatar admin-user-clickable ${userAvatarImg ? 'has-custom-avatar' : ''}" data-user-id="${u.id}" data-user-name="${this.escapeHtml(u.name || 'Anonymous')}" data-user-email="${this.escapeHtml(u.email)}" data-user-roll="${this.escapeHtml(u.roll_number || '')}" data-user-batch="${this.escapeHtml(u.batch || '')}" title="Inspect Profile" style="${avatarStyle}">
                                ${avatarContent}
                            </div>
                            <div class="user-cell-meta-wrap">
                                <span class="user-cell-display-name admin-user-clickable" data-user-id="${u.id}" data-user-name="${this.escapeHtml(u.name || 'Anonymous')}" data-user-email="${this.escapeHtml(u.email)}" data-user-roll="${this.escapeHtml(u.roll_number || '')}" data-user-batch="${this.escapeHtml(u.batch || '')}" title="Inspect Profile">${this.escapeHtml(u.name || 'Anonymous')}</span>
                                ${metaSub}
                            </div>
                        </div>
                    </td>
                    <td>
                        <span class="user-email-text">${this.escapeHtml(u.email)}</span>
                    </td>
                    <td>
                        <span class="badge-status ${statusClass}">
                            <span class="status-pulse-dot dot-${statusClass}"></span>
                            ${u.status}
                        </span>
                    </td>
                    <td>${roleBadge}</td>
                    <td>${dateHtml}</td>
                    <td><div class="table-actions-cell">${actionsHtml}</div></td>
                </tr>
            `;
        };

        const renderAdminSection = (): string => {
            if (adminUsers.length === 0) {
                return `
                    <tr class="user-group-divider-row admin-group-row">
                        <td colspan="6">
                            <div class="user-group-header">
                                <div class="user-group-title">
                                    <span>ADMINISTRATORS & LEADERSHIP</span>
                                </div>
                                <span class="user-group-badge badge-cyan">0 ADMINS</span>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td colspan="6" style="text-align: center; padding: 20px; color: var(--text-dim); font-size: 11px;">
                            No administrators found matching criteria.
                        </td>
                    </tr>
                `;
            }

            return `
                <tr class="user-group-divider-row admin-group-row">
                    <td colspan="6">
                        <div class="user-group-header">
                            <div class="user-group-title">
                                <span>ADMINISTRATORS & LEADERSHIP</span>
                            </div>
                            <span class="user-group-badge badge-cyan">${adminUsers.length} ADMINS</span>
                        </div>
                    </td>
                </tr>
                ${adminUsers.map(renderRow).join('')}
            `;
        };

        const renderMemberSection = (): string => {
            if (memberUsers.length === 0) {
                return `
                    <tr class="user-group-divider-row member-group-row">
                        <td colspan="6">
                            <div class="user-group-header">
                                <div class="user-group-title">
                                    <i data-lucide="users"></i>
                                    <span>REGISTERED MEMBERS & STUDENTS</span>
                                </div>
                                <span class="user-group-badge badge-purple">0 MEMBERS</span>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td colspan="6" style="text-align: center; padding: 20px; color: var(--text-dim); font-size: 11px;">
                            No registered members found matching criteria.
                        </td>
                    </tr>
                `;
            }

            return `
                <tr class="user-group-divider-row member-group-row">
                    <td colspan="6">
                        <div class="user-group-header">
                            <div class="user-group-title">
                                <i data-lucide="users"></i>
                                <span>REGISTERED MEMBERS & STUDENTS</span>
                            </div>
                            <span class="user-group-badge badge-purple">${memberUsers.length} MEMBERS</span>
                        </div>
                    </td>
                </tr>
                ${memberUsers.map(renderRow).join('')}
            `;
        };

        if (usersList.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 32px; color: var(--text-dim); font-family: 'Orbitron', sans-serif; font-size: 11px;">
                        <i data-lucide="shield-alert" style="width:20px;height:20px;display:block;margin:0 auto 8px auto;color:#64748b;"></i>
                        No users matching search criteria.
                    </td>
                </tr>
            `;
            renderLucideIcons(tbody);
            return;
        }

        if (this.activeUserRoleFilter === 'admin') {
            tbody.innerHTML = renderAdminSection();
        } else if (this.activeUserRoleFilter === 'member') {
            tbody.innerHTML = renderMemberSection();
        } else {
            tbody.innerHTML = renderAdminSection() + renderMemberSection();
        }

        renderLucideIcons(tbody);
    }

    static async approveUser(id: string) {
        const token = localStorage.getItem('cicr_token');
        const targetUser = this.users.find(u => u.id === id);
        const userName = targetUser?.name || id;
        const userEmail = targetUser?.email || '';

        // 1. INSTANT 1-CLICK OPTIMISTIC UI UPDATE
        if (targetUser) {
            targetUser.status = 'APPROVED';
        }
        this.updateStats();
        this.renderPendingQueue(true);
        const searchInput = document.getElementById('admin-users-search') as HTMLInputElement;
        this.renderUsersTable(this.filterUsers(searchInput ? searchInput.value : ''), true);

        ToastManager.show('User Approved', `Member "${userName}" has been granted access.`, 'success');
        DatabaseManager.addLog('system', `Admin approved membership for ${userName} (${userEmail})`);

        // 2. Background sync to server
        try {
            await fetch(`${API_BASE}/auth/admin/users/${id}/approve`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (e) {
            console.warn('Background user approval note:', e);
        }

        this.loadAuditLogs();
        DatabaseManager.updateNotificationBadges();
    }

    static async rejectUser(id: string) {
        const token = localStorage.getItem('cicr_token');
        const targetUser = this.users.find(u => u.id === id);
        const userName = targetUser?.name || id;

        // 1. INSTANT 1-CLICK OPTIMISTIC UI UPDATE
        if (targetUser) {
            targetUser.status = 'REJECTED';
        }
        this.updateStats();
        this.renderPendingQueue(true);
        const searchInput = document.getElementById('admin-users-search') as HTMLInputElement;
        this.renderUsersTable(this.filterUsers(searchInput ? searchInput.value : ''), true);

        ToastManager.show('User Rejected', `Membership request for "${userName}" declined.`, 'warning');
        DatabaseManager.addLog('system', `Admin rejected membership request for ${userName}`);

        // 2. Background sync to server
        try {
            await fetch(`${API_BASE}/auth/admin/users/${id}/reject`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (e) {
            console.warn('Background user rejection note:', e);
        }

        this.loadAuditLogs();
        DatabaseManager.updateNotificationBadges();
    }

    static async setRole(id: string, role: 'ADMIN' | 'MEMBER') {
        const token = localStorage.getItem('cicr_token');
        try {
            const res = await fetch(`${API_BASE}/auth/admin/users/${id}/role`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ role })
            });
            if (res.ok) {
                ToastManager.show('Role Updated', `User permissions changed to ${role}.`, 'info');
                DatabaseManager.addLog('system', `User ${id} role updated to ${role}`);
                await this.loadUsers(true);
                await this.loadAuditLogs();
            } else {
                const err = await res.json().catch(() => ({}));
                ToastManager.show('Update Failed', err.message || 'Could not update user role', 'error');
            }
        } catch (e) {
            console.error('Error changing role:', e);
            ToastManager.show('Network Error', 'Failed to update user role', 'error');
        }
    }

    static async deleteUser(id: string, name: string) {
        if (!confirm(`Are you sure you want to permanently delete user "${name}"?\n\nThis will remove their profile, credentials, and all records from the database permanently.`)) return;
        const token = localStorage.getItem('cicr_token');
        try {
            // Optimistically update local view immediately
            this.users = this.users.filter(u => u.id !== id);
            const searchInput = document.getElementById('admin-users-search') as HTMLInputElement;
            this.renderUsersTable(this.filterUsers(searchInput?.value || ''), true);
            this.renderPendingQueue(true);
            this.updateStats();

            const res = await fetch(`${API_BASE}/auth/admin/users/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                ToastManager.show('User Deleted', `User "${name}" has been permanently deleted from the database.`, 'warning');
                DatabaseManager.addLog('system', `Admin deleted user profile "${name}" (${id})`);
                await this.loadUsers();
                await this.loadAuditLogs();
                DatabaseManager.updateNotificationBadges();
            } else {
                const err = await res.json().catch(() => ({}));
                ToastManager.show('Delete Failed', err.message || 'Could not delete user from database', 'error');
                await this.loadUsers();
            }
        } catch (e) {
            console.error('Error deleting user:', e);
            ToastManager.show('Network Error', 'Failed to communicate with database server', 'error');
            await this.loadUsers();
        }
    }

    static promptDeleteItem(itemId: string, itemName: string) {
        const modal = document.getElementById('delete-confirm-modal');
        const targetName = document.getElementById('delete-item-target-name');
        const confirmBtn = document.getElementById('btn-confirm-delete') as HTMLButtonElement;
        const cancelBtn = document.getElementById('btn-cancel-delete');
        const closeBtn = document.getElementById('close-delete-confirm');

        if (!modal) return;
        if (targetName) targetName.innerText = itemName;

        modal.style.removeProperty('display');
        modal.classList.add('active');

        const closeModal = () => {
            modal.classList.remove('active');
        };

        if (cancelBtn) cancelBtn.onclick = closeModal;
        if (closeBtn) closeBtn.onclick = closeModal;
        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };

        if (confirmBtn) {
            confirmBtn.onclick = async () => {
                confirmBtn.disabled = true;
                confirmBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Deleting...';
                try {
                    const token = localStorage.getItem('cicr_token');
                    const res = await fetch(`${API_BASE}/items/${itemId}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    });
                    const json = await res.json();
                    if (res.ok) {
                        // 1. Immediately remove item from local state & cache
                        setInventory(inventory.filter(it => it.id !== itemId && String(it.id) !== String(itemId)));
                        DatabaseManager.save();

                        // 2. If detail modal is open for this item, close it
                        if (selectedItem && (selectedItem.id === itemId || String(selectedItem.id) === String(itemId))) {
                            ModalManager.closeAll();
                        }

                        // 3. Close the delete confirm modal
                        closeModal();

                        // 4. Force re-render inventory grid and stats instantly
                        if (window.dashboard) {
                            window.dashboard.renderInventory(true);
                            window.dashboard.renderStats();
                        }

                        ToastManager.show('Item Removed', `"${itemName}" was permanently deleted from the vault.`, 'warning');

                        // 5. Sync from backend and update audit logs
                        await DatabaseManager.syncFromBackend();
                        await AdminManager.loadAuditLogs();
                        DatabaseManager.updateNotificationBadges();
                    } else {
                        ToastManager.show('Delete Error', json.message || 'Failed to delete item.', 'error');
                    }
                } catch (err: any) {
                    console.error('Delete item error:', err);
                    ToastManager.show('Network Error', 'Failed to reach backend API.', 'error');
                } finally {
                    confirmBtn.disabled = false;
                    confirmBtn.innerHTML = '<i data-lucide="trash-2"></i> Confirm Delete';
                    lucide.createIcons();
                }
            };
        }
        lucide.createIcons();
    }

    public static inspectUserProfile(data: { id?: string; name?: string; email?: string; roll?: string; batch?: string }) {
        const modal = document.getElementById('admin-user-profile-modal');
        if (!modal) return;

        // Try to match registered user
        const matchedUser = this.users.find(u =>
            (data.id && u.id === data.id) ||
            (data.email && u.email.toLowerCase() === data.email.toLowerCase()) ||
            (data.roll && u.roll_number && u.roll_number.toLowerCase() === data.roll.toLowerCase()) ||
            (data.name && u.name.toLowerCase() === data.name.toLowerCase())
        );

        const displayName = matchedUser?.name || data.name || 'Student Borrower';
        const displayEmail = matchedUser?.email || data.email || (data.roll ? `${data.roll}@mail.jiit.ac.in` : '—');
        const displayRoll = matchedUser?.roll_number || data.roll || (displayEmail.includes('@') && !displayEmail.startsWith('—') ? displayEmail.split('@')[0] : '—');
        const displayBranch = getStudentBranch(displayRoll, matchedUser?.batch || data.batch);
        const displayRole = matchedUser?.role || 'MEMBER';
        const displayStatus = matchedUser?.status || 'ACTIVE';

        // Avatar
        const avatarEl = document.getElementById('inspector-user-avatar');
        if (avatarEl) {
            const avatarUrl = matchedUser?.avatar_url || AdminManager.getUserAvatar(displayEmail);
            if (avatarUrl) {
                avatarEl.innerHTML = `<img src="${escapeHtml(avatarUrl)}" class="inspector-avatar-img" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
            } else {
                avatarEl.textContent = displayName.charAt(0).toUpperCase();
            }
        }

        // Role badge
        const roleBadgeEl = document.getElementById('inspector-user-role-badge');
        if (roleBadgeEl) {
            roleBadgeEl.textContent = displayRole;
            roleBadgeEl.className = `profile-inspector-role-badge ${displayRole === 'ADMIN' ? 'admin' : ''}`;
        }

        // Name and status
        const nameEl = document.getElementById('inspector-user-name');
        if (nameEl) nameEl.textContent = displayName;

        const statusEl = document.getElementById('inspector-user-status');
        if (statusEl) {
            statusEl.textContent = displayStatus;
            statusEl.className = `profile-status-pill ${displayStatus.toLowerCase()}`;
        }

        // Meta items
        const branchEl = document.getElementById('inspector-user-branch');
        if (branchEl) branchEl.innerHTML = `<i data-lucide="git-branch"></i> <span>Branch: ${AdminManager.escapeHtml(displayBranch)}</span>`;

        const rollEl = document.getElementById('inspector-user-roll');
        if (rollEl) rollEl.innerHTML = `<i data-lucide="hash"></i> <span>Roll: ${AdminManager.escapeHtml(displayRoll)}</span>`;

        const emailEl = document.getElementById('inspector-user-email');
        if (emailEl) emailEl.innerHTML = `<i data-lucide="mail"></i> <span>${AdminManager.escapeHtml(displayEmail)}</span>`;

        // Gather active and historical borrowings for this user
        const normName = displayName.toLowerCase().trim();
        const normEmail = displayEmail.toLowerCase().trim();
        const normRoll = displayRoll.toLowerCase().trim();

        // Check active borrowings from inventory
        const activeLoans: Array<{ itemName: string; category: string; quantity: number; date: string; dueDate?: string; isOverdue: boolean }> = [];
        const now = new Date();

        if (Array.isArray(inventory)) {
            inventory.forEach(item => {
                (item.borrowedBy || []).forEach((b: any) => {
                    const isRet = b.returned || b.status === 'RETURNED';
                    if (isRet) return;
                    const bName = (b.userName || b.borrowerName || b.name || '').toLowerCase().trim();
                    const bEmail = (b.userEmail || b.email || '').toLowerCase().trim();
                    const bRoll = (b.userRoll || b.roll || '').toLowerCase().trim();

                    const matches = (normEmail && bEmail === normEmail) ||
                        (normRoll && normRoll !== '—' && bRoll === normRoll) ||
                        (normName && bName === normName);

                    if (matches) {
                        const rawDueDate = b.dueDate ? new Date(b.dueDate) : null;
                        const isOverdue = rawDueDate && !isNaN(rawDueDate.getTime()) && rawDueDate < now;
                        activeLoans.push({
                            itemName: item.name,
                            category: item.category || 'Component',
                            quantity: Number(b.qty) || Number(b.quantity) || 1,
                            date: b.date || '',
                            dueDate: b.dueDate || undefined,
                            isOverdue: Boolean(isOverdue)
                        });
                    }
                });
            });
        }

        // Also check HardwareLedgerManager.records
        const ledgerRecords = (HardwareLedgerManager as any).records || [];
        const userLedger = ledgerRecords.filter((r: any) => {
            const bName = (r.borrower_name || '').toLowerCase().trim();
            const bEmail = (r.borrower_email || '').toLowerCase().trim();
            const bRoll = (r.borrower_roll || '').toLowerCase().trim();
            return (normEmail && bEmail === normEmail) ||
                (normRoll && normRoll !== '—' && bRoll === normRoll) ||
                (normName && bName === normName);
        });

        const totalCheckoutEvents = userLedger.length;
        const totalReturned = userLedger.filter((r: any) => r.action_type === 'RETURNED' || Boolean(r.return_date) || r.status === 'RETURNED').length;
        const activeLoansCount = Math.max(activeLoans.length, userLedger.filter((r: any) => r.action_type !== 'RETURNED' && !r.return_date && r.status !== 'RETURNED').length);
        const overdueCount = activeLoans.filter(l => l.isOverdue).length;

        const statActive = document.getElementById('inspector-stat-active');
        const statReturned = document.getElementById('inspector-stat-returned');
        const statOverdue = document.getElementById('inspector-stat-overdue');
        const statTotal = document.getElementById('inspector-stat-total');

        if (statActive) statActive.textContent = String(activeLoansCount);
        if (statReturned) statReturned.textContent = String(totalReturned);
        if (statOverdue) statOverdue.textContent = String(overdueCount);
        if (statTotal) statTotal.textContent = String(totalCheckoutEvents);

        // Populate active loans container
        const loansContainer = document.getElementById('inspector-active-loans');
        if (loansContainer) {
            if (activeLoans.length === 0) {
                loansContainer.innerHTML = `
                    <div style="text-align:center; padding: 16px; color:#64748b; font-size: 12px;">
                        <i data-lucide="package-check" style="width:24px;height:24px;display:block;margin:0 auto 8px;color:#39ff14;"></i>
                        No hardware components currently checked out by this member.
                    </div>
                `;
            } else {
                loansContainer.innerHTML = activeLoans.map(loan => `
                    <div class="inspector-loan-item">
                        <div class="inspector-loan-left">
                            <span class="inspector-loan-name">${AdminManager.escapeHtml(loan.itemName)}</span>
                            <span class="inspector-loan-meta">${AdminManager.escapeHtml(loan.category)}</span>
                        </div>
                        <div class="inspector-loan-right">
                            <span class="inspector-loan-qty">${loan.quantity} unit${loan.quantity > 1 ? 's' : ''}</span>
                            <span class="inspector-loan-due ${loan.isOverdue ? 'overdue' : ''}">
                                ${loan.dueDate ? `Due: ${new Date(loan.dueDate).toLocaleDateString()}` : 'Open Loan'}
                                ${loan.isOverdue ? ' (OVERDUE)' : ''}
                            </span>
                        </div>
                    </div>
                `).join('');
            }
        }

        // "Filter In Component Logs" button
        const filterBtn = document.getElementById('btn-inspector-filter-logs');
        if (filterBtn) {
            filterBtn.onclick = () => {
                modal.classList.remove('active');
                modal.style.display = 'none';
                if (typeof (window as any).switchSection === 'function') {
                    (window as any).switchSection('hardware-logs-view');
                }
                const searchInput = document.getElementById('hw-ledger-search') as HTMLInputElement;
                if (searchInput) {
                    searchInput.value = displayRoll !== '—' ? displayRoll : displayName;
                    (HardwareLedgerManager as any).searchQuery = searchInput.value.toLowerCase().trim();
                    HardwareLedgerManager.renderTable();
                }
            };
        }

        const closeBtn = document.getElementById('btn-close-user-profile-modal');
        const closeX = document.getElementById('close-user-profile-modal');
        if (closeBtn) closeBtn.onclick = () => { modal.classList.remove('active'); modal.style.display = 'none'; };
        if (closeX) closeX.onclick = () => { modal.classList.remove('active'); modal.style.display = 'none'; };

        modal.classList.add('active');
        modal.style.display = 'flex';
        renderLucideIcons(modal);
    }

    static activeAuditDay: string = 'all';
    static activeAuditDaysRange: number = 7;
    static auditTelemetry: any = null;

    static async loadAuditLogs(resetToFull7Days = false) {
        const token = localStorage.getItem('cicr_token');
        const isAuth = document.body.classList.contains('authenticated') || document.documentElement.classList.contains('is-authenticated');
        if (!token || !isAuth) return;

        if (resetToFull7Days) {
            this.activeAuditDay = 'all';
            this.activeAuditDaysRange = 7;
            this.activeAuditCategory = 'all';

            // Reset category and range pills in UI
            document.querySelectorAll('#admin-audit-pills .audit-pill').forEach(p => {
                p.classList.toggle('active', (p as HTMLElement).dataset.auditCat === 'all');
            });
            document.querySelectorAll('#admin-audit-range-pills .audit-range-pill').forEach(p => {
                p.classList.toggle('active', p.getAttribute('data-range-days') === '7');
            });
        }

        try {
            let url = `${API_BASE}/audit?days=${this.activeAuditDaysRange}&limit=2500&category=${this.activeAuditCategory}`;
            if (this.activeAuditDay && this.activeAuditDay !== 'all') {
                url += `&day=${this.activeAuditDay}`;
            }

            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const json = await res.json();
                this.auditLogs = json.data || [];
                this.auditTelemetry = json;

                this.updateAuditCategoryPills(json.categoryCounts);
                this.renderAuditLogs();

                // Synchronize notifications drawer system tab if currently active
                if (ModalManager.activeNotifTab === 'system') {
                    ModalManager.renderLogsDrawer();
                }
            } else if (res.status === 401) {
                if (typeof AuthManager !== 'undefined') AuthManager.handleLogout();
                return;
            }
        } catch (err) {
            console.warn('[ADMIN] Failed to load 7-day audit logs:', err);
        }
    }

    static updateAuditCategoryPills(counts?: any) {
        if (!counts) return;
        const setCnt = (id: string, val: number) => {
            const el = document.getElementById(id);
            if (el) el.innerText = String(val || 0);
        };
        setCnt('cat-cnt-all', counts.all || 0);
        setCnt('cat-cnt-auth', counts.auth || 0);
        setCnt('cat-cnt-inventory', counts.inventory || 0);
        setCnt('cat-cnt-hardware', counts.hardware || 0);
        setCnt('cat-cnt-loans', counts.loans || 0);
        setCnt('cat-cnt-system', counts.system || 0);
    }

    static renderAuditLogs() {
        const container = document.getElementById('admin-audit-stream');
        const countTag = document.getElementById('admin-audit-count-tag');
        const totalStat = document.getElementById('admin-stat-total-logs');
        if (!container) return;

        // 1. Time-range filter (1d / 3d / 7d)
        const rangeFilteredLogs = filterAuditLogsByRange(this.auditLogs, this.activeAuditDaysRange);

        // Category badge counts for the active window (server telemetry wins if present)
        this.updateAuditCategoryPills(
            this.auditTelemetry?.categoryCounts || computeAuditCategoryCounts(rangeFilteredLogs)
        );

        // 2. Category filter, then 3. search filter
        let filtered = filterAuditLogsByCategory(rangeFilteredLogs, this.activeAuditCategory);
        filtered = filterAuditLogsBySearch(filtered, this.auditSearchTerm);

        if (countTag) countTag.innerText = `${filtered.length} EVENTS`;
        if (totalStat) totalStat.innerText = String(rangeFilteredLogs.length);

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="admin-empty-state">
                    <i data-lucide="check-circle-2"></i>
                    <p>No audit log events found matching the criteria in the 7-day retention window.</p>
                </div>
            `;
            renderLucideIcons(container);
            return;
        }

        container.innerHTML = filtered.map(log => buildAuditCard(log, {
            dateTime: (raw) => DashboardManager.formatLogDateTime(raw),
            timeAgo: (raw) => this.formatTimeAgo(raw)
        })).join('');

        renderLucideIcons(container);
    }

    static openAuditDetail(logId: string) {
        const log = this.auditLogs.find(l => l.id === logId);
        if (!log) return;

        const modal = document.getElementById('audit-detail-modal');
        if (!modal) return;

        const badgeEl = document.getElementById('audit-modal-badge');
        const timeEl = document.getElementById('audit-modal-time');
        const actorEl = document.getElementById('audit-modal-actor');
        const emailEl = document.getElementById('audit-modal-email');
        const itemEl = document.getElementById('audit-modal-item');
        const isoEl = document.getElementById('audit-modal-iso');
        const descEl = document.getElementById('audit-modal-desc');
        const jsonEl = document.getElementById('audit-modal-json');

        const rawTime = log.timestamp || log.created_at || new Date().toISOString();
        const dt = DashboardManager.formatLogDateTime(rawTime);
        const timeAgo = this.formatTimeAgo(rawTime);

        if (badgeEl) badgeEl.innerText = log.action || 'SYSTEM EVENT';
        if (timeEl) timeEl.innerText = `${dt.dateStr} ${dt.timeStr} (${timeAgo})`;
        if (actorEl) actorEl.innerText = log.users?.name || (log.user_id ? 'Authenticated Member' : 'System Engine');
        if (emailEl) emailEl.innerText = log.users?.email || '—';
        if (itemEl) itemEl.innerText = log.inventory?.name || (log.item_id || '—');
        if (isoEl) isoEl.innerText = rawTime;
        if (descEl) descEl.innerText = log.description || 'No detailed description available.';
        if (jsonEl) jsonEl.innerText = JSON.stringify(log, null, 2);

        modal.classList.add('active');
        renderLucideIcons(modal);
    }

    static exportAuditLogsCSV() {
        if (!this.auditLogs || this.auditLogs.length === 0) {
            ToastManager.show('Export Empty', 'No audit logs available to export.', 'warning');
            return;
        }

        const headers = ['Timestamp', 'Action', 'Actor Name', 'Actor Email', 'Target Item', 'Description'];
        const rows = this.auditLogs.map(l => [
            `"${l.timestamp || ''}"`,
            `"${(l.action || '').replace(/"/g, '""')}"`,
            `"${(l.users?.name || '').replace(/"/g, '""')}"`,
            `"${(l.users?.email || '').replace(/"/g, '""')}"`,
            `"${(l.inventory?.name || '').replace(/"/g, '""')}"`,
            `"${(l.description || '').replace(/"/g, '""')}"`
        ]);

        const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `cicr_audit_ledger_7days_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        ToastManager.show('Report Exported', `Downloaded 7-day audit ledger (${this.auditLogs.length} events).`, 'success');
    }

    static async triggerAuditRetentionCleanup() {
        const token = localStorage.getItem('cicr_token');
        if (!token) return;

        try {
            const res = await fetch(`${API_BASE}/audit/cleanup`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const json = await res.json();
            if (res.ok) {
                ToastManager.show('Retention Enforced', '7-Day backend retention sync complete. Expired records pruned.', 'success');
                await this.loadAuditLogs();
            } else {
                ToastManager.show('Cleanup Failed', json.message || 'Could not enforce retention.', 'error');
            }
        } catch (err: any) {
            ToastManager.show('Network Error', 'Failed to reach retention cleanup endpoint.', 'error');
        }
    }

    static formatTimeAgo(dateStr: string): string {
        const d = new Date(dateStr).getTime();
        if (isNaN(d)) return 'Recently';
        const diff = Math.floor((Date.now() - d) / 1000);
        if (diff < 30) return 'JUST NOW';
        if (diff < 60) return `${diff}S AGO`;
        if (diff < 3600) return `${Math.floor(diff / 60)}M AGO`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}H AGO`;
        return `${Math.floor(diff / 86400)}D AGO`;
    }

    static escapeHtml(str: string): string {
        return escapeHtml(str);
    }
}
