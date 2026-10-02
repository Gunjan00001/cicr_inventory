/**
 * DatabaseManager — client-side state and persistence layer.
 *
 * Responsibilities
 * - localStorage epoch/reset and local caching of inventory, logs, requests.
 * - Syncs those collections from the REST API and owns the auto-sync timer.
 * - Writes audit events (server-side persistence is admin-only).
 *
 * Depends on: core/state, core/api, most managers. */

import { inventory, logs, requests, setInventory, setLogs, setRequests } from './core/state';
import { AdminManager } from './admin';
import { API_BASE } from './core/api';
import { ModalManager } from './modal';
import { ProfileViewManager } from './profile-view';
import { HardwareLedgerManager } from './hardware-ledger';
import { NotificationCenterManager } from './notification-center';
import type { ActivityLog, BorrowRecord } from './types';

// ==========================================
// 3. Database Manager & Supabase Realtime Auto-Sync
// ==========================================
export class DatabaseManager {
    static init() {
        // Enforce clean fresh start across all browsers and users
        const CURRENT_STATE_EPOCH = 'cicr_v10_all_returned_restocked';
        if (localStorage.getItem('cicr_fresh_epoch') !== CURRENT_STATE_EPOCH) {
            localStorage.removeItem('cicr_requests');
            localStorage.removeItem('cicr_logs');
            localStorage.removeItem('cicr_inventory');
            localStorage.removeItem('cicr_dismissed_requests');
            localStorage.removeItem('cicr_pending_returns');
            localStorage.removeItem('cicr_read_notifs');
            localStorage.removeItem('cicr_cart_items');
            localStorage.setItem('cicr_notifs_cleared', 'true');
            localStorage.setItem('cicr_fresh_epoch', CURRENT_STATE_EPOCH);
            DatabaseManager.isNotificationsCleared = true;
            setInventory([]);
            setLogs([]);
            setRequests([]);
            if (typeof AdminManager !== 'undefined') {
                AdminManager.hardwareRequests = [];
                AdminManager.userHardwareRequests = [];
            }
            if ((window as any).dashboard) {
                (window as any).dashboard.renderStats();
            }
        }

        const storedInventory = localStorage.getItem('cicr_inventory');
        if (storedInventory) {
            try {
                setInventory(JSON.parse(storedInventory));
                inventory.forEach((item: any) => {
                    const nm = (item.name || '').toLowerCase();
                    if (nm.includes('model unclear') || nm === 'arduino board') {
                        item.name = 'Arduino Uno R3';
                    }
                    const total = Number(item.quantity) || 0;
                    const avail = (item.availableQuantity !== undefined && item.availableQuantity !== null)
                        ? Number(item.availableQuantity)
                        : total;
                    if (avail >= total && Array.isArray(item.borrowedBy)) {
                        item.borrowedBy.forEach((b: any) => {
                            b.returned = true;
                            b.status = 'RETURNED';
                        });
                    }
                    if (Array.isArray(item.borrowedBy)) {
                        item.borrowedBy = item.borrowedBy.filter((b: any) => !b.returned && b.status !== 'RETURNED');
                    }
                });
            } catch {
                setInventory([]);
            }
        } else {
            setInventory([]);
        }

        const storedLogs = localStorage.getItem('cicr_logs');
        if (storedLogs) {
            try {
                setLogs(JSON.parse(storedLogs));
            } catch {
                setLogs([]);
            }
        } else {
            setLogs([]);
        }

        const storedRequests = localStorage.getItem('cicr_requests');
        if (storedRequests) {
            try {
                const parsed = JSON.parse(storedRequests);
                setRequests((parsed || []).filter((r: any) =>
                    Boolean(r && (r.id || r.itemId || r.itemName))
                ));
                localStorage.setItem('cicr_requests', JSON.stringify(requests));
            } catch {
                setRequests([]);
                localStorage.removeItem('cicr_requests');
            }
        } else {
            setRequests([]);
        }

        // Immediately auto-sync with Supabase backend without delay
        this.syncFromBackend();
        this.updateNotificationBadges();
    }

