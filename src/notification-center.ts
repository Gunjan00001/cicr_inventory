/**
 * NotificationCenterManager — personalized header notification dropdown and
 * unread-state tracking. Depends on: modal, admin, database, toast, core/state. */

import { ModalManager } from './modal';
import { inventory, requests } from './core/state';
import { AdminManager } from './admin';
import { DatabaseManager } from './database';
import { ToastManager } from './toast';

// ==========================================
// Personalized Notification Center Manager
// ==========================================
export class NotificationCenterManager {
    private static isInitialized = false;
    private static readIds: Set<string> = new Set();

    private static ensureReadIds(): Set<string> {
        if (!this.readIds) this.readIds = new Set();
        try {
            const stored = localStorage.getItem('cicr_read_notifs');
            if (stored) {
                const arr = JSON.parse(stored);
                if (Array.isArray(arr)) {
                    arr.forEach((id: string) => this.readIds.add(id));
                }
            }
        } catch {}
        return this.readIds;
    }

    public static init() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        this.ensureReadIds();

        const notifBtn = document.getElementById('header-notif-btn');
        const dropdown = document.getElementById('header-notif-dropdown');
        const clearBtn = document.getElementById('btn-clear-notifs');
        const viewAllBtn = document.getElementById('btn-notif-view-all-logs');

