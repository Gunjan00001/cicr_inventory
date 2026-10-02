/**
 * HardwareLedgerManager — component issue/return ledger.
 *
 * Responsibilities
 * - Renders the filterable/searchable ledger table.
 * - Fetches the admin ledger (/borrow/ledger) or the member's own history
 *   (/borrow/history) depending on role.
 * - Deletes ledger records (admin).
 *
 * Depends on: admin, modal, toast, core/state, core/api, core/ui. */

import { readCurrentUser } from './core/session';
import { API_BASE } from './core/api';
import { inventory, requests } from './core/state';
import { AdminManager } from './admin';
import { ModalManager } from './modal';
import { escapeHtml } from './core/ui';
import { ToastManager } from './toast';
import type { BorrowRecord, InventoryItem } from './types';

// ==========================================
// ==========================================
// Hardware Ledger & Activity Logs Manager
// ==========================================
interface LedgerEntry {
    id: string;
    component_id: string | number;
    component_name: string;
    category: string;
    borrower_name: string;
    borrower_email: string;
    borrower_roll: string;
    admin_approved_by: string;
    operator_name?: string;
    action_type: 'ISSUED' | 'RETURNED' | 'PENDING_APPROVAL';
    quantity: number;
    date: string;
    due_date?: string | null;
    return_date?: string | null;
    purpose: string;
    remarks?: string | null;
    status: string;
}

/**
 * Maps a `/borrow/history` record (member-visible) into the LedgerEntry shape
 * consumed by the admin ledger table, so members can view their own activity.
 */
function mapHistoryToLedgerEntry(h: any): LedgerEntry {
    const returned = h.status === 'RETURNED' || Boolean(h.returned_at);
    const approver = h.reviewed_by || h.admin_approved_by || 'Lab Administrator';
    return {
        id: h.id,
        component_id: h.inventory_id || h.inventory?.id || '',
        component_name: h.inventory?.name || 'Hardware Component',
        category: h.inventory?.category || 'Component',
        borrower_name: h.borrower_name || h.users?.name || 'Member',
        borrower_email: h.borrower_email || h.users?.email || '',
        borrower_roll: h.roll_number || h.users?.roll_number || '—',
        admin_approved_by: approver,
        operator_name: approver,
        action_type: returned ? 'RETURNED' : 'ISSUED',
        quantity: Number(h.quantity) || 1,
        date: h.borrowed_at || null,
        due_date: h.due_date || null,
        return_date: h.returned_at || null,
        purpose: h.purpose || 'Hardware Prototyping & Research',
        remarks: h.remarks || null,
        status: h.status || 'BORROWED'
    };
}

export class HardwareLedgerManager {
    private static isInitialized = false;
    private static records: LedgerEntry[] = [];
    private static activeFilter: 'all' | 'borrowed' | 'returned' | 'requests' = 'all';
    private static searchQuery = '';
    private static isLoading = false;

    public static getRecords(): LedgerEntry[] {
        return this.records;
    }