    static async syncFromBackend() {
        try {
            const token = localStorage.getItem('cicr_token');
            const headers: Record<string, string> = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            // Fetch public inventory catalog items (strictly lazy-load audit, history & users on-demand)
            const itemsRes = await fetch(`${API_BASE}/items`, { headers });
            let dbItems: any[] = [];
            if (itemsRes.ok) {
                try {
                    const json = await itemsRes.json();
                    dbItems = json.data || [];
                } catch { }
            }

            // Fetch active loans from backend to sync return buttons and active loans
            let dbActiveLoans: any[] = [];
            if (token) {
                try {
                    const role = ModalManager.getCurrentRole();
                    const loansEndpoint = role === 'ADMIN' ? `${API_BASE}/borrow/ledger?force=true` : `${API_BASE}/borrow/history?force=true`;
                    const loansRes = await fetch(loansEndpoint, { headers });
                    if (loansRes.ok) {
                        const loansJson = await loansRes.json();
                        dbActiveLoans = Array.isArray(loansJson.data) ? loansJson.data : [];
                        if (typeof ProfileViewManager !== 'undefined' && dbActiveLoans.length > 0) {
                            ProfileViewManager.cachedHistory = dbActiveLoans;
                        }
                    }
                } catch (e) {
                    console.warn('[DatabaseManager] Loans sync notice:', e);
                }
            }

            if (dbItems.length > 0) {
                // Map inventory items with available_quantity computed canonically by backend
                setInventory(dbItems.map((item: any) => {
                    let cat = (item.category || '').toLowerCase();
                    if (cat.includes('controller') || cat.includes('mcu') || cat.includes('board') || cat.includes('programmer')) cat = 'microcontrollers';
                    else if (cat.includes('sensor')) cat = 'sensors';
                    else if (cat.includes('actuator') || cat.includes('motor') || cat.includes('esc') || cat.includes('servo') || cat.includes('driver')) cat = 'actuators';
                    else if (cat.includes('power') || cat.includes('battery') || cat.includes('charge') || cat.includes('supply')) cat = 'power';
                    else if (cat.includes('tool') || cat.includes('comm') || cat.includes('display') || cat.includes('remote') || cat.includes('cable') || cat.includes('mechanical') || cat.includes('misc')) cat = 'tools';

                    const totalQty = Number(item.quantity) || 0;
                    const availableQty = (item.available_quantity !== undefined && item.available_quantity !== null)
                        ? Math.min(totalQty, Math.max(0, Number(item.available_quantity)))
                        : totalQty;

                    let cleanName = (item.name || '').trim();
                    if (cleanName.toLowerCase().includes('model unclear') || cleanName.toLowerCase() === 'arduino board') {
                        cleanName = 'Arduino Uno R3';
                    }

                    const existingItem = inventory.find(i => String(i.id) === String(item.id));

                    // Map server active loans for this item (strictly active loans only)
                    const itemActiveLoans: BorrowRecord[] = availableQty >= totalQty ? [] : dbActiveLoans
                        .filter((rec: any) =>
                            String(rec.inventory_id || rec.inventory?.id) === String(item.id) &&
                            rec.status !== 'RETURNED' &&
                            !rec.returned &&
                            !rec.returned_at
                        )
                        .map((rec: any) => {
                            const isPendingRet = (requests || []).some(
                                (r: any) => r.status === 'PENDING' && r.type === 'RETURN' && (String(r.borrowId || (r as any).borrow_id) === String(rec.id) || (String(r.itemId || (r as any).inventory_id) === String(item.id) && ModalManager.isUserRequestMatch(r)))
                            );
                            return {
                                id: rec.id,
                                name: rec.borrower_name || rec.users?.name || 'Member',
                                userName: rec.borrower_name || rec.users?.name || 'Member',
                                borrowerName: rec.borrower_name || rec.users?.name || 'Member',
                                roll: rec.roll_number || rec.users?.roll_number || '',
                                userRoll: rec.roll_number || rec.users?.roll_number || '',
                                email: rec.borrower_email || rec.users?.email || '',
                                userEmail: rec.borrower_email || rec.users?.email || '',
                                userId: rec.user_id,
                                qty: Number(rec.quantity) || 1,
                                purpose: rec.purpose || 'Active Loan',
                                date: rec.borrowed_at || new Date().toISOString(),
                                dueDate: rec.due_date || null,
                                status: isPendingRet ? 'RETURN_REQUESTED' : rec.status,
                                returned: false
                            };
                        });

                    const existingLoans = availableQty >= totalQty ? [] : (existingItem?.borrowedBy || []).filter(
                        (ex: any) => !ex.returned && ex.status !== 'RETURNED' && ex.status !== 'REJECTED'
                    );
                    const mergedBorrowedBy = [...itemActiveLoans];
                    for (const ex of existingLoans) {
                        const existingMatch = mergedBorrowedBy.find(m => m.id === ex.id);
                        if (existingMatch) {
                            if ((ex as any).status === 'RETURN_REQUESTED') {
                                (existingMatch as any).status = 'RETURN_REQUESTED';
                            }
                        } else {
                            mergedBorrowedBy.push(ex);
                        }
                    }

                    return {
                        id: String(item.id),
                        name: cleanName,
                        category: cat || 'microcontrollers',
                        quantity: totalQty,
                        availableQuantity: availableQty,
                        location: item.location || 'Lab Shelf',
                        specs: item.description || 'No specifications provided.',
                        image: item.image || (cat === 'sensors' ? 'drone.jpg' : cat === 'actuators' || cat === 'power' ? 'rover.jpg' : 'microchip.jpg'),
                        tags: Array.isArray(item.tags) ? item.tags : typeof item.tags === 'string' ? JSON.parse(item.tags || '[]') : [],
                        borrowedBy: mergedBorrowedBy
                    };
                }));

                // Save to localStorage cache
                this.save();
            }

            if (window.dashboard && dbItems.length > 0) {
                window.dashboard.renderStats();
                if ((window as any).isUserScrolling) {
                    (window as any)._pendingDashboardRender = true;
                } else {
                    window.dashboard.renderInventory(true);
                }
            }
        } catch (err) {
            console.error('Realtime Supabase sync failed:', err);
        } finally {
            this.updateNotificationBadges();
        }
    }