        if (notifBtn && dropdown) {
            notifBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isOpen = dropdown.style.display !== 'none';
                if (isOpen) {
                    dropdown.style.display = 'none';
                    notifBtn.setAttribute('aria-expanded', 'false');
                } else {
                    dropdown.style.display = 'block';
                    notifBtn.setAttribute('aria-expanded', 'true');
                    this.renderDropdown();
                }
            });

            // Dismiss when clicking outside
            document.addEventListener('click', (e) => {
                if (!dropdown.contains(e.target as Node) && !notifBtn.contains(e.target as Node)) {
                    dropdown.style.display = 'none';
                    notifBtn.setAttribute('aria-expanded', 'false');
                }
            });

            // Dismiss when pressing Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && dropdown.style.display !== 'none') {
                    dropdown.style.display = 'none';
                    notifBtn.setAttribute('aria-expanded', 'false');
                }
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.markAllAsRead();
            });
        }

        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dropdown) dropdown.style.display = 'none';
                if (notifBtn) notifBtn.setAttribute('aria-expanded', 'false');
                if (typeof ModalManager !== 'undefined' && typeof ModalManager.openLogsDrawer === 'function') {
                    ModalManager.openLogsDrawer();
                } else {
                    const isAdmin = ModalManager.getCurrentRole() === 'ADMIN';
                    (window as any).switchSection?.(isAdmin ? 'hardware-logs-view' : 'profile-view');
                }
            });
        }

        this.updateNotifications();
    }

    public static getPersonalizedNotifications(): Array<{
        id: string;
        type: 'request' | 'issued' | 'returned' | 'due' | 'admin_alert';
        title: string;
        message: string;
        time: string;
        timestamp: number;
        unread: boolean;
        linkAction?: () => void;
    }> {
        this.ensureReadIds();
        const isAdmin = ModalManager.getCurrentRole() === 'ADMIN';
        const lastReadAllTime = Number(localStorage.getItem('cicr_last_read_all_time') || 0);
        const notifsCleared = localStorage.getItem('cicr_notifs_cleared') === 'true';

        const isUnread = (id: string, ts: number) => {
            if (this.readIds.has(id)) return false;
            if (id.startsWith('loan-') && this.readIds.has(id.replace('loan-', ''))) return false;
            if (id.startsWith('req-admin-') && this.readIds.has(id.replace('req-admin-', ''))) return false;
            if (id.startsWith('my-req-') && this.readIds.has(id.replace('my-req-', ''))) return false;
            if (notifsCleared) {
                if (lastReadAllTime > 0 && ts <= (lastReadAllTime + 86400000)) return false;
                if (!lastReadAllTime) return false;
            }
            if (lastReadAllTime > 0 && ts <= lastReadAllTime) return false;
            return true;
        };

        const notifs: Array<{
            id: string;
            type: 'request' | 'issued' | 'returned' | 'due' | 'admin_alert';
            title: string;
            message: string;
            time: string;
            timestamp: number;
            unread: boolean;
            linkAction?: () => void;
        }> = [];

        // Pre-scan active loans & accepted items to delete / suppress stale pending request alerts
        const now = Date.now();
        const userActiveIssuedNames = new Set<string>();
        const userActiveIssuedIds = new Set<string>();
        const userAcceptedBorrowIds = new Set<string>();
        const userAcceptedReqIds = new Set<string>();

        if (Array.isArray(inventory)) {
            inventory.forEach((item: any) => {
                (item.borrowedBy || []).forEach((b: any) => {
                    const isMine = ModalManager.isUserLoanMatch(b);
                    const isReturned = b.returned || b.status === 'RETURNED';
                    if (isMine && !isReturned) {
                        if (item.name) userActiveIssuedNames.add(item.name.toLowerCase().trim());
                        if (item.id) userActiveIssuedIds.add(String(item.id));
                        if (b.id) userAcceptedBorrowIds.add(String(b.id));
                        if (b.requestId) userAcceptedReqIds.add(String(b.requestId));
                    }
                });
            });
        }

        // 1. Pending / Active Requests
        let localRequests: any[] = [];
        try {
            const raw = localStorage.getItem('cicr_requests');
            if (raw) localRequests = JSON.parse(raw);
        } catch {}

        const adminQueue = (typeof AdminManager !== 'undefined' && Array.isArray(AdminManager.hardwareRequests))
            ? AdminManager.hardwareRequests
            : [];
        const memberQueue = (typeof AdminManager !== 'undefined' && Array.isArray(AdminManager.userHardwareRequests))
            ? AdminManager.userHardwareRequests
            : [];

        (memberQueue || []).forEach((r: any) => {
            if (r && (r.status === 'APPROVED' || r.status === 'BORROWED')) {
                if (r.id) userAcceptedReqIds.add(String(r.id));
                if (r.itemId) userActiveIssuedIds.add(String(r.itemId));
                if (r.itemName) userActiveIssuedNames.add(r.itemName.toLowerCase().trim());
            }
        });
        (requests || []).forEach((r: any) => {
            if (r && (r.status === 'APPROVED' || r.status === 'BORROWED') && (isAdmin || ModalManager.isUserRequestMatch(r))) {
                if (r.id) userAcceptedReqIds.add(String(r.id));
                if (r.itemId) userActiveIssuedIds.add(String(r.itemId));
                if (r.itemName) userActiveIssuedNames.add(r.itemName.toLowerCase().trim());
            }
        });

        // Automatically purge accepted/issued requests from local requests cache
        let localRequestsChanged = false;
        const cleanedLocalRequests = localRequests.filter((r: any) => {
            if (!r) return false;
            const rId = String(r.id || '');
            const rItemId = String(r.itemId || '');
            const rItemName = (r.itemName || '').toLowerCase().trim();
            const isAccepted = userAcceptedReqIds.has(rId) ||
                (rItemId && userActiveIssuedIds.has(rItemId)) ||
                (rItemName && userActiveIssuedNames.has(rItemName)) ||
                r.status === 'APPROVED';
            if (isAccepted) {
                localRequestsChanged = true;
                return false;
            }
            return true;
        });
        if (localRequestsChanged) {
            try {
                localStorage.setItem('cicr_requests', JSON.stringify(cleanedLocalRequests));
                localRequests = cleanedLocalRequests;
            } catch {}
        }

        const combinedReqs = isAdmin
            ? [...adminQueue, ...(requests || []), ...localRequests]
            : [...memberQueue, ...(requests || []).filter(r => ModalManager.isUserRequestMatch(r)), ...localRequests.filter(r => ModalManager.isUserRequestMatch(r))];
        const seenReqIds = new Set<string>();

        if (isAdmin) {
            combinedReqs.forEach((req: any) => {
                if (!req || !req.id || seenReqIds.has(String(req.id))) return;
                seenReqIds.add(String(req.id));

                const reqTime = this.parseSafeTime(req.requestedAt || req.timestamp, now);
                const isReturn = req.type === 'RETURN' || Boolean(req.borrowId);
                const reqName = req.borrowerName || req.name || 'Member';
                const reqItem = req.itemName || 'Hardware Component';
                const reqQty = Number(req.quantity || req.qty || req.returnQuantity) || 1;

                if (req.status === 'PENDING') {
                    const notifId = `req-admin-${req.id}`;
                    notifs.push({
                        id: notifId,
                        type: 'admin_alert',
                        title: isReturn ? 'Hardware Return Pending' : 'New Hardware Request',
                        message: isReturn
                            ? `${reqName} submitted return for ${reqQty}x ${reqItem}`
                            : `${reqName} requested ${reqQty}x ${reqItem}`,
                        time: this.formatRelativeTime(reqTime),
                        timestamp: reqTime,
                        unread: isUnread(notifId, reqTime),
                        linkAction: () => {
                            if (typeof ModalManager !== 'undefined' && typeof ModalManager.openLogsDrawer === 'function') {
                                ModalManager.activeNotifTab = 'pending';
                                ModalManager.openLogsDrawer();
                            } else {
                                (window as any).switchSection?.('admin-view');
                            }
                        }
                    });
                } else if (req.status === 'APPROVED' && (now - reqTime < 48 * 60 * 60 * 1000)) {
                    const notifId = `req-admin-app-${req.id}`;
                    notifs.push({
                        id: notifId,
                        type: 'issued',
                        title: isReturn ? 'Return Accepted' : 'Hardware Request Approved',
                        message: `${reqName} - ${reqQty}x ${reqItem} (${isReturn ? 'Return Accepted' : 'Issued'})`,
                        time: this.formatRelativeTime(reqTime),
                        timestamp: reqTime,
                        unread: isUnread(notifId, reqTime),
                        linkAction: () => {
                            if (typeof ModalManager !== 'undefined' && typeof ModalManager.openLogsDrawer === 'function') {
                                ModalManager.activeNotifTab = 'approved';
                                ModalManager.openLogsDrawer();
                            }
                        }
                    });
                } else if (req.status === 'REJECTED' && (now - reqTime < 48 * 60 * 60 * 1000)) {
                    const notifId = `req-admin-rej-${req.id}`;
                    notifs.push({
                        id: notifId,
                        type: 'request',
                        title: 'Request Declined',
                        message: `${reqName} - ${reqItem} declined`,
                        time: this.formatRelativeTime(reqTime),
                        timestamp: reqTime,
                        unread: isUnread(notifId, reqTime),
                        linkAction: () => {
                            if (typeof ModalManager !== 'undefined' && typeof ModalManager.openLogsDrawer === 'function') {
                                ModalManager.activeNotifTab = 'rejected';
                                ModalManager.openLogsDrawer();
                            }
                        }
                    });
                }
            });
        } else {
            combinedReqs.forEach((req: any) => {
                if (!req || !req.id || seenReqIds.has(String(req.id))) return;
                seenReqIds.add(String(req.id));

                if (!ModalManager.isUserRequestMatch(req)) return;

                const reqTime = this.parseSafeTime(req.requestedAt || req.timestamp, now);
                const status = (req.status || 'PENDING').toUpperCase();
                const isReturn = req.type === 'RETURN' || Boolean(req.borrowId);
                const reqItem = req.itemName || 'Hardware Component';
                const reqQty = Number(req.quantity || req.qty || req.returnQuantity) || 1;
                const notifId = `my-req-${req.id}`;

                const isAccepted = userAcceptedReqIds.has(String(req.id)) ||
                    (req.itemId && userActiveIssuedIds.has(String(req.itemId))) ||
                    (req.itemName && userActiveIssuedNames.has(req.itemName.toLowerCase().trim())) ||
                    status === 'APPROVED';

                // Automatically delete / suppress pending alert if the request has already been accepted/issued
                if (isAccepted && status === 'PENDING') {
                    return;
                }

                let title = 'Request In Review';
                let message = `Request for ${reqQty}x ${reqItem} is awaiting admin approval.`;
                let type: 'request' | 'issued' | 'returned' = 'request';

                if (status === 'APPROVED') {
                    // If component already present in active loans, inventory section will show "Component Issued"
                    type = isReturn ? 'returned' : 'issued';
                    title = isReturn ? 'Return Accepted' : 'Request Approved';
                    message = isReturn
                        ? `Your return of ${reqItem} (${reqQty}x) was accepted.`
                        : `Your request for ${reqItem} was approved and issued!`;
                } else if (status === 'REJECTED') {
                    type = 'request';
                    title = 'Request Declined';
                    message = `Your request for ${reqItem} was declined.`;
                } else {
                    title = isReturn ? 'Return Under Review' : 'Request In Review';
                    message = isReturn
                        ? `Return request for ${reqQty}x ${reqItem} is awaiting admin verification.`
                        : `Request for ${reqQty}x ${reqItem} is awaiting admin approval.`;
                }

                notifs.push({
                    id: notifId,
                    type,
                    title,
                    message,
                    time: this.formatRelativeTime(reqTime),
                    timestamp: reqTime,
                    unread: isUnread(notifId, reqTime),
                    linkAction: () => {
                        if (typeof ModalManager !== 'undefined' && typeof ModalManager.openLogsDrawer === 'function') {
                            ModalManager.activeNotifTab = status === 'APPROVED' ? 'approved' : (status === 'REJECTED' ? 'rejected' : 'pending');
                            ModalManager.openLogsDrawer();
                        } else {
                            (window as any).switchSection?.('profile-view');
                        }
                    }
                });
            });
        }

        // 2. Active Loans & Returns from inventory
        if (Array.isArray(inventory)) {
            inventory.forEach((item: any) => {
                (item.borrowedBy || []).forEach((b: any, idx: number) => {
                    const isMine = ModalManager.isUserLoanMatch(b);

                    if (isAdmin || isMine) {
                        const isReturned = b.returned || b.status === 'RETURNED';
                        const loanTime = this.parseSafeTime(b.timestamp || b.createdAt || b.date, now);
                        const loanId = b.id || `${item.id}-${idx}`;

                        if (isReturned) {
                            // Non-admins only see their own returns.
                            // Admins see all returns from past 48 hours to avoid stale alerts from days ago
                            const isRecent = (now - loanTime) < (48 * 60 * 60 * 1000);
                            if (isMine || (isAdmin && isRecent)) {
                                const notifId = `ret-${loanId}`;
                                notifs.push({
                                    id: notifId,
                                    type: 'returned',
                                    title: isMine ? 'Return Verified' : 'Return Logged',
                                    message: isMine
                                        ? `${item.name} (${b.qty || 1} units) return has been verified.`
                                        : `${b.userName || b.borrowerName || b.name || 'Member'} returned ${item.name}`,
                                    time: this.formatRelativeTime(loanTime),
                                    timestamp: loanTime,
                                    unread: isUnread(notifId, loanTime),
                                    linkAction: () => {
                                        (window as any).switchSection?.(isAdmin ? 'hardware-logs-view' : 'profile-view');
                                    }
                                });
                            }
                        } else {
                            if (b.dueDate) {
                                const dueTime = new Date(b.dueDate).getTime();
                                if (!isNaN(dueTime)) {
                                    const diffHours = (dueTime - now) / (1000 * 60 * 60);
                                    if (diffHours < 48 && diffHours > 0) {
                                        const dueNotifId = `due-${loanId}`;
                                        notifs.push({
                                            id: dueNotifId,
                                            type: 'due',
                                            title: isMine ? 'Return Due Soon' : 'Component Due Soon',
                                            message: isMine
                                                ? `${item.name} is due within 48 hours (${new Date(b.dueDate).toLocaleDateString()}).`
                                                : `${item.name} loaned to ${b.userName || b.borrowerName || b.name || 'Member'} is due within 48 hours.`,
                                            time: 'Action Required',
                                            timestamp: dueTime,
                                            unread: isUnread(dueNotifId, dueTime),
                                            linkAction: () => {
                                                (window as any).switchSection?.(isAdmin ? 'hardware-logs-view' : 'profile-view');
                                            }
                                        });
                                    } else if (diffHours <= 0) {
                                        const overdueNotifId = `overdue-${loanId}`;
                                        notifs.push({
                                            id: overdueNotifId,
                                            type: 'due',
                                            title: 'Component Overdue',
                                            message: isMine
                                                ? `${item.name} is overdue! Please return to robotics lab.`
                                                : `${item.name} loaned to ${b.userName || b.borrowerName || b.name || 'Member'} is overdue!`,
                                            time: 'Overdue',
                                            timestamp: dueTime,
                                            unread: isUnread(overdueNotifId, dueTime),
                                            linkAction: () => {
                                                (window as any).switchSection?.(isAdmin ? 'hardware-logs-view' : 'profile-view');
                                            }
                                        });
                                    }
                                }
                            }

                            const isRecentLoan = (now - loanTime) < (48 * 60 * 60 * 1000);
                            if (isMine || (isAdmin && isRecentLoan)) {
                                const loanNotifId = `loan-${loanId}`;
                                notifs.push({
                                    id: loanNotifId,
                                    type: 'issued',
                                    title: isMine ? 'Component Issued' : 'Loan Recorded',
                                    message: isMine
                                        ? `${item.name} (${b.qty || 1} units) issued to you.`
                                        : `${item.name} issued to ${b.userName || b.borrowerName || b.name || 'Member'}`,
                                    time: this.formatRelativeTime(loanTime),
                                    timestamp: loanTime,
                                    unread: isUnread(loanNotifId, loanTime),
                                    linkAction: () => {
                                        (window as any).switchSection?.(isAdmin ? 'hardware-logs-view' : 'profile-view');
                                    }
                                });
                            }
                        }
                    }
                });
            });
        }

        const uniqueMap = new Map<string, typeof notifs[0]>();
        notifs.forEach(n => {
            if (!uniqueMap.has(n.id)) {
                uniqueMap.set(n.id, n);
            }
        });

        return Array.from(uniqueMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    }

    public static updateNotifications() {
        this.ensureReadIds();
        const notifs = this.getPersonalizedNotifications();
        const unreadCount = notifs.filter(n => n.unread).length;

        const badge = document.getElementById('header-notif-badge');
        const dot = document.getElementById('header-notif-dot');

        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = String(unreadCount);
                badge.style.display = 'inline-flex';
            } else {
                badge.textContent = '0';
                badge.style.display = 'none';
            }
        }

        if (dot) {
            dot.style.display = unreadCount > 0 ? 'block' : 'none';
        }
    }

    public static renderDropdown() {
        const listEl = document.getElementById('header-notif-list');
        const subEl = document.getElementById('notif-dropdown-sub');
        if (!listEl) return;

        const isAdmin = ModalManager.getCurrentRole() === 'ADMIN';
        if (subEl) {
            subEl.textContent = isAdmin ? 'Admin Alerts & Activity' : 'Your Personal Activity & Updates';
        }

        const viewAllBtn = document.getElementById('btn-notif-view-all-logs');
        if (viewAllBtn) {
            viewAllBtn.innerHTML = isAdmin
                ? `<span>View All in Logs</span><i data-lucide="arrow-right"></i>`
                : `<span>View My Activity</span><i data-lucide="arrow-right"></i>`;
        }

        const notifs = this.getPersonalizedNotifications().slice(0, 8);

        if (notifs.length === 0) {
            listEl.innerHTML = `
                <div class="notif-empty-state">
                    <i data-lucide="bell-off"></i>
                    <h5>No Notifications</h5>
                    <p>You're all caught up! There are no recent alerts for your account.</p>
                </div>
            `;
            if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
            return;
        }

        const iconMap: Record<string, { icon: string; cls: string }> = {
            request: { icon: 'clock', cls: 'notif-type-pending' },
            issued: { icon: 'check-circle-2', cls: 'notif-type-issued' },
            returned: { icon: 'shield-check', cls: 'notif-type-returned' },
            due: { icon: 'alert-triangle', cls: 'notif-type-due' },
            admin_alert: { icon: 'bell', cls: 'notif-type-admin' }
        };

        listEl.innerHTML = notifs.map(n => {
            const cfg = iconMap[n.type] || { icon: 'info', cls: 'notif-type-info' };
            return `
                <div class="notif-item-card ${n.unread ? 'unread' : ''}" data-notif-id="${n.id}">
                    <div class="notif-item-icon-wrap ${cfg.cls}">
                        <i data-lucide="${cfg.icon}"></i>
                    </div>
                    <div class="notif-item-content">
                        <div class="notif-item-header">
                            <span class="notif-item-title">${AdminManager.escapeHtml(n.title)}</span>
                            <span class="notif-item-time">${n.time}</span>
                        </div>
                        <p class="notif-item-desc">${AdminManager.escapeHtml(n.message)}</p>
                    </div>
                </div>
            `;
        }).join('');

        listEl.querySelectorAll('.notif-item-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = (card as HTMLElement).dataset.notifId;
                if (id) {
                    this.readIds.add(id);
                    localStorage.setItem('cicr_read_notifs', JSON.stringify(Array.from(this.readIds)));
                    card.classList.remove('unread');
                    this.updateNotifications();
                }
                const notif = notifs.find(n => n.id === id);
                if (notif && notif.linkAction) {
                    const dropdown = document.getElementById('header-notif-dropdown');
                    if (dropdown) dropdown.style.display = 'none';
                    const notifBtn = document.getElementById('header-notif-btn');
                    if (notifBtn) notifBtn.setAttribute('aria-expanded', 'false');
                    notif.linkAction();
                }
            });
        });

        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }
    }

    public static markAllAsRead() {
        this.ensureReadIds();
        const notifs = this.getPersonalizedNotifications();
        notifs.forEach(n => {
            this.readIds.add(n.id);
            if (n.id.startsWith('loan-')) this.readIds.add(n.id.replace('loan-', ''));
            if (n.id.startsWith('req-admin-')) this.readIds.add(n.id.replace('req-admin-', ''));
            if (n.id.startsWith('my-req-')) this.readIds.add(n.id.replace('my-req-', ''));
        });
        const now = Date.now();
        localStorage.setItem('cicr_last_read_all_time', String(now));
        localStorage.setItem('cicr_read_notifs', JSON.stringify(Array.from(this.readIds)));
        localStorage.setItem('cicr_notifs_cleared', 'true');

        if (typeof DatabaseManager !== 'undefined') {
            DatabaseManager.isNotificationsCleared = true;
            DatabaseManager.updateNotificationBadges();
        }

        const badge = document.getElementById('header-notif-badge');
        const dot = document.getElementById('header-notif-dot');
        if (badge) {
            badge.textContent = '0';
            badge.style.display = 'none';
        }
        if (dot) {
            dot.style.display = 'none';
        }

        this.updateNotifications();
        this.renderDropdown();

        // Immediate visual feedback on the button
        const clearBtn = document.getElementById('btn-clear-notifs');
        if (clearBtn && !(clearBtn as HTMLButtonElement).disabled) {
            const originalHTML = clearBtn.innerHTML;
            clearBtn.innerHTML = `<i data-lucide="check"></i> <span>All Read</span>`;
            (clearBtn as HTMLButtonElement).disabled = true;
            if (typeof lucide !== 'undefined' && lucide.createIcons) {
                lucide.createIcons();
            }
            setTimeout(() => {
                clearBtn.innerHTML = originalHTML;
                (clearBtn as HTMLButtonElement).disabled = false;
                if (typeof lucide !== 'undefined' && lucide.createIcons) {
                    lucide.createIcons();
                }
            }, 2000);
        }

        if (typeof ToastManager !== 'undefined' && typeof ToastManager.show === 'function') {
            ToastManager.show('All Caught Up', 'All notifications have been marked as read.', 'success');
        }
    }

    private static parseSafeTime(val: any, fallbackTs: number = Date.now()): number {
        if (!val) return fallbackTs;
        if (typeof val === 'number' && !isNaN(val)) return Math.min(Date.now(), val);
        if (typeof val === 'string') {
            const trimmed = val.trim();
            // If it's a date-only string like YYYY-MM-DD
            if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
                const now = new Date();
                const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                if (trimmed === todayStr) {
                    return fallbackTs;
                }
                const parsedDate = new Date(`${trimmed}T12:00:00`);
                if (!isNaN(parsedDate.getTime())) return Math.min(Date.now(), parsedDate.getTime());
            }
            const parsed = new Date(trimmed);
            if (!isNaN(parsed.getTime())) return Math.min(Date.now(), parsed.getTime());
        }
        return fallbackTs;
    }

    private static formatRelativeTime(ts: number): string {
        const diffMs = Date.now() - ts;
        if (diffMs <= 0) return 'Just now';
        const diffMins = Math.floor(diffMs / (1000 * 60));
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays}d ago`;
        return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }
}

(window as any).NotificationCenterManager = NotificationCenterManager;