    public static init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        // Filter tabs
        const filterBtns = document.querySelectorAll('.hw-filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeFilter = ((btn as HTMLElement).dataset.filter as any) || 'all';
                this.renderTable();
            });
        });

        // Search bar
        const searchInput = document.getElementById('hw-ledger-search') as HTMLInputElement;
        if (searchInput) {
            let searchTimeout: number | undefined;
            searchInput.addEventListener('input', () => {
                if (searchTimeout) clearTimeout(searchTimeout);
                searchTimeout = window.setTimeout(() => {
                    this.searchQuery = (searchInput.value || '').toLowerCase().trim();
                    this.renderTable();
                }, 150);
            });
        }

        // Sync / Refresh button
        const refreshBtn = document.getElementById('hw-ledger-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.classList.add('spinning');
                await this.fetchLedger(true);
                this.renderTable();
                setTimeout(() => refreshBtn.classList.remove('spinning'), 600);
            });
        }

        // Realtime sync: periodic background polling when ledger view is open & on window focus
        if (!HardwareLedgerManager.pollTimer) {
            HardwareLedgerManager.pollTimer = window.setInterval(() => {
                const view = document.getElementById('hardware-logs-view');
                if (view && view.style.display !== 'none' && !document.hidden) {
                    HardwareLedgerManager.fetchLedger(true).then(() => HardwareLedgerManager.renderTable());
                }
            }, 12000);

            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) {
                    const view = document.getElementById('hardware-logs-view');
                    if (view && view.style.display !== 'none') {
                        HardwareLedgerManager.fetchLedger(true).then(() => HardwareLedgerManager.renderTable());
                    }
                }
            });
        }

        // Delete modal triggers
        const cancelDeleteBtn = document.getElementById('btn-cancel-delete-ledger');
        const closeDeleteX = document.getElementById('btn-close-delete-ledger-x');
        const confirmDeleteBtn = document.getElementById('btn-confirm-delete-ledger');

        if (cancelDeleteBtn) cancelDeleteBtn.onclick = () => {
            const m = document.getElementById('delete-ledger-confirm-modal');
            if (m) m.style.display = 'none';
        };
        if (closeDeleteX) closeDeleteX.onclick = () => {
            const m = document.getElementById('delete-ledger-confirm-modal');
            if (m) m.style.display = 'none';
        };
        if (confirmDeleteBtn) confirmDeleteBtn.onclick = () => {
            HardwareLedgerManager.confirmDeleteRecord();
        };

        const tbodyEl = document.getElementById('hw-ledger-table-body');
        if (tbodyEl) {
            tbodyEl.addEventListener('click', (e) => {
                const delBtn = (e.target as HTMLElement).closest('.hw-btn-delete-log') as HTMLElement | null;
                if (delBtn && delBtn.dataset.logId) {
                    e.preventDefault();
                    e.stopPropagation();
                    HardwareLedgerManager.promptDeleteRecord(delBtn.dataset.logId);
                    return;
                }

                const retBtn = (e.target as HTMLElement).closest('.btn-ledger-return-action') as HTMLElement | null;
                if (retBtn && retBtn.dataset.borrowId) {
                    e.preventDefault();
                    e.stopPropagation();
                    HardwareLedgerManager.triggerReturn(retBtn.dataset.borrowId, retBtn.dataset.compId, retBtn.dataset.compName);
                    return;
                }
            });
        }
    }

    private static pollTimer: number | null = null;

    private static parseDateSafe(d: any): Date | null {
        if (!d) return null;
        if (d instanceof Date && !isNaN(d.getTime())) return d;
        if (typeof d === 'string') {
            const trimmed = d.trim();
            if (!trimmed || trimmed.toLowerCase().includes('day') || trimmed === '—' || trimmed.toLowerCase().includes('open')) return null;
            const parsed = new Date(trimmed);
            if (!isNaN(parsed.getTime())) return parsed;
        }
        if (typeof d === 'number') {
            const parsed = new Date(d);
            if (!isNaN(parsed.getTime())) return parsed;
        }
        return null;
    }

    public static async render() {
        this.init();
        await this.fetchLedger(true);
        this.renderTable();
    }

    public static async fetchLedger(force = false) {
        if (this.isLoading) return;
        if (this.records.length > 0 && !force) {
            return;
        }

        this.isLoading = true;
        try {
            const token = localStorage.getItem('cicr_token');
            let fetchedData: LedgerEntry[] = [];

            // `/borrow/ledger` is admin-only. Members fetch their own `/borrow/history`
            // instead, so the request does not silently 403 and fall back to partial local data.
            const isAdminRequest = ModalManager.getCurrentRole() === 'ADMIN';
            try {
                const headers: Record<string, string> = {};
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const endpoint = isAdminRequest
                    ? `${API_BASE}/borrow/ledger?force=true&t=${Date.now()}`
                    : `${API_BASE}/borrow/history?force=true&t=${Date.now()}`;
                const res = await fetch(endpoint, { headers });
                if (res.ok) {
                    const json = await res.json();
                    if (Array.isArray(json.data)) {
                        fetchedData = isAdminRequest ? json.data : json.data.map(mapHistoryToLedgerEntry);
                    }
                }
            } catch (err) {
                console.warn('Backend ledger/history unreachable, aggregating from inventory...', err);
            }

            // Fallback / merge with local inventory records
            const localRecords: LedgerEntry[] = [];
            if (Array.isArray(inventory)) {
                inventory.forEach(item => {
                    (item.borrowedBy || []).forEach((b: any, idx: number) => {
                        const isReturned = b.returned || b.status === 'RETURNED';
                        const borrower = b.userName || b.borrowerName || b.name || 'Student Borrower';
                        let adminApprover = b.adminApprovedBy || b.approvedBy || b.reviewedBy || '';
                        if (adminApprover && adminApprover.includes('SRVKILLER09')) {
                            adminApprover = '';
                        }
                        if (!adminApprover || adminApprover === 'Admin Team' || adminApprover === 'ADMIN' || adminApprover === 'Admin') {
                            adminApprover = 'Lab Administrator';
                        } else {
                            adminApprover = adminApprover.replace(/\s*\([Aa]dmin\)/gi, '').trim();
                        }
                        localRecords.push({
                            id: b.id || `local-${item.id}-${idx}`,
                            component_id: item.id,
                            component_name: item.name,
                            category: item.category || 'Component',
                            borrower_name: borrower,
                            borrower_email: b.userEmail || b.email || (b.userRoll ? `${b.userRoll}@mail.jiit.ac.in` : ''),
                            borrower_roll: b.userRoll || b.roll || (b.userEmail ? b.userEmail.split('@')[0] : '—'),
                            admin_approved_by: adminApprover,
                            operator_name: adminApprover,
                            action_type: isReturned ? 'RETURNED' : 'ISSUED',
                            quantity: Number(b.qty) || Number(b.quantity) || 1,
                            date: b.date || null,
                            due_date: b.dueDate || null,
                            return_date: b.returnDate || (isReturned ? (b.date || null) : null),
                            purpose: b.purpose || b.reason || 'Hardware Prototyping & Research',
                            remarks: b.remarks || b.note || null,
                            status: isReturned ? 'RETURNED' : (b.status || 'APPROVED')
                        });
                    });
                });
            }

            // Collect pending approval requests from local state and backend
            const pendingRequestRecords: LedgerEntry[] = [];
            let localReqs: any[] = [];
            try {
                const raw = localStorage.getItem('cicr_requests');
                if (raw) localReqs = JSON.parse(raw);
            } catch {}

            const combinedReqs = [...(requests || []), ...localReqs];
            const seenReqIds = new Set<string>();
            combinedReqs.forEach((r: any) => {
                if (!r || !r.id || seenReqIds.has(String(r.id))) return;
                seenReqIds.add(String(r.id));
                const status = (r.status || 'PENDING').toUpperCase();
                if (status === 'PENDING') {
                    pendingRequestRecords.push({
                        id: `req-${r.id}`,
                        component_id: r.itemId || '',
                        component_name: r.itemName || 'Hardware Component',
                        category: r.category || 'Component',
                        borrower_name: r.name || r.borrowerName || 'Student Borrower',
                        borrower_email: r.email || r.borrowerEmail || (r.roll ? `${r.roll}@mail.jiit.ac.in` : ''),
                        borrower_roll: r.roll || r.rollNumber || '—',
                        admin_approved_by: 'Awaiting Admin Review',
                        operator_name: 'Awaiting Admin Review',
                        action_type: 'PENDING_APPROVAL',
                        quantity: Number(r.qty || r.quantity) || 1,
                        date: r.requestedAt || r.date || null,
                        due_date: r.dueDate || '7 Days',
                        return_date: null,
                        purpose: r.purpose || 'Academic Project Research',
                        remarks: 'Pending Administrator Approval',
                        status: 'PENDING'
                    });
                }
            });

            // Merge and deduplicate with rigorous normalization
            const mergedMap = new Map<string, LedgerEntry>();
            fetchedData.forEach((r: any) => {
                const isReturned = r.status === 'RETURNED' || Boolean(r.returned_at);
                const isPending = r.status === 'PENDING' || r.action_type === 'PENDING_APPROVAL';
                const borrower = r.borrower_name || r.users?.name || r.userName || 'Student Borrower';
                const roll = r.borrower_roll || r.roll_number || r.users?.roll_number || (r.borrower_email ? r.borrower_email.split('@')[0] : '—');
                const email = r.borrower_email || r.users?.email || (roll && roll !== '—' ? `${roll}@mail.jiit.ac.in` : '');
                let adminApprover = r.admin_approved_by || r.reviewed_by || r.adminName || r.operator_name || '';
                if (adminApprover && adminApprover.includes('SRVKILLER09')) {
                    adminApprover = '';
                }

                // Cross-reference with AdminManager requests if reviewer recorded
                if (!adminApprover || adminApprover === 'Admin Team' || adminApprover === 'ADMIN') {
                    const matchedReq = (AdminManager.hardwareRequests || []).find((x: any) => x.id === r.id || x.borrowId === r.id || (x.itemId === (r.inventory_id || r.component_id) && (x.borrowerName === borrower || x.borrowerEmail === email)));
                    if (matchedReq && matchedReq.reviewedBy && matchedReq.reviewedBy !== 'ADMIN' && matchedReq.reviewedBy !== 'User') {
                        adminApprover = matchedReq.reviewedBy;
                    }
                }

                if (!adminApprover || adminApprover === 'Admin Team' || adminApprover === 'ADMIN' || adminApprover === 'Admin') {
                    adminApprover = isPending ? 'Awaiting Admin Review' : 'Lab Administrator';
                } else {
                    adminApprover = adminApprover.replace(/\s*\([Aa]dmin\)/gi, '').trim();
                }
                const normalized: LedgerEntry = {
                    id: String(r.id),
                    component_id: r.inventory_id || r.component_id || (r.inventory?.id) || '',
                    component_name: r.component_name || r.inventory?.name || r.itemName || 'Hardware Component',
                    category: r.category || r.inventory?.category || 'Component',
                    borrower_name: borrower,
                    borrower_email: email,
                    borrower_roll: roll,
                    admin_approved_by: adminApprover,
                    operator_name: adminApprover,
                    action_type: isPending ? 'PENDING_APPROVAL' : (isReturned ? 'RETURNED' : 'ISSUED'),
                    quantity: Number(r.quantity) || 1,
                    date: r.date || r.borrowed_at || r.created_at || null,
                    due_date: r.due_date || r.dueDate || null,
                    return_date: r.return_date || r.returned_at || (isReturned ? (r.borrowed_at || null) : null),
                    purpose: r.purpose || 'Academic Research',
                    remarks: r.remarks || null,
                    status: isPending ? 'PENDING' : (isReturned ? 'RETURNED' : (r.status || 'BORROWED'))
                };
                mergedMap.set(String(r.id), normalized);
            });

            localRecords.forEach(r => {
                if (!mergedMap.has(String(r.id))) {
                    mergedMap.set(String(r.id), r);
                }
            });

            pendingRequestRecords.forEach(r => {
                if (!mergedMap.has(String(r.id))) {
                    mergedMap.set(String(r.id), r);
                }
            });

            let allRecords = Array.from(mergedMap.values());

            // Personalization: If not admin, only show records belonging to the current user
            const currentRole = ModalManager.getCurrentRole();
            const isAdmin = currentRole === 'ADMIN';

            if (!isAdmin) {
                let currentUser: any = {};
                try { currentUser = readCurrentUser(); } catch {}
                const authName = localStorage.getItem('cicr_auth') || '';
                const myEmail = (currentUser.email || '').toLowerCase().trim();
                const myRoll = (currentUser.roll_number || currentUser.roll || '').toLowerCase().trim();
                const myName = (currentUser.name || currentUser.username || authName || '').toLowerCase().trim();

                const isGeneric = (n: string) => !n || ['member', 'student', 'user', 'admin', 'borrower', 'guest', 'student borrower'].includes(n) || n.length < 3;
                allRecords = allRecords.filter(r => {
                    const bEmail = (r.borrower_email || '').toLowerCase().trim();
                    const bRoll = (r.borrower_roll || '').toLowerCase().trim();
                    const bName = (r.borrower_name || '').toLowerCase().trim();

                    return (myEmail && bEmail === myEmail) ||
                           (myRoll && bRoll === myRoll) ||
                           (!isGeneric(myName) && !isGeneric(bName) && bName === myName);
                });
            }

            // Update banner dynamic titles
            const tagEl = document.getElementById('hw-ledger-banner-tag');
            const titleEl = document.getElementById('hw-ledger-banner-title');
            const descEl = document.getElementById('hw-ledger-banner-desc');
            if (tagEl) tagEl.textContent = isAdmin ? 'ADMIN AUDIT REGISTRY' : 'MY ACTIVITY LOGS';
            if (titleEl) titleEl.textContent = isAdmin ? 'Component Issue & Return Ledger' : 'My Logs & Issue History';
            if (descEl) descEl.textContent = isAdmin 
                ? 'Official administrative registry tracking component checkouts, verified borrower credentials, authorizing administrator, timestamps, and return verification.'
                : 'Review your pending component approval requests, active checkouts, and return verification history.';

            this.records = allRecords.sort((a, b) => {
                const timeA = a.date ? new Date(a.date).getTime() : 0;
                const timeB = b.date ? new Date(b.date).getTime() : 0;
                return timeB - timeA;
            });
        } finally {
            this.isLoading = false;
        }
    }

    public static renderTable() {
        // Update stats
        const totalLogs = this.records.length;
        const pendingRequests = this.records.filter(r => r.action_type === 'PENDING_APPROVAL' || r.status === 'PENDING').length;
        const activeIssued = this.records.filter(r => (r.action_type === 'ISSUED' || r.status === 'APPROVED' || r.status === 'BORROWED') && !r.return_date && r.status !== 'RETURNED').length;
        const totalReturned = this.records.filter(r => r.action_type === 'RETURNED' || Boolean(r.return_date) || r.status === 'RETURNED').length;

        const statTotal = document.getElementById('hw-stat-total-logs');
        const statPending = document.getElementById('hw-stat-pending-requests');
        const statActive = document.getElementById('hw-stat-active-issued');
        const statReturned = document.getElementById('hw-stat-total-returned');
        if (statTotal) statTotal.textContent = String(totalLogs);
        if (statPending) statPending.textContent = String(pendingRequests);
        if (statActive) statActive.textContent = String(activeIssued);
        if (statReturned) statReturned.textContent = String(totalReturned);

        // Filter
        const query = this.searchQuery;
        const filter = this.activeFilter;

        const filtered = this.records.filter(r => {
            const isRet = r.action_type === 'RETURNED' || Boolean(r.return_date) || r.status === 'RETURNED';
            const isPend = r.action_type === 'PENDING_APPROVAL' || r.status === 'PENDING';
            const isIss = (r.action_type === 'ISSUED' || r.status === 'APPROVED' || r.status === 'BORROWED') && !isRet && !isPend;

            if (filter === 'requests' && !isPend) return false;
            if (filter === 'borrowed' && !isIss) return false;
            if (filter === 'returned' && !isRet) return false;

            if (query) {
                const searchStr = `${r.component_name} ${r.category} ${r.borrower_name} ${r.borrower_roll} ${r.borrower_email} ${r.admin_approved_by} ${r.purpose} ${r.action_type} ${r.status}`.toLowerCase();
                if (!searchStr.includes(query)) return false;
            }

            return true;
        });

        const tbody = document.getElementById('hw-ledger-table-body');
        const countLabel = document.getElementById('hw-table-count-label');

        if (countLabel) {
            countLabel.textContent = `Showing ${filtered.length} log ${filtered.length === 1 ? 'entry' : 'entries'}${query ? ` matching "${query}"` : ''}`;
        }

        if (!tbody) return;

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="hw-ledger-empty-cell">
                        <div class="hw-empty-state">
                            <i data-lucide="clipboard-x"></i>
                            <h4>No Activity Logs Found</h4>
                            <p>${query ? `No records match "${AdminManager.escapeHtml(query)}". Try a different search.` : 'There are currently no transactions or approval requests recorded for this filter.'}</p>
                        </div>
                    </td>
                </tr>
            `;
            if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
            return;
        }

        const now = new Date();
        const isAdmin = ModalManager.getCurrentRole() === 'ADMIN';

        tbody.innerHTML = filtered.map(r => {
            const isPending = r.action_type === 'PENDING_APPROVAL' || r.status === 'PENDING';
            const isReturned = !isPending && (r.action_type === 'RETURNED' || Boolean(r.return_date) || r.status === 'RETURNED');
            
            const rawDate = this.parseDateSafe(r.date);
            const dateStr = rawDate
                ? rawDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                : '—';

            const rawDueDate = this.parseDateSafe(r.due_date);
            const isOverdue = !isReturned && !isPending && rawDueDate && rawDueDate < now;
            const dueDateStr = rawDueDate
                ? rawDueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                : (typeof r.due_date === 'string' && r.due_date.trim() ? r.due_date.trim() : 'Open Loan');

            const rawReturnDate = this.parseDateSafe(r.return_date);
            const returnDateStr = rawReturnDate
                ? `${rawReturnDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} at ${rawReturnDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()}`
                : 'Verified Return';

            const catMap: Record<string, string> = {
                microcontrollers: "MCU",
                sensors: "SENSOR",
                actuators: "ACTUATOR",
                power: "POWER",
                tools: "HARDWARE"
            };
            const catLabel = catMap[r.category?.toLowerCase()] || (r.category || 'COMPONENT').toUpperCase();

            let actionBadge = '';
            let statusCell = '';
            let actionCell = '';

            if (isPending) {
                actionBadge = `<span class="hw-badge-event badge-pending-pill"><i data-lucide="clock"></i> REQUESTED</span>`;
                statusCell = `<div class="hw-due-log text-pink"><i data-lucide="hourglass"></i> <span>Awaiting Admin Review</span></div>`;
                actionCell = `<span class="badge-in-review-pill"><i data-lucide="loader"></i> In Review</span>`;
            } else if (isReturned) {
                actionBadge = `<span class="hw-badge-event badge-returned"><i data-lucide="check-circle-2"></i> RETURNED</span>`;
                statusCell = `<div class="hw-return-log text-green"><i data-lucide="shield-check"></i> <span>Returned: ${returnDateStr}</span></div>`;
                actionCell = isAdmin
                    ? `<button type="button" class="hw-btn-delete-log" data-log-id="${r.id}" title="Permanently Delete Record (Admin Only)"><i data-lucide="trash-2"></i></button>`
                    : `<span class="badge-completed-pill"><i data-lucide="check-check"></i> Completed</span>`;
            } else {
                actionBadge = `<span class="hw-badge-event badge-issued"><i data-lucide="arrow-down-right"></i> ISSUED</span>`;
                statusCell = `<div class="hw-due-log"><span class="${isOverdue ? 'text-pink font-bold' : 'text-cyan'}"><i data-lucide="clock"></i> Due: ${dueDateStr}</span>${isOverdue ? '<span class="badge-overdue-pill"><i data-lucide="alert-triangle"></i> OVERDUE</span>' : ''}</div>`;
                actionCell = isAdmin
                    ? `<button type="button" class="hw-btn-delete-log" data-log-id="${r.id}" title="Permanently Delete Record (Admin Only)"><i data-lucide="trash-2"></i></button>`
                    : `<button type="button" class="btn-ledger-return-action" data-borrow-id="${r.id}" data-comp-id="${r.component_id}" data-comp-name="${AdminManager.escapeHtml(r.component_name)}" title="Initiate Component Return"><i data-lucide="corner-down-left"></i> <span>Return</span></button>`;
            }

            const rawApprover = r.admin_approved_by || (isPending ? 'Awaiting Admin Review' : 'Lab Administrator');
            const approverName = rawApprover.replace(/\s*\([Aa]dmin\)/gi, '').trim();

            return `
                <tr class="hw-ledger-row ${isOverdue ? 'row-overdue' : ''}">
                    <!-- Component -->
                    <td>
                        <div class="hw-td-component">
                            <span class="hw-item-name" title="${AdminManager.escapeHtml(r.component_name)}">${AdminManager.escapeHtml(r.component_name)}</span>
                            <span class="hw-cat-pill cat-${(r.category || '').toLowerCase()}">${catLabel}</span>
                        </div>
                    </td>

                    <!-- Borrower -->
                    <td>
                        <div class="hw-td-borrower">
                            ${(() => {
                                const borrowerAvatar = AdminManager.getUserAvatar(r.borrower_email);
                                return borrowerAvatar ? `<span class="hw-borrower-avatar-mini"><img src="${escapeHtml(borrowerAvatar)}" class="hw-avatar-img" alt="" /></span>` : '';
                            })()}
                            <div class="hw-borrower-meta-info" style="display:flex; flex-direction:column; min-width:0;">
                                <a href="#" class="admin-user-clickable hw-borrower-name" data-user-name="${AdminManager.escapeHtml(r.borrower_name)}" data-user-email="${AdminManager.escapeHtml(r.borrower_email)}" data-user-roll="${AdminManager.escapeHtml(r.borrower_roll)}" title="Inspect Member Profile">${AdminManager.escapeHtml(r.borrower_name)}</a>
                                <span class="hw-roll-badge">${AdminManager.escapeHtml(r.borrower_roll || 'JIIT')}</span>
                            </div>
                        </div>
                    </td>

                    <!-- Approved By -->
                    <td>
                        <div class="hw-td-admin">
                            <div class="hw-admin-badge-pill">
                                <i data-lucide="${isPending ? 'clock' : 'shield-check'}"></i>
                                <span class="hw-admin-name">${AdminManager.escapeHtml(approverName)}</span>
                            </div>
                        </div>
                    </td>

                    <!-- Event Type -->
                    <td>
                        ${actionBadge}
                    </td>

                    <!-- Quantity -->
                    <td>
                        <span class="hw-qty-pill">${r.quantity} unit${r.quantity > 1 ? 's' : ''}</span>
                    </td>

                    <!-- Date -->
                    <td>
                        <span class="hw-date-val"><i data-lucide="calendar"></i> ${dateStr}</span>
                    </td>

                    <!-- Purpose / Reason -->
                    <td>
                        <div class="hw-purpose-cell" title="${AdminManager.escapeHtml(r.purpose)}">
                            <span class="hw-purpose-text">${AdminManager.escapeHtml(r.purpose || 'Academic Project')}</span>
                        </div>
                    </td>

                    <!-- Status / Return Log -->
                    <td>
                        ${statusCell}
                    </td>

                    <!-- Action -->
                    <td>
                        ${actionCell}
                    </td>
                </tr>
            `;
        }).join('');

        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }
    }

    public static triggerReturn(borrowId: string, compId?: string, compName?: string) {
        if (!borrowId) return;

        // Try to find the item and loan in inventory
        let targetItem: InventoryItem | undefined;
        let targetLoan: BorrowRecord | undefined;
        let targetIdx = 0;

        if (Array.isArray(inventory)) {
            for (const item of inventory) {
                if (compId && String(item.id) === String(compId)) {
                    targetItem = item;
                }
                const idx = (item.borrowedBy || []).findIndex((b: any) => String(b.id) === String(borrowId));
                if (idx !== -1) {
                    targetItem = item;
                    targetLoan = item.borrowedBy[idx];
                    targetIdx = idx;
                    break;
                }
            }
        }

        if (targetItem && targetLoan) {
            ModalManager.openReturnModal(targetLoan, targetItem, targetIdx);
            return;
        }

        // Synthesize item & loan if not found in local array
        let user: any = {};
        try { user = readCurrentUser(); } catch {}
        const synthItem: any = targetItem || {
            id: compId || '1',
            name: compName || 'Hardware Component',
            borrowedBy: []
        };
        const synthLoan: BorrowRecord = {
            id: borrowId,
            name: user.name || 'Member',
            roll: user.roll_number || user.roll || '',
            email: user.email || '',
            qty: 1,
            date: new Date().toISOString(),
            purpose: 'Academic Project Research',
            status: 'BORROWED'
        };

        ModalManager.openReturnModal(synthLoan, synthItem, 0);
    }

    public static pendingDeleteId: string | null = null;

    public static promptDeleteRecord(id: string) {
        const record = this.records.find(r => r.id === id);
        if (!record) return;

        this.pendingDeleteId = id;
        const modal = document.getElementById('delete-ledger-confirm-modal');
        const summary = document.getElementById('delete-ledger-record-summary');
        if (summary) {
            summary.innerHTML = `
                <div><strong>Component:</strong> ${AdminManager.escapeHtml(record.component_name)} (${record.quantity} unit${record.quantity > 1 ? 's' : ''})</div>
                <div><strong>Borrower:</strong> ${AdminManager.escapeHtml(record.borrower_name)} (${AdminManager.escapeHtml(record.borrower_roll || '—')})</div>
                <div><strong>Status:</strong> ${record.action_type === 'RETURNED' || record.return_date ? 'Returned' : 'Issued / Active'}</div>
                <div><strong>Record ID:</strong> <code>${AdminManager.escapeHtml(record.id)}</code></div>
            `;
        }
        if (modal) {
            modal.classList.add('active');
            modal.style.display = 'flex';
            if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
        }
    }

    public static async confirmDeleteRecord() {
        if (!this.pendingDeleteId) return;
        const id = this.pendingDeleteId;
        this.pendingDeleteId = null;

        const modal = document.getElementById('delete-ledger-confirm-modal');
        if (modal) { modal.classList.remove('active'); modal.style.display = 'none'; }

        const token = localStorage.getItem('cicr_token');
        try {
            const res = await fetch(`${API_BASE}/borrow/ledger/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (res.ok) {
                this.records = this.records.filter(r => r.id !== id);
                this.renderTable();
                ToastManager.show('Ledger Record Purged', 'Record permanently removed from backend database.', 'success');
            } else {
                const json = await res.json().catch(() => ({}));
                ToastManager.show('Delete Failed', json.message || 'Could not delete ledger record.', 'error');
            }
        } catch (err: any) {
            ToastManager.show('Network Error', err.message || 'Server unreachable.', 'error');
        }
    }
}

(window as any).HardwareLedgerManager = HardwareLedgerManager;

(window as any).openHardwareLedger = () => {
    if (typeof (window as any).switchSection === 'function') {
        (window as any).switchSection('hardware-logs-view');
    }
};