    static save() {
        localStorage.setItem('cicr_inventory', JSON.stringify(inventory));
        localStorage.setItem('cicr_logs', JSON.stringify(logs));
        localStorage.setItem('cicr_requests', JSON.stringify(requests));
        this.updateNotificationBadges();
    }

    static isNotificationsCleared: boolean = false;

    static updateNotificationBadges() {
        const todayStr = new Date().toISOString().split('T')[0];
        const role = ModalManager.getCurrentRole();
        const isAdmin = role === 'ADMIN';

        const isUserLoan = (rec: BorrowRecord) => ModalManager.isUserLoanMatch(rec);
        const isUserRequest = (req: any) => ModalManager.isUserRequestMatch(req);

        let overdueCount = 0;
        let activeLoansCount = 0;
        let depletedStockCount = 0;

        inventory.forEach((item) => {
            const total = Number(item.quantity) || 0;
            const available = typeof item.availableQuantity === 'number'
                ? item.availableQuantity
                : total;

            // Only count as critical stock alert if item is completely depleted (0 available out of >0 total)
            if (isAdmin && available <= 0 && total > 0) {
                depletedStockCount++;
            }

            (item.borrowedBy || []).forEach((rec) => {
                if (rec.returned) return;

                const belongsToUser = isUserLoan(rec);
                if (!isAdmin && !belongsToUser) return;

                activeLoansCount++;

                let due = rec.dueDate;
                if (!due && rec.date) {
                    const bTime = new Date(rec.date).getTime();
                    if (!isNaN(bTime)) {
                        due = new Date(bTime + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                    }
                }
                if (due && due < todayStr) {
                    overdueCount++;
                }
            });
        });

        // Collect all user hardware requests from all available caches
        const userReqMap = new Map<string, any>();
        const dismissedRaw = localStorage.getItem('cicr_dismissed_requests');
        const dismissedSet: Set<string> = dismissedRaw ? new Set(JSON.parse(dismissedRaw)) : new Set();

        const addReq = (r: any) => {
            if (!r) return;
            const status = (r.status || 'PENDING').toUpperCase();
            if (status === 'PENDING' && (dismissedSet.has(r.id) || (r.borrowId && dismissedSet.has(r.borrowId)))) {
                return;
            }
            const isReturn = r.type === 'RETURN' || Boolean(r.borrowId);
            const borrowerKey = (r.borrowerEmail || r.email || r.roll || r.rollNumber || r.name || r.borrowerName || '').toLowerCase().trim();
            const itemKey = (r.itemId || r.itemName || '').toLowerCase().trim();
            const qtyKey = Number(r.quantity || r.qty) || 1;
            const purpKey = (r.purpose || '').toLowerCase().trim();
            const key = isReturn
                ? `ret__${(r.borrowId || r.id || '').trim().toLowerCase()}`
                : `iss__${borrowerKey}__${itemKey}__${qtyKey}__${purpKey}`;

            const reqKey = key || String(r.id || Math.random());
            if (userReqMap.has(reqKey)) {
                const existing = userReqMap.get(reqKey);
                const existingStatus = (existing.status || 'PENDING').toUpperCase();
                if (existingStatus === 'PENDING' && (status === 'APPROVED' || status === 'REJECTED')) {
                    userReqMap.set(reqKey, r);
                }
                return;
            }
            userReqMap.set(reqKey, r);
        };

        if (isAdmin) {
            if (typeof AdminManager !== 'undefined' && Array.isArray(AdminManager.hardwareRequests)) {
                AdminManager.hardwareRequests.forEach(addReq);
            }
            (requests || []).forEach(addReq);
        } else {
            if (typeof AdminManager !== 'undefined' && Array.isArray(AdminManager.userHardwareRequests)) {
                AdminManager.userHardwareRequests.forEach(r => {
                    if (r && isUserRequest(r)) addReq(r);
                });
            }
            (requests || []).forEach(r => {
                if (r && isUserRequest(r)) addReq(r);
            });
        }

        const storedReqRaw = localStorage.getItem('cicr_requests');
        if (storedReqRaw) {
            try {
                const parsed = JSON.parse(storedReqRaw);
                (parsed || []).forEach((r: any) => {
                    if (isAdmin || isUserRequest(r)) addReq(r);
                });
            } catch { }
        }

        if (typeof HardwareLedgerManager !== 'undefined' && typeof HardwareLedgerManager.getRecords === 'function') {
            const records = HardwareLedgerManager.getRecords();
            if (Array.isArray(records)) {
                records.forEach((rec: any) => {
                    if (!rec) return;
                    const isRet = rec.action_type === 'RETURNED' || Boolean(rec.return_date) || rec.status === 'RETURNED';
                    const isPend = rec.action_type === 'PENDING_APPROVAL' || rec.status === 'PENDING';
                    const statusVal = isPend ? 'PENDING' : (rec.status === 'REJECTED' ? 'REJECTED' : 'APPROVED');
                    const mappedReq = {
                        id: rec.id,
                        type: isRet ? 'RETURN' : 'ISSUE',
                        borrowId: isRet ? rec.id : undefined,
                        itemId: rec.component_id,
                        itemName: rec.component_name,
                        borrowerName: rec.borrower_name,
                        borrowerEmail: rec.borrower_email,
                        rollNumber: rec.borrower_roll,
                        status: statusVal
                    };
                    if (isAdmin || isUserRequest(mappedReq)) addReq(mappedReq);
                });
            }
        }

        const allUserReqs: any[] = Array.from(userReqMap.values());
        const userActiveNames = new Set<string>();
        const userActiveIds = new Set<string>();
        if (!isAdmin && Array.isArray(inventory)) {
            inventory.forEach((item: any) => {
                (item.borrowedBy || []).forEach((b: any) => {
                    if (ModalManager.isUserLoanMatch(b) && !b.returned && b.status !== 'RETURNED') {
                        if (item.name) userActiveNames.add(item.name.toLowerCase().trim());
                        if (item.id) userActiveIds.add(String(item.id));
                    }
                });
            });
        }
        const pendingCount = allUserReqs.filter(r => {
            if (r.status !== 'PENDING') return false;
            if (!isAdmin) {
                const rName = (r.itemName || '').toLowerCase().trim();
                const rId = String(r.itemId || '');
                if (userActiveNames.has(rName) || (rId && userActiveIds.has(rId))) {
                    return false;
                }
            }
            return true;
        }).length;

        const isLoggedIn = Boolean(localStorage.getItem('cicr_token') || localStorage.getItem('cicr_auth'));

        const isCleared = this.isNotificationsCleared || localStorage.getItem('cicr_notifs_cleared') === 'true';
        const effectivePending = isCleared ? 0 : pendingCount;

        const sidebarBadge = document.getElementById('sidebar-notif-badge');
        const sidebarBeacon = document.getElementById('sidebar-notif-beacon') || (document.querySelector('.notif-radar-beacon') as HTMLElement | null);
        const navBadge = document.getElementById('nav-bell-badge');

        const sidebarTitle = document.getElementById('sidebar-notif-title');
        const sidebarSubtext = document.getElementById('sidebar-notif-subtext');

        if (!isLoggedIn) {
            if (sidebarTitle) sidebarTitle.innerText = 'Review Request';
            if (sidebarSubtext) {
                sidebarSubtext.innerText = 'Track Requests';
                sidebarSubtext.title = 'Track Requests';
                sidebarSubtext.className = 'btn-subtext subtext-neutral';
            }
        } else if (isAdmin) {
            if (sidebarTitle) sidebarTitle.innerText = 'Review Request';
            if (sidebarSubtext) {
                sidebarSubtext.innerText = 'All User Requests';
                sidebarSubtext.title = 'All User Requests';
                sidebarSubtext.className = 'btn-subtext subtext-neutral';
            }
        } else {
            if (sidebarTitle) sidebarTitle.innerText = 'Review Request';
            if (sidebarSubtext) {
                sidebarSubtext.innerText = 'My Requests & Logs';
                sidebarSubtext.title = 'My Requests & Logs';
                sidebarSubtext.className = 'btn-subtext subtext-neutral';
            }
        }

        if (effectivePending > 0) {
            const alertStr = String(effectivePending);
            if (sidebarBadge) {
                if (sidebarBadge.innerText !== alertStr) sidebarBadge.innerText = alertStr;
                if (sidebarBadge.style.display !== 'inline-flex') sidebarBadge.style.display = 'inline-flex';
                if (!sidebarBadge.classList.contains('pulse')) sidebarBadge.classList.add('pulse');
            }
            if (sidebarBeacon) {
                if (sidebarBeacon.style.display !== 'block') sidebarBeacon.style.display = 'block';
            }
            if (navBadge) {
                if (navBadge.innerText !== alertStr) navBadge.innerText = alertStr;
                if (navBadge.style.display !== 'inline-flex') navBadge.style.display = 'inline-flex';
            }
        } else {
            if (sidebarBadge) {
                sidebarBadge.style.display = 'none';
                sidebarBadge.innerText = '0';
            }
            if (sidebarBeacon) sidebarBeacon.style.display = 'none';
            if (navBadge) {
                navBadge.style.display = 'none';
                navBadge.innerText = '0';
            }
        }

        if (typeof NotificationCenterManager !== 'undefined' && typeof NotificationCenterManager.updateNotifications === 'function') {
            NotificationCenterManager.updateNotifications();
        }
    }

    private static isSyncInProgress = false;

    static startAutoSync(intervalMs = 45000) {
        if ((window as any)._cicrAutoSyncTimer) {
            clearInterval((window as any)._cicrAutoSyncTimer);
        }
        (window as any)._cicrAutoSyncTimer = setInterval(async () => {
            // Do not hammer backend when tab is hidden or user is actively scrolling
            if (typeof document !== 'undefined' && document.hidden) return;
            if (this.isSyncInProgress) return;
            if ((window as any).isUserScrolling) return;

            this.isSyncInProgress = true;
            try {
                await this.syncFromBackend();
                const role = ModalManager.getCurrentRole();
                if (role === 'ADMIN' && typeof AdminManager !== 'undefined' && document.body.classList.contains('view-admin-view')) {
                    await AdminManager.loadHardwareRequests();
                }
                this.updateNotificationBadges();
            } catch (syncErr) {
                console.warn('Background sync cycle warning:', syncErr);
            } finally {
                this.isSyncInProgress = false;
            }
        }, intervalMs);
    }

    static addLog(type: ActivityLog['type'], text: string, itemId?: string) {
        const date = new Date();
        const timestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        logs.unshift({ type, timestamp, text });
        this.save();

        // Asynchronously persist to backend 7-day audit ledger.
        // The /audit endpoint is admin-only, so members would silently 403 here.
        // ponytail: member audit events remain local until a member-permitted endpoint exists.
        const token = localStorage.getItem('cicr_token');
        if (token && ModalManager.getCurrentRole() === 'ADMIN') {
            let action = 'System Event';
            if (type === 'borrow') action = 'Borrowed';
            else if (type === 'return') action = 'Returned';
            else if (type === 'add') action = 'Item Added';
            else if (type === 'approve') action = 'Hardware Approved';
            else if (type === 'reject') action = 'Hardware Rejected';
            else if (type === 'request') action = 'Hardware Requested';
            else if (type === 'low_stock') action = 'Stock Alert';

            const plainText = text.replace(/<[^>]*>?/gm, '');
            fetch(`${API_BASE}/audit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    action,
                    description: plainText,
                    itemId: itemId || null
                })
            }).catch(() => {});
        }
    }
}
