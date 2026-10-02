/**
 * ModalManager — modal lifecycle and shared modal helpers.
 *
 * Responsibilities
 * - open()/close()/closeAll() for .modal-overlay elements.
 * - Detail, borrow, return and consolidated bulk-return dialogs.
 * - Notification drawer rendering.
 * - Shared role helpers: getCurrentRole()/isAdmin() used across the UI.
 *
 * Depends on: core/state, core/ui, database, cart, profile-view, admin,
 * hardware-ledger. */

import { readCurrentUser } from './core/session';
import { ToastManager } from './toast';
import { inventory, requests, selectedItem, setRequests, setSelectedItem } from './core/state';
import { escapeHtml, getItemStockStatus, renderLucideIcons } from './core/ui';
import { DatabaseManager } from './database';
import { ProfileViewManager } from './profile-view';
import { AdminManager } from './admin';
import { CartManager } from './cart';
import { HardwareLedgerManager } from './hardware-ledger';
import { API_BASE } from './core/api';
import { isUserLoanMatch as matchLoan, isUserRequestMatch as matchRequest } from './core/identity';
import { notifEmptyCardHtml } from './ui/modal-templates';
import type { BorrowRecord, InventoryItem, RequestRecord } from './types';
import type { UserRole } from './core/ui';
import type { AdminHardwareRequest } from './core/domain';

// ==========================================
// 5. Modal & Form Controller Manager
// ==========================================
export class ModalManager {
    static init() {
        document.querySelectorAll('.close-modal, .modal-overlay').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target === el || el.classList.contains('close-modal') || (e.target as HTMLElement)?.closest('.close-modal')) {
                    this.closeAll();
                }
            });
        });

        document.querySelectorAll('.modal-content').forEach(content => {
            content.addEventListener('click', (e) => e.stopPropagation());
        });

        const addForm = document.getElementById('add-item-form') as HTMLFormElement;
        if (addForm) {
            addForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleAddItemSubmit();
            });
        }

        const btnInventoryAdd = document.getElementById('btn-inventory-add-item');
        if (btnInventoryAdd) {
            btnInventoryAdd.addEventListener('click', () => {
                if (this.getCurrentRole() !== 'ADMIN') {
                    ToastManager.show('Admin Access Required', 'Only administrators can register components into the vault.', 'warning');
                    return;
                }
                this.open('add-item-modal');
            });
        }

        const cancelAddBtn = document.getElementById('btn-add-cancel');
        if (cancelAddBtn) {
            cancelAddBtn.addEventListener('click', () => {
                this.close('add-item-modal');
            });
        }

        const borrowForm = document.getElementById('borrow-form') as HTMLFormElement;
        borrowForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleBorrowSubmit();
        });

        document.querySelector('.btn-back-to-detail')?.addEventListener('click', () => {
            this.close('borrow-form-modal');
            this.open('detail-modal');
        });

        document.getElementById('btn-borrow')?.addEventListener('click', () => {
            this.openBorrowFormModal();
        });

        // Interactive Calendar Picker & Presets for Issue Return Date
        const dueDateInput = document.getElementById('borrow-due-date') as HTMLInputElement | null;
        const btnCalendar = document.getElementById('btn-calendar-picker');
        const calendarWrapper = document.getElementById('borrow-calendar-wrapper');
        const durationBadge = document.getElementById('borrow-duration-badge');
        const presetPills = document.querySelectorAll('#borrow-form-modal .date-preset-pill');

        const updateDurationBadge = (dateVal: string) => {
            if (!durationBadge || !dateVal) return;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const target = new Date(dateVal);
            target.setHours(0, 0, 0, 0);
            const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays <= 0) {
                durationBadge.textContent = 'Due Today';
                durationBadge.className = 'form-label-badge badge-red';
            } else if (diffDays === 1) {
                durationBadge.textContent = '1 Day Loan';
                durationBadge.className = 'form-label-badge badge-blue';
            } else {
                durationBadge.textContent = `${diffDays} Days Loan`;
                durationBadge.className = 'form-label-badge badge-cyan';
            }
        };

        const openCalendar = (e?: Event) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            if (!dueDateInput) return;
            try {
                if (typeof (dueDateInput as any).showPicker === 'function') {
                    (dueDateInput as any).showPicker();
                } else {
                    dueDateInput.focus();
                }
            } catch (_) {
                dueDateInput.focus();
            }
        };

        btnCalendar?.addEventListener('click', openCalendar);
        calendarWrapper?.addEventListener('click', (e) => {
            if (e.target !== dueDateInput) {
                openCalendar(e);
            }
        });

        const handleDueDateChange = () => {
            if (dueDateInput?.value) {
                updateDurationBadge(dueDateInput.value);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const target = new Date(dueDateInput.value);
                target.setHours(0, 0, 0, 0);
                const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                presetPills.forEach(pill => {
                    const pDays = Number((pill as HTMLElement).dataset.days);
                    pill.classList.toggle('active', pDays === diffDays);
                });
            }
        };

        dueDateInput?.addEventListener('input', handleDueDateChange);
        dueDateInput?.addEventListener('change', handleDueDateChange);

        presetPills.forEach(pill => {
            pill.addEventListener('click', (e) => {
                e.preventDefault();
                const days = Number((pill as HTMLElement).dataset.days) || 7;
                const newDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                if (dueDateInput) {
                    dueDateInput.value = newDate;
                    updateDurationBadge(newDate);
                }
                presetPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
            });
        });

        document.querySelector('.btn-close-about')!.addEventListener('click', () => {
            this.close('about-modal');
        });

        const returnQtyForm = document.getElementById('return-qty-form') as HTMLFormElement | null;
        if (returnQtyForm && !returnQtyForm.dataset.bound) {
            returnQtyForm.dataset.bound = 'true';
            returnQtyForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const borrowId = (document.getElementById('return-borrow-id') as HTMLInputElement)?.value;
                const idx = Number((document.getElementById('return-borrow-idx') as HTMLInputElement)?.value) || 0;
                const qtyVal = Number((document.getElementById('return-qty-input') as HTMLInputElement)?.value) || 1;
                await ModalManager.handleReturnSubmission(borrowId, qtyVal, idx);
            });

            const qtyInput = document.getElementById('return-qty-input') as HTMLInputElement | null;
            const btnMinus = document.getElementById('btn-return-qty-minus');
            const btnPlus = document.getElementById('btn-return-qty-plus');
            const btnAll = document.getElementById('btn-return-all-qty');

            btnMinus?.addEventListener('click', () => {
                if (qtyInput) {
                    const cur = parseInt(qtyInput.value, 10) || 1;
                    qtyInput.value = String(Math.max(1, cur - 1));
                    ModalManager.updateReturnQtyPreview();
                }
            });

            btnPlus?.addEventListener('click', () => {
                if (qtyInput) {
                    const max = parseInt(qtyInput.max, 10) || 1;
                    const cur = parseInt(qtyInput.value, 10) || 1;
                    qtyInput.value = String(Math.min(max, cur + 1));
                    ModalManager.updateReturnQtyPreview();
                }
            });

            btnAll?.addEventListener('click', () => {
                if (qtyInput) {
                    qtyInput.value = qtyInput.max || '1';
                    ModalManager.updateReturnQtyPreview();
                }
            });

            qtyInput?.addEventListener('input', () => {
                ModalManager.updateReturnQtyPreview();
            });
            qtyInput?.addEventListener('change', () => {
                ModalManager.updateReturnQtyPreview();
            });
        }
    }

    public static updateReturnQtyPreview() {
        const qtyInput = document.getElementById('return-qty-input') as HTMLInputElement | null;
        const previewEl = document.getElementById('return-qty-preview');
        if (!qtyInput) return;
        const maxVal = Math.max(1, parseInt(qtyInput.max, 10) || 1);
        let currentVal = parseInt(qtyInput.value, 10);
        if (isNaN(currentVal) || currentVal < 1) currentVal = 1;
        if (currentVal > maxVal) currentVal = maxVal;
        qtyInput.value = String(currentVal);

        if (previewEl) {
            if (currentVal >= maxVal) {
                previewEl.innerHTML = `<span style="color:var(--neon-cyan); font-weight:700;">Full Return (${maxVal} units)</span>`;
            } else {
                const remaining = maxVal - currentVal;
                previewEl.innerHTML = `<span style="color:#ffb703; font-weight:700;">Partial Return (${remaining} unit${remaining > 1 ? 's' : ''} stay issued)</span>`;
            }
        }
    }

    public static isUserLoanMatch(rec: BorrowRecord): boolean {
        return matchLoan(rec);
    }

    public static isUserRequestMatch(req: any): boolean {
        return matchRequest(req);
    }

    static open(modalId: string) {
        document.getElementById(modalId)!.classList.add('active');
    }

    static close(modalId: string) {
        document.getElementById(modalId)!.classList.remove('active');
    }

    static closeAll() {
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            const el = overlay as HTMLElement;
            el.classList.remove('active');
            // Some modals are opened by toggling inline `display` instead of `.active`;
            // clear it so they actually close too.
            if (el.style.display === 'flex') el.style.display = '';
        });
        setSelectedItem(null);
    }

    public static getCurrentRole(): UserRole {
        const userStr = localStorage.getItem('cicr_user');
        if (!userStr) return 'MEMBER';
        try {
            const user = JSON.parse(userStr);
            return user && user.role === 'ADMIN' ? 'ADMIN' : 'MEMBER';
        } catch {
            return 'MEMBER';
        }
    }

    private static isAdmin() {
        return this.getCurrentRole() === 'ADMIN';
    }

    private static setBorrowModalMode(mode: 'borrow' | 'request', componentName: string, available: number) {
        const modalTitle = document.getElementById('borrow-form-title');
        const subtitle = document.getElementById('borrow-form-subtitle');
        const submitBtn = document.getElementById('borrow-form-submit') as HTMLButtonElement | null;
        const qtyLimit = document.getElementById('borrow-qty-limit');

        if (mode === 'borrow') {
            if (modalTitle) modalTitle.innerText = '⚡ Direct Issue Component';
            if (subtitle) subtitle.innerText = `Issuing ${componentName} directly into student custody`;
            if (submitBtn) submitBtn.innerText = 'Confirm & Issue Hardware';
        } else {
            if (modalTitle) modalTitle.innerText = 'Request Component Issue';
            if (subtitle) subtitle.innerText = `Requesting ${componentName} - Requires Admin Authorization`;
            if (submitBtn) submitBtn.innerText = 'Submit Issue Request';
        }
        if (qtyLimit) {
            qtyLimit.innerText = `Max units available: ${available}`;
        }
    }

    private static renderRequests() {
        const requestInbox = document.getElementById('request-inbox') as HTMLElement | null;
        const requestList = document.getElementById('request-list');
        const requestCountBadge = document.getElementById('request-count-badge');

        if (!requestInbox || !requestList || !requestCountBadge) return;

        if (!this.isAdmin()) {
            requestInbox.style.display = 'none';
            requestCountBadge.innerText = '0';
            return;
        }

        requestInbox.style.display = 'flex';
        const pendingRequests = requests
            .filter((request) => request.status === 'PENDING')
            .sort((a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime());
        requestCountBadge.innerText = String(pendingRequests.length);
        requestList.innerHTML = '';

        if (pendingRequests.length === 0) {
            requestList.innerHTML = '<div class="request-empty-state">No pending member requests right now.</div>';
            return;
        }

        pendingRequests.forEach((request) => {
            const requestEl = document.createElement('div');
            requestEl.className = 'request-item';
            requestEl.innerHTML = `
                <div class="request-item-header">
                    <div>
                        <h4 class="request-item-title">${escapeHtml(request.itemName)}</h4>
                        <div class="request-item-meta">
                            <span>${escapeHtml(request.name)}</span>
                            <span>${escapeHtml(request.roll)}</span>
                            <span>${Number(request.qty) || 1} units</span>
                        </div>
                    </div>
                    <span class="request-status-chip request-status-pending">${escapeHtml(request.status)}</span>
                </div>
                <div class="request-item-meta">
                    <span>Purpose: ${escapeHtml(request.purpose)}</span>
                    <span>Requested: ${escapeHtml(request.requestedAt)}</span>
                </div>
                <div class="request-item-actions">
                    <button class="btn btn-primary request-approve-btn" data-request-id="${escapeHtml(request.id)}">
                        <i data-lucide="check"></i> Approve
                    </button>
                    <button class="btn btn-secondary request-reject-btn" data-request-id="${escapeHtml(request.id)}">
                        <i data-lucide="x"></i> Reject
                    </button>
                </div>
            `;

            requestList.appendChild(requestEl);
        });

        requestList.querySelectorAll('.request-approve-btn').forEach((button) => {
            button.addEventListener('click', () => {
                const requestId = (button as HTMLButtonElement).dataset.requestId;
                if (requestId) {
                    this.reviewRequest(requestId, 'APPROVED');
                }
            });
        });

        requestList.querySelectorAll('.request-reject-btn').forEach((button) => {
            button.addEventListener('click', () => {
                const requestId = (button as HTMLButtonElement).dataset.requestId;
                if (requestId) {
                    this.reviewRequest(requestId, 'REJECTED');
                }
            });
        });
    }

    public static reviewRequest(requestId: string, nextStatus: 'APPROVED' | 'REJECTED') {
        if (!this.isAdmin()) return;

        const request = requests.find((entry) => entry.id === requestId);
        if (!request || request.status !== 'PENDING') return;

        if (nextStatus === 'APPROVED') {
            const item = inventory.find((entry) => entry.id === request.itemId);
            const borrowedSum = item
                ? (item.borrowedBy || [])
                    .filter((r: any) => !r.returned && (r as any).status !== 'RETURNED' && (r as any).status !== 'REJECTED')
                    .reduce((sum, rec) => sum + rec.qty, 0)
                : 0;
            const available = item ? item.quantity - borrowedSum : 0;

            if (!item || available < request.qty) {
                request.status = 'REJECTED';
                request.reviewedAt = new Date().toISOString();
                request.reviewedBy = localStorage.getItem('cicr_auth') || 'ADMIN';
                request.reviewNote = 'Auto-rejected because stock was no longer available.';
                DatabaseManager.addLog('reject', `<span>${request.name}</span>'s request for <span>${request.itemName}</span> was rejected because stock ran out.`);
                DatabaseManager.save();
                this.renderRequests();
                this.renderLogsDrawer();
                if (selectedItem && selectedItem.id === request.itemId) {
                    this.openDetailModal(selectedItem);
                }
                window.dashboard?.init();
                return;
            }

            const defaultDueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            item.borrowedBy.push({
                name: request.name,
                roll: request.roll,
                qty: request.qty,
                purpose: request.purpose,
                date: new Date().toISOString().split('T')[0],
                dueDate: request.dueDate || defaultDueDate
            });

            DatabaseManager.addLog('approve', `<span>${request.name}</span>'s request for <span>${request.itemName}</span> was approved by admin.`);
            request.status = 'APPROVED';
        } else {
            DatabaseManager.addLog('reject', `<span>${request.name}</span>'s request for <span>${request.itemName}</span> was rejected by admin.`);
            request.status = 'REJECTED';
        }

        request.reviewedAt = new Date().toISOString();
        request.reviewedBy = localStorage.getItem('cicr_auth') || 'ADMIN';
        DatabaseManager.save();
        this.renderRequests();
        this.renderLogsDrawer();
        if (selectedItem && selectedItem.id === request.itemId) {
            this.openDetailModal(selectedItem);
        }
        window.dashboard?.init();
        lucide.createIcons();
    }

    static openAboutModal() {
        this.open('about-modal');
    }

    static openDetailModal(item: InventoryItem) {
        setSelectedItem(item);

        const borrowedSum = (item.borrowedBy || [])
            .filter((r: any) => !r.returned && (r as any).status !== 'RETURNED' && (r as any).status !== 'REJECTED')
            .reduce((sum, rec) => sum + rec.qty, 0);
        const totalQty = Number(item.quantity) || 0;
        const available = typeof item.availableQuantity === 'number'
            ? Math.min(totalQty, Math.max(0, item.availableQuantity))
            : Math.max(0, totalQty - borrowedSum);

        document.getElementById('detail-name')!.innerText = item.name;
        document.getElementById('detail-location')!.innerText = item.location;
        document.getElementById('detail-specs')!.innerText = item.specs;
        const role = this.getCurrentRole();
        const detailQtyEl = document.getElementById('detail-quantity');
        if (detailQtyEl) {
            detailQtyEl.innerHTML = `<strong>${available}</strong> / ${totalQty} available`;
        }

        const catMap: Record<string, string> = {
            microcontrollers: "Microcontroller / Development Board",
            sensors: "Sensor & Module",
            actuators: "Actuator & Driver",
            power: "Power & Battery Storage",
            tools: "Lab Equipment / Tool"
        };
        document.getElementById('detail-category')!.innerText = catMap[item.category] || item.category;

        const badge = document.getElementById('detail-status')!;
        badge.className = 'modal-status-badge';

        const returnBtn = document.getElementById('btn-return') as HTMLButtonElement;

        const status = getItemStockStatus(totalQty, available);
        badge.innerText = status.text;
        badge.className = `modal-status-badge ${status.class}`;

        const totalBorrowedUnits = Math.max(0, totalQty - available);
        let cleanBorrowList = totalBorrowedUnits > 0
            ? (item.borrowedBy || []).filter(rec => !rec.returned && (rec as any).status !== 'RETURNED' && (rec as any).status !== 'REJECTED')
            : [];

        let myLoans = cleanBorrowList.filter(rec => (rec as any).status !== 'PENDING' && ModalManager.isUserLoanMatch(rec));
        
        // Fallback: If not found in item.borrowedBy, check ProfileViewManager.cachedHistory
        if (myLoans.length === 0 && totalBorrowedUnits > 0 && typeof ProfileViewManager !== 'undefined' && Array.isArray(ProfileViewManager.cachedHistory)) {
            const histMatches = ProfileViewManager.cachedHistory.filter((h: any) =>
                String(h.inventory_id || h.inventory?.id) === String(item.id) &&
                (h.status === 'BORROWED' || h.status === 'RETURN_REQUESTED')
            );
            if (histMatches.length > 0) {
                if (!item.borrowedBy) item.borrowedBy = [];
                for (const h of histMatches) {
                    if (!item.borrowedBy.some(b => b.id === h.id)) {
                        item.borrowedBy.push({
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
                        });
                    }
                }
                cleanBorrowList = totalBorrowedUnits > 0
                    ? (item.borrowedBy || []).filter(rec => !rec.returned && (rec as any).status !== 'RETURNED' && (rec as any).status !== 'REJECTED')
                    : [];
                myLoans = cleanBorrowList.filter(rec => (rec as any).status !== 'PENDING' && ModalManager.isUserLoanMatch(rec));
            }
        }

        const myActiveLoan = myLoans.find(r => (r as any).status !== 'RETURN_REQUESTED') || myLoans[0];
        const anyActiveLoan = cleanBorrowList.find(rec => (rec as any).status !== 'PENDING');
        const targetLoan = totalBorrowedUnits > 0 ? (myActiveLoan || (role === 'ADMIN' ? anyActiveLoan : null)) : null;

        // Display Return Issued Component button
        if (targetLoan) {
            const isPendingReturn = (targetLoan as any).status === 'RETURN_REQUESTED';
            returnBtn.style.display = 'inline-flex';
            if (isPendingReturn && role !== 'ADMIN') {
                returnBtn.disabled = true;
                returnBtn.style.opacity = '0.75';
                returnBtn.style.cursor = 'not-allowed';
                returnBtn.innerHTML = '<i data-lucide="clock"></i> Return Pending Admin Verification';
                returnBtn.onclick = null;
            } else {
                returnBtn.disabled = false;
                returnBtn.style.opacity = '1';
                returnBtn.style.cursor = 'pointer';
                returnBtn.innerHTML = role === 'ADMIN'
                    ? '<i data-lucide="corner-up-left"></i> Restock & Return'
                    : '<i data-lucide="corner-up-left"></i> Return Component';
                returnBtn.onclick = () => {
                    const loanIdx = item.borrowedBy ? item.borrowedBy.indexOf(targetLoan) : 0;
                    this.openReturnModal(targetLoan, item, loanIdx >= 0 ? loanIdx : 0);
                };
            }
        } else {
            returnBtn.style.display = 'none';
        }

        const directIssueBtn = document.getElementById('btn-modal-direct-issue') as HTMLButtonElement | null;
        if (directIssueBtn) {
            if (role === 'ADMIN' && available > 0) {
                directIssueBtn.style.display = 'inline-flex';
                renderLucideIcons(directIssueBtn);
                directIssueBtn.onclick = () => {
                    this.close('detail-modal');
                    this.openBorrowFormModal();
                };
            } else {
                directIssueBtn.style.display = 'none';
                directIssueBtn.onclick = null;
            }
        }

        const bulkReturnBtn = document.getElementById('btn-modal-bulk-return') as HTMLButtonElement | null;
        if (bulkReturnBtn) {
            let hasActiveLoans = false;
            for (const it of inventory) {
                if ((it.borrowedBy || []).some(r => !r.returned && (r as any).status !== 'RETURN_REQUESTED' && ModalManager.isUserLoanMatch(r))) {
                    hasActiveLoans = true;
                    break;
                }
            }
            if (hasActiveLoans) {
                bulkReturnBtn.style.display = 'inline-flex';
                bulkReturnBtn.onclick = () => {
                    this.closeAll();
                    this.openBulkReturnModal();
                };
            } else {
                bulkReturnBtn.style.display = 'none';
            }
        }

        const deleteItemBtn = document.getElementById('btn-modal-delete-item') as HTMLButtonElement;
        if (deleteItemBtn) {
            deleteItemBtn.style.display = role === 'ADMIN' ? 'inline-flex' : 'none';
            deleteItemBtn.onclick = () => {
                ModalManager.closeAll();
                AdminManager.promptDeleteItem(item.id, item.name);
            };
        }

        const modalCartBtn = document.getElementById('btn-modal-add-cart') as HTMLButtonElement | null;
        if (modalCartBtn) {
            if (available > 0) {
                modalCartBtn.disabled = false;
                modalCartBtn.style.opacity = '1';
                modalCartBtn.style.cursor = 'pointer';
                const inCart = typeof CartManager !== 'undefined' && CartManager.hasItem(item.id);
                const cartQty = typeof CartManager !== 'undefined' ? CartManager.getItemQty(item.id) : 0;
                if (inCart) {
                    modalCartBtn.classList.add('in-cart');
                    modalCartBtn.innerHTML = `<i data-lucide="check"></i> In Cart (${cartQty}) &bull; View Cart`;
                    modalCartBtn.onclick = () => {
                        this.closeAll();
                        if (typeof CartManager !== 'undefined') {
                            CartManager.openCart();
                        }
                    };
                } else {
                    modalCartBtn.classList.remove('in-cart');
                    modalCartBtn.innerHTML = `<i data-lucide="shopping-bag"></i> Add to Request Cart`;
                    modalCartBtn.onclick = () => {
                        if (typeof CartManager !== 'undefined') {
                            CartManager.addItem(item);
                            const updatedQty = CartManager.getItemQty(item.id);
                            modalCartBtn.classList.add('in-cart');
                            modalCartBtn.innerHTML = `<i data-lucide="check"></i> In Cart (${updatedQty}) &bull; View Cart`;
                            modalCartBtn.onclick = () => {
                                this.closeAll();
                                CartManager.openCart();
                            };
                            renderLucideIcons(modalCartBtn);
                        }
                    };
                }
            } else {
                modalCartBtn.disabled = true;
                modalCartBtn.style.opacity = '0.5';
                modalCartBtn.style.cursor = 'not-allowed';
                modalCartBtn.classList.remove('in-cart');
                modalCartBtn.innerHTML = `<i data-lucide="ban"></i> Out of Stock`;
                modalCartBtn.onclick = null;
            }
            renderLucideIcons(modalCartBtn);
        }

        const borrowersPanel = document.getElementById('borrowers-panel')!;
        const listContainer = document.getElementById('borrowers-list')!;
        listContainer.innerHTML = '';

        const isMember = role !== 'ADMIN';
        const visibleBorrowers = totalBorrowedUnits > 0
            ? (isMember ? cleanBorrowList.filter(rec => ModalManager.isUserLoanMatch(rec)) : cleanBorrowList)
            : [];

        if (visibleBorrowers.length > 0) {
            borrowersPanel.style.display = 'block';
            const todayStr = new Date().toISOString().split('T')[0];

            visibleBorrowers.forEach((rec) => {
                const origIdx = (item.borrowedBy || []).indexOf(rec);
                let due = rec.dueDate;
                if (!due && rec.date) {
                    const bTime = new Date(rec.date).getTime();
                    if (!isNaN(bTime)) {
                        due = new Date(bTime + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                    }
                }
                const isOverdue = Boolean(due && due < todayStr);
                const dueBadge = due ? `<span class="borrower-due-badge ${isOverdue ? 'overdue' : ''}">${isOverdue ? 'OVERDUE: ' : 'Due: '}${due}</span>` : '';

                const isMyRecord = ModalManager.isUserLoanMatch(rec);
                const canReturn = isMyRecord || role === 'ADMIN';
                const isRecPendingReturn = (rec as any).status === 'RETURN_REQUESTED';
                const statusBadge = isRecPendingReturn
                    ? `<span class="borrower-due-badge" style="background:rgba(255,183,3,0.15);color:#ffb703;border:1px solid rgba(255,183,3,0.3);"><i data-lucide="clock" style="width:11px;height:11px;vertical-align:middle;"></i> Awaiting Verification</span>`
                    : dueBadge;
                const returnBtnText = role === 'ADMIN' ? 'Restock' : 'Return';

                const recEl = document.createElement('div');
                recEl.className = 'borrower-record';
                recEl.innerHTML = `
                    <div class="borrower-info-main">
                        <span class="borrower-name">${escapeHtml(rec.name)} ${isMyRecord ? '(Your Active Loan)' : ''}</span>
                        <span class="borrower-roll">${escapeHtml(rec.roll)} &bull; ${escapeHtml(rec.purpose)}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        ${statusBadge}
                        <span class="borrower-qty-badge">${Number(rec.qty) || 1} units</span>
                        ${canReturn ? (
                        isRecPendingReturn && role !== 'ADMIN'
                            ? `<button class="btn btn-secondary" disabled style="padding: 6px 10px; font-size: 11px; opacity: 0.6; cursor: not-allowed;"><i data-lucide="clock" style="width:12px;height:12px;"></i> Verification Pending</button>`
                            : `<button class="btn btn-secondary btn-inline-return" style="padding: 6px 10px; font-size: 11px;"><i data-lucide="corner-up-left" style="width:12px;height:12px;"></i> ${returnBtnText}</button>`
                    ) : ''}
                    </div>
                `;

                if (canReturn && (!isRecPendingReturn || role === 'ADMIN')) {
                    recEl.querySelector('.btn-inline-return')?.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.openReturnModal(rec, item, origIdx >= 0 ? origIdx : 0);
                    });
                }

                listContainer.appendChild(recEl);
            });
        } else {
            borrowersPanel.style.display = 'none';
        }

        this.open('detail-modal');
        lucide.createIcons();
    }

    static openBorrowFormModal() {
        if (!selectedItem) return;

        const role = this.getCurrentRole();
        const isAdmin = role === 'ADMIN';

        if (!isAdmin) {
            if (typeof CartManager !== 'undefined') {
                CartManager.addItem(selectedItem);
                this.closeAll();
                CartManager.openCart();
                return;
            }
        }

        const borrowedSum = (selectedItem.borrowedBy || [])
            .filter((r: any) => !r.returned && (r as any).status !== 'RETURNED' && (r as any).status !== 'REJECTED')
            .reduce((sum, rec) => sum + rec.qty, 0);
        const available = typeof selectedItem.availableQuantity === 'number'
            ? selectedItem.availableQuantity
            : Math.max(0, selectedItem.quantity - borrowedSum);

        this.setBorrowModalMode(isAdmin ? 'borrow' : 'request', selectedItem.name, available);

        const nameInput = document.getElementById('borrow-name') as HTMLInputElement | null;
        const rollInput = document.getElementById('borrow-roll') as HTMLInputElement | null;

        if (isAdmin) {
            if (nameInput) {
                nameInput.value = '';
                nameInput.defaultValue = '';
                nameInput.readOnly = false;
                nameInput.removeAttribute('tabindex');
                nameInput.placeholder = 'Student / Borrower full name';
                nameInput.title = 'Enter the recipient student or borrower name';
            }
            if (rollInput) {
                rollInput.value = '';
                rollInput.defaultValue = '';
                rollInput.readOnly = false;
                rollInput.removeAttribute('tabindex');
                rollInput.placeholder = 'Student Enrollment / Roll No.';
                rollInput.title = 'Enter the student enrollment ID';
            }
            const purposeInput = document.getElementById('borrow-purpose') as HTMLInputElement | null;
            if (purposeInput) {
                purposeInput.value = '';
            }
        } else {
            // Auto-fill logged-in borrower details
            let currentUserName = '';
            let currentUserRoll = '';
            try {
                const userStr = localStorage.getItem('cicr_user');
                if (userStr) {
                    const parsed = JSON.parse(userStr);
                    currentUserName = parsed.name || parsed.username || '';
                    currentUserRoll = parsed.roll_number || parsed.roll || '';
                    if (!currentUserRoll && parsed.email) {
                        const match = String(parsed.email).match(/^([0-9]{6,12})@/);
                        if (match) currentUserRoll = match[1];
                    }
                }
            } catch { }

            if (!currentUserName) {
                currentUserName = localStorage.getItem('cicr_auth') || '';
            }

            if (!currentUserName) {
                const profileDisplay = document.getElementById('profile-username-display');
                if (profileDisplay && profileDisplay.innerText.trim()) {
                    currentUserName = profileDisplay.innerText.trim();
                }
            }

            if (!currentUserRoll && currentUserName) {
                const match = currentUserName.match(/^([0-9]{6,12})$/);
                if (match) currentUserRoll = match[1];
            }

            if (nameInput) {
                nameInput.value = currentUserName || '';
                nameInput.defaultValue = currentUserName || '';
                nameInput.readOnly = true;
                nameInput.setAttribute('tabindex', '-1');
                nameInput.title = 'Verified account identity (locked)';
            }

            if (rollInput) {
                rollInput.value = currentUserRoll || '';
                rollInput.defaultValue = currentUserRoll || '';
                if (currentUserRoll) {
                    rollInput.readOnly = true;
                    rollInput.setAttribute('tabindex', '-1');
                    rollInput.title = 'Verified student enrollment ID (locked)';
                } else {
                    rollInput.readOnly = false;
                    rollInput.removeAttribute('tabindex');
                    rollInput.title = 'Enter your enrollment ID';
                }
            }
        }

        const qtyInput = document.getElementById('borrow-qty') as HTMLInputElement;
        qtyInput.max = String(available);
        qtyInput.value = '1';

        const dueDateInput = document.getElementById('borrow-due-date') as HTMLInputElement | null;
        if (dueDateInput) {
            const today = new Date().toISOString().split('T')[0];
            const defaultDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            dueDateInput.min = today;
            dueDateInput.value = defaultDue;
            const durationBadge = document.getElementById('borrow-duration-badge');
            if (durationBadge) {
                durationBadge.textContent = '7 Days Loan';
                durationBadge.className = 'form-label-badge badge-cyan';
            }
            document.querySelectorAll('.date-preset-pill').forEach(pill => {
                pill.classList.toggle('active', (pill as HTMLElement).dataset.days === '7');
            });
        }

        this.close('detail-modal');
        this.open('borrow-form-modal');
        lucide.createIcons();
    }

    static activeNotifTab: string = 'issues';

    static openLogsDrawer() {
        if (typeof HardwareLedgerManager !== 'undefined' && typeof HardwareLedgerManager.fetchLedger === 'function') {
            HardwareLedgerManager.fetchLedger(true).then(() => {
                ModalManager.renderLogsDrawer();
            }).catch(() => {});
        }
        if (typeof AdminManager !== 'undefined' && typeof AdminManager.loadHardwareRequests === 'function') {
            AdminManager.loadHardwareRequests(true).then(() => {
                ModalManager.renderLogsDrawer();
            }).catch(() => {});
        }
        this.renderLogsDrawer();
        this.open('logs-drawer');
        lucide.createIcons();
    }

    static renderLogsDrawer() {
        const logsList = document.getElementById('logs-list');
        if (!logsList) return;

        const role = this.getCurrentRole();
        const isAdmin = role === 'ADMIN';

        const storedUser = readCurrentUser();
        const isUserRequest = (req: any): boolean => ModalManager.isUserRequestMatch(req);

        // Update Header Badge, Title, and Subtitle
        const roleBadgeEl = document.getElementById('notif-drawer-role-badge');
        const roleDotEl = document.getElementById('notif-role-dot');
        const roleTextEl = document.getElementById('notif-role-text');
        const subtitleEl = document.getElementById('notif-drawer-subtitle');
        const titleEl = document.getElementById('notif-drawer-title');

        if (isAdmin) {
            if (titleEl) titleEl.innerText = 'User Component Requests';
            if (roleBadgeEl) {
                roleBadgeEl.classList.remove('role-badge-member');
                roleBadgeEl.classList.add('role-badge-admin');
            }
            if (roleDotEl) {
                roleDotEl.classList.remove('dot-member');
                roleDotEl.classList.add('dot-admin');
            }
            if (roleTextEl) roleTextEl.innerText = 'ADMIN AUDIT';
            if (subtitleEl) subtitleEl.innerText = 'Track pending, accepted & rejected component requests';
        } else {
            const memberName = storedUser.name ? storedUser.name.split(' ')[0] + "'s" : 'My';
            if (titleEl) titleEl.innerText = `${memberName} Requests & Status`;
            if (roleBadgeEl) {
                roleBadgeEl.classList.remove('role-badge-admin');
                roleBadgeEl.classList.add('role-badge-member');
            }
            if (roleDotEl) {
                roleDotEl.classList.remove('dot-admin');
                roleDotEl.classList.add('dot-member');
            }
            if (roleTextEl) roleTextEl.innerText = 'MEMBER ACCESS';
            if (subtitleEl) subtitleEl.innerText = 'Track pending, accepted & rejected component requests';
        }

        // Segmented Category Tabs: Exclusively Pending, Accepted, and Rejected
        const tabPending = document.getElementById('notif-tab-pending');
        const tabApproved = document.getElementById('notif-tab-approved');
        const tabRejected = document.getElementById('notif-tab-rejected');

        if (tabPending) tabPending.style.display = 'inline-flex';
        if (tabApproved) tabApproved.style.display = 'inline-flex';
        if (tabRejected) tabRejected.style.display = 'inline-flex';

        // Hide obsolete tabs
        ['notif-tab-issues', 'notif-tab-requests', 'notif-tab-returns', 'notif-tab-stock', 'notif-tab-system'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Setup tab click listeners once
        const tabsBar = document.getElementById('notif-tabs-bar');
        if (tabsBar && !tabsBar.dataset.bound) {
            tabsBar.dataset.bound = 'true';
            tabsBar.querySelectorAll<HTMLButtonElement>('.notif-tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const cat = btn.getAttribute('data-category') || 'pending';
                    ModalManager.activeNotifTab = cat;
                    ModalManager.renderLogsDrawer();
                    lucide.createIcons();
                });
            });
        }

        // --- GATHER REQUESTS DATA ---
        const requestMap = new Map<string, any>();
        const idToKeyMap = new Map<string, string>();

        const getDrawerKey = (r: any): string => {
            if (typeof AdminManager !== 'undefined' && typeof AdminManager.getRequestCanonicalKey === 'function') {
                return AdminManager.getRequestCanonicalKey(r);
            }
            const isReturn = r.type === 'RETURN' || Boolean(r.borrowId);
            if (isReturn) return `ret__${(r.borrowId || r.id || '').trim().toLowerCase()}`;
            const email = (r.borrowerEmail || r.email || '').toLowerCase().trim();
            const name = (r.borrowerName || r.name || '').toLowerCase().trim();
            const roll = (r.rollNumber || r.roll || '').toLowerCase().trim();
            const itemId = (r.itemId || r.itemName || '').toLowerCase().trim();
            const qty = Number(r.quantity || r.qty) || 1;
            const purp = (r.purpose || '').toLowerCase().trim();
            const borrower = roll || email || name;
            return `iss__${borrower}__${itemId}__${qty}__${purp}`;
        };

        const handledIds = typeof AdminManager !== 'undefined' ? AdminManager.getHandledRequestIds() : new Set<string>();

        const isDrawerItemDismissed = (r: any): boolean => {
            if (!r) return true;
            if (r.status !== 'PENDING') return false;
            if (handledIds.has(r.id)) return true;
            if (r.borrowId && handledIds.has(r.borrowId)) return true;
            const key = getDrawerKey(r);
            if (key && handledIds.has(key)) return true;
            return false;
        };

        const addOrMergeDrawerRequest = (r: any) => {
            if (!r) return;
            const status = (r.status || 'PENDING').toUpperCase();
            if (status === 'PENDING' && isDrawerItemDismissed(r)) {
                return;
            }

            const key = getDrawerKey(r) || String(r.id || Math.random());
            const reqId = r.id ? String(r.id) : '';
            const borrowId = r.borrowId ? String(r.borrowId) : '';

            // Find existing request entry if any
            let existingKey: string | null = null;
            if (requestMap.has(key)) {
                existingKey = key;
            } else if (reqId && idToKeyMap.has(reqId)) {
                existingKey = idToKeyMap.get(reqId)!;
            } else if (borrowId && idToKeyMap.has(borrowId)) {
                existingKey = idToKeyMap.get(borrowId)!;
            }

            if (existingKey && requestMap.has(existingKey)) {
                const existing = requestMap.get(existingKey);
                const existingStatus = (existing.status || 'PENDING').toUpperCase();

                // If existing is PENDING and incoming is APPROVED or REJECTED:
                // Incoming replaces existing completely! (Pending is removed!)
                if (existingStatus === 'PENDING' && (status === 'APPROVED' || status === 'REJECTED')) {
                    requestMap.set(existingKey, r);
                    if (reqId) idToKeyMap.set(reqId, existingKey);
                    if (borrowId) idToKeyMap.set(borrowId, existingKey);
                    return;
                }

                // If existing is APPROVED or REJECTED, incoming PENDING is discarded!
                if ((existingStatus === 'APPROVED' || existingStatus === 'REJECTED') && status === 'PENDING') {
                    return;
                }

                // If same status, keep the richer record
                if (status === existingStatus) {
                    if (!existing.reviewedBy && r.reviewedBy) {
                        requestMap.set(existingKey, { ...existing, ...r });
                    }
                    return;
                }
            }

            requestMap.set(key, r);
            if (reqId) idToKeyMap.set(reqId, key);
            if (borrowId) idToKeyMap.set(borrowId, key);
        };

        // 1. For non-admin, ONLY process their own requests from userHardwareRequests
        if (!isAdmin && typeof AdminManager !== 'undefined' && Array.isArray(AdminManager.userHardwareRequests)) {
            AdminManager.userHardwareRequests.forEach(r => {
                if (isUserRequest(r)) addOrMergeDrawerRequest(r);
            });
        }

        // 2. For admin, process full hardware queue across all members
        if (isAdmin && typeof AdminManager !== 'undefined' && Array.isArray(AdminManager.hardwareRequests)) {
            AdminManager.hardwareRequests.forEach(addOrMergeDrawerRequest);
        }

        // 3. Process requests state
        (requests || []).forEach(r => {
            if (isAdmin || isUserRequest(r)) addOrMergeDrawerRequest(r);
        });

        // 4. Connect historical & active checkout requests from backend Hardware Ledger
        if (typeof HardwareLedgerManager !== 'undefined' && typeof HardwareLedgerManager.getRecords === 'function') {
            const ledgerRecords = HardwareLedgerManager.getRecords();
            if (Array.isArray(ledgerRecords)) {
                ledgerRecords.forEach((rec: any) => {
                    if (!rec) return;
                    if (!isAdmin && !isUserRequest(rec)) return; // Strictly ignore other members' ledger entries!

                    const isRet = rec.action_type === 'RETURNED' || Boolean(rec.return_date) || rec.status === 'RETURNED';
                    const isPend = rec.action_type === 'PENDING_APPROVAL' || rec.status === 'PENDING';
                    const statusVal: 'PENDING' | 'APPROVED' | 'REJECTED' = isPend ? 'PENDING' : (rec.status === 'REJECTED' ? 'REJECTED' : 'APPROVED');

                    const mappedReq: any = {
                        id: rec.id,
                        type: isRet ? 'RETURN' : 'ISSUE',
                        borrowId: isRet ? rec.id : undefined,
                        returnQuantity: isRet ? rec.quantity : undefined,
                        itemId: rec.component_id,
                        itemName: rec.component_name,
                        category: rec.category,
                        borrowerName: rec.borrower_name,
                        borrowerEmail: rec.borrower_email,
                        rollNumber: rec.borrower_roll,
                        quantity: rec.quantity,
                        purpose: rec.purpose || (isRet ? 'Return of hardware' : 'Hardware Issue'),
                        dueDate: rec.due_date,
                        status: statusVal,
                        requestedAt: rec.date || new Date().toISOString(),
                        reviewedAt: rec.return_date || rec.date,
                        reviewedBy: rec.admin_approved_by || rec.reviewed_by || 'Lab Administrator'
                    };

                    addOrMergeDrawerRequest(mappedReq);
                });
            }
        }

        const combinedRequests: (RequestRecord | AdminHardwareRequest)[] = Array.from(requestMap.values());

        const isReturnReqRecord = (r: any): boolean => {
            if (r.type === 'RETURN') return true;
            if (Boolean(r.borrowId)) return true;
            const p = (r.purpose || '').toLowerCase();
            return p.startsWith('return ') || p.includes('return of');
        };

        const visibleRequests: any[] = isAdmin
            ? combinedRequests
            : combinedRequests.filter(r => isUserRequest(r));
        visibleRequests.sort((a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime());

        const pendingRequests = visibleRequests.filter(r => r.status === 'PENDING');
        const approvedRequests = visibleRequests.filter(r => r.status === 'APPROVED');
        const rejectedRequests = visibleRequests.filter(r => r.status === 'REJECTED');

        if (!['pending', 'approved', 'rejected'].includes(this.activeNotifTab)) {
            if (pendingRequests.length > 0) {
                this.activeNotifTab = 'pending';
            } else if (approvedRequests.length > 0) {
                this.activeNotifTab = 'approved';
            } else {
                this.activeNotifTab = 'pending';
            }
        }

        // --- UPDATE BADGE COUNTS ON TABS ---
        const countPending = document.getElementById('notif-count-pending');
        const countApproved = document.getElementById('notif-count-approved');
        const countRejected = document.getElementById('notif-count-rejected');

        if (countPending) countPending.innerText = String(pendingRequests.length);
        if (countApproved) countApproved.innerText = String(approvedRequests.length);
        if (countRejected) countRejected.innerText = String(rejectedRequests.length);

        // Highlight active tab button
        if (tabsBar) {
            tabsBar.querySelectorAll('.notif-tab-btn').forEach(btn => {
                const cat = btn.getAttribute('data-category');
                btn.classList.toggle('active', cat === this.activeNotifTab);
            });
        }

        // Synchronize sidebar and topbar badges as well
        DatabaseManager.updateNotificationBadges();

        // Card rendering helper
        const createRequestCard = (req: any, isReturnCard: boolean = false): HTMLElement => {
            const el = document.createElement('div');
            const status = (req.status || 'PENDING').toUpperCase();
            el.className = `notif-card card-request card-request-${status.toLowerCase()}`;

            let statusBadge = '';
            if (status === 'APPROVED') {
                statusBadge = isReturnCard
                    ? `<span class="notif-status-badge badge-cyan"><i data-lucide="shield-check"></i> RETURN ACCEPTED</span>`
                    : `<span class="notif-status-badge badge-green"><i data-lucide="check-circle-2"></i> ACCEPTED & ISSUED</span>`;
            } else if (status === 'REJECTED') {
                statusBadge = `<span class="notif-status-badge badge-red"><i data-lucide="x-circle"></i> DECLINED</span>`;
            } else {
                statusBadge = `<span class="notif-status-badge badge-yellow"><i data-lucide="clock"></i> PENDING APPROVAL</span>`;
            }

            const actionsHtml = (isAdmin && status === 'PENDING') ? `
                <div class="notif-card-actions">
                    <button class="notif-action-btn notif-btn-approve" data-req-id="${req.id}" data-is-return="${isReturnCard ? 'true' : 'false'}">
                        <i data-lucide="check"></i> Approve
                    </button>
                    <button class="notif-action-btn notif-btn-reject" data-req-id="${req.id}">
                        <i data-lucide="x"></i> Reject
                    </button>
                </div>
            ` : '';

            const bName = req.borrowerName || req.name || 'Member';
            const bRoll = req.rollNumber || req.roll || 'Student';
            const bQty = Number(req.quantity || req.qty || req.returnQuantity) || 1;
            const tagIcon = isReturnCard ? 'rotate-ccw' : (status === 'APPROVED' ? 'check-circle' : (status === 'REJECTED' ? 'x-circle' : 'send'));
            const tagColor = isReturnCard ? 'tag-cyan' : (status === 'APPROVED' ? 'tag-green' : (status === 'REJECTED' ? 'tag-red' : 'tag-purple'));
            const tagTitle = isReturnCard ? 'RETURN REQUEST' : (status === 'APPROVED' ? 'HARDWARE ISSUED' : (status === 'REJECTED' ? 'REQUEST DECLINED' : 'ISSUE REQUEST'));

            const reviewer = req.reviewedBy || req.admin_approved_by || req.reviewer || 'Administrator';
            const reviewNote = req.reviewNote || req.reason || '';

            const origQty = Number(req.originalQuantity) || 0;
            const isQueueAdjusted = origQty > 0 && origQty > bQty;
            const queueBadge = isQueueAdjusted
                ? `<span class="notif-status-badge badge-yellow" style="font-size:10px; margin-left:6px;" title="Requested: ${origQty}x | Queue Allocated: ${bQty}x"><i data-lucide="info"></i> Queue: ${bQty}/${origQty} Allocated</span>`
                : '';

            const canReturnIssued = !isReturnCard && status === 'APPROVED' && (isAdmin || isUserRequest(req));
            const returnIssuedActionHtml = canReturnIssued ? `
                <div class="notif-card-actions" style="margin-top:8px;">
                    <button type="button" class="notif-action-btn notif-btn-return-issued" data-item-id="${req.itemId}" data-borrow-id="${req.borrowId || req.id}" data-qty="${bQty}" data-req-id="${req.id}" style="background:rgba(99, 102, 241, 0.15); border:1px solid rgba(99, 102, 241, 0.35); color:#a5b4fc; font-weight:600; cursor:pointer;">
                        <i data-lucide="corner-up-left"></i> Return Hardware
                    </button>
                </div>
            ` : '';

            el.innerHTML = `
                <div class="notif-card-header">
                    <div class="notif-card-tag ${tagColor}">
                        <i data-lucide="${tagIcon}"></i>
                        <span>${tagTitle}</span>
                    </div>
                    ${statusBadge}
                    ${queueBadge}
                </div>
                <div class="notif-card-body">
                    <p class="notif-card-main-text">
                        <strong>${bQty}x ${escapeHtml(req.itemName)}</strong> ${isReturnCard ? 'return requested by' : (status === 'APPROVED' ? 'approved & issued to' : (status === 'REJECTED' ? 'request from' : 'requested by'))} <span class="notif-user-pill">${escapeHtml(bName)}</span> (${escapeHtml(bRoll)})
                    </p>
                    <p class="notif-card-sub-text">
                        Purpose: ${escapeHtml(req.purpose || (isReturnCard ? 'Return of hardware' : 'Lab Project'))} &bull; Requested: ${req.requestedAt ? new Date(req.requestedAt).toLocaleDateString() : 'Recent'}
                        ${req.dueDate ? ` &bull; Due Date: <strong>${escapeHtml(req.dueDate)}</strong>` : ''}
                    </p>
                    ${status === 'APPROVED' ? `
                        <div class="card-request-admin-note note-approved">
                            <i data-lucide="shield-check" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:4px;"></i>
                            Approved by: <strong>${escapeHtml(reviewer)}</strong>${req.reviewedAt ? ` &bull; on ${new Date(req.reviewedAt).toLocaleDateString()}` : ''}
                        </div>
                    ` : ''}
                    ${status === 'REJECTED' ? `
                        <div class="card-request-admin-note">
                            <i data-lucide="alert-circle" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:4px;"></i>
                            Declined by: <strong>${escapeHtml(reviewer)}</strong>${req.reviewedAt ? ` &bull; on ${new Date(req.reviewedAt).toLocaleDateString()}` : ''}
                            ${reviewNote ? `<br>Reason: "${escapeHtml(reviewNote)}"` : ''}
                        </div>
                    ` : ''}
                    ${status === 'PENDING' ? `
                        <div class="card-request-admin-note" style="background:rgba(245,158,11,0.1); border-color:rgba(245,158,11,0.25); color:#fcd34d;">Awaiting Admin Approval. You will be notified via email when reviewed.</div>
                    ` : ''}
                </div>
                ${actionsHtml}
                ${returnIssuedActionHtml}
            `;

            return el;
        };

        const bindAdminCardActions = (container: HTMLElement) => {
            if (!isAdmin) return;
            container.querySelectorAll<HTMLButtonElement>('.notif-btn-approve').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const reqId = btn.getAttribute('data-req-id');
                    if (reqId) {
                        btn.disabled = true;
                        if (typeof AdminManager !== 'undefined' && typeof AdminManager.approveHardware === 'function') {
                            await AdminManager.approveHardware(reqId);
                        } else {
                            ModalManager.reviewRequest(reqId, 'APPROVED');
                        }
                        DatabaseManager.isNotificationsCleared = false;
                        DatabaseManager.updateNotificationBadges();
                        ModalManager.renderLogsDrawer();
                    }
                });
            });
            container.querySelectorAll<HTMLButtonElement>('.notif-btn-reject').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const reqId = btn.getAttribute('data-req-id');
                    if (reqId) {
                        btn.disabled = true;
                        if (typeof AdminManager !== 'undefined' && typeof AdminManager.rejectHardware === 'function') {
                            await AdminManager.rejectHardware(reqId);
                        } else {
                            ModalManager.reviewRequest(reqId, 'REJECTED');
                        }
                        DatabaseManager.isNotificationsCleared = false;
                        DatabaseManager.updateNotificationBadges();
                        ModalManager.renderLogsDrawer();
                    }
                });
            });
        };

        // --- RENDER CONTENT BASED ON ACTIVE TAB ---
        logsList.innerHTML = '';
        const currentCategory = this.activeNotifTab;

        if (currentCategory === 'approved') {
            if (approvedRequests.length === 0) {
                logsList.insertAdjacentHTML('beforeend', notifEmptyCardHtml('check-circle-2', 'No Accepted Requests', 'No component requests have been accepted yet.'));
            } else {
                approvedRequests.forEach(req => logsList.appendChild(createRequestCard(req, isReturnReqRecord(req))));
            }
        } else if (currentCategory === 'rejected') {
            if (rejectedRequests.length === 0) {
                logsList.insertAdjacentHTML('beforeend', notifEmptyCardHtml('shield-alert', 'No Declined Requests', 'No component requests have been declined.'));
            } else {
                rejectedRequests.forEach(req => logsList.appendChild(createRequestCard(req, isReturnReqRecord(req))));
            }
        } else {
            // Default to pending
            if (pendingRequests.length === 0) {
                logsList.insertAdjacentHTML('beforeend', notifEmptyCardHtml('clock', 'No Pending Requests', 'No component requests currently awaiting admin review.'));
            } else {
                pendingRequests.forEach(req => logsList.appendChild(createRequestCard(req, isReturnReqRecord(req))));
                bindAdminCardActions(logsList);
            }
        }

        // Attach Return Hardware button listeners for any approved cards
        logsList.querySelectorAll<HTMLButtonElement>('.notif-btn-return-issued').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = btn.dataset.itemId;
                const borrowId = btn.dataset.borrowId;
                const qty = parseInt(btn.dataset.qty || '1', 10);
                const reqId = btn.dataset.reqId;

                const targetItem = inventory.find(i => String(i.id) === String(itemId)) || {
                    id: itemId || '',
                    name: 'Hardware Component',
                    category: 'tools',
                    quantity: 1,
                    availableQuantity: 0,
                    location: 'Lab',
                    specs: '',
                    image: '',
                    tags: [],
                    borrowedBy: []
                };

                const matchingLoan: BorrowRecord = (targetItem.borrowedBy || []).find((b: any) =>
                    (borrowId && (b.id === borrowId || b._id === borrowId)) ||
                    ModalManager.isUserLoanMatch(b)
                ) || {
                    id: borrowId || reqId || `loan-${Date.now()}`,
                    name: localStorage.getItem('cicr_auth') || 'Member',
                    roll: '',
                    qty: qty,
                    purpose: 'Active Loan',
                    date: new Date().toISOString()
                };

                ModalManager.openReturnModal(matchingLoan, targetItem as any, 0);
            });
        });
    }

    private static async handleAddItemSubmit() {
        if (this.getCurrentRole() !== 'ADMIN') {
            ToastManager.show('Admin Access Required', 'Only administrators can add new components to the vault.', 'warning');
            return;
        }

        const name = (document.getElementById('item-name') as HTMLInputElement).value.trim();
        const category = (document.getElementById('item-category') as HTMLSelectElement).value;
        const qty = parseInt((document.getElementById('item-qty') as HTMLInputElement).value);
        const location = (document.getElementById('item-location') as HTMLInputElement).value.trim();
        const specs = (document.getElementById('item-specs') as HTMLTextAreaElement).value.trim() || "No specifications provided.";
        const rawTags = (document.getElementById('item-tags') as HTMLInputElement)?.value || '';
        const tags = rawTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

        if (!name || !category || isNaN(qty) || !location) {
            ToastManager.show('Missing Fields', 'Please complete all required fields.', 'warning');
            return;
        }

        if (qty <= 0) {
            ToastManager.show('Invalid Quantity', 'Total quantity must be at least 1.', 'warning');
            return;
        }

        const MAX_QUANTITY_LIMIT = 500;
        if (qty > MAX_QUANTITY_LIMIT) {
            ToastManager.show('Quantity Exceeds Limit', `Maximum quantity per component entry is capped at ${MAX_QUANTITY_LIMIT} units.`, 'warning');
            return;
        }

        const submitBtn = document.getElementById('btn-add-submit') as HTMLButtonElement;
        const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span>Vaulting Component...</span>`;
        }

        const catMap: Record<string, string> = {
            microcontrollers: 'Controllers',
            sensors: 'Sensors',
            actuators: 'Actuators',
            power: 'Power',
            tools: 'Tools'
        };
        const backendCategory = catMap[category] || 'Controllers';

        const token = localStorage.getItem('cicr_token');
        try {
            const res = await fetch(`${API_BASE}/items`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name,
                    category: backendCategory,
                    quantity: qty,
                    location,
                    description: specs,
                    tags
                })
            });

            if (res.ok) {
                (document.getElementById('add-item-form') as HTMLFormElement).reset();
                this.close('add-item-modal');
                ToastManager.show('Component Vaulted', `Added ${qty}x ${name} to ${location}. Telemetry alert sent to administrators.`, 'success');
                DatabaseManager.addLog('add', `Registered new component <span>${name}</span> (Qty: ${qty}) at <span>${location}</span>.`);
                await DatabaseManager.syncFromBackend();
                return;
            } else {
                const errJson = await res.json();
                ToastManager.show('Action Failed', errJson.message || 'Failed to add item to database.', 'error');
            }
        } catch (e) {
            console.error('Failed to create item in backend:', e);
            ToastManager.show('Connection Error', 'Failed to reach database backend.', 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
                lucide.createIcons();
            }
        }

        // Fallback local addition if offline
        const id = `${category.slice(0, 2)}-${Date.now().toString().slice(-4)}`;
        const newItem: InventoryItem = {
            id,
            name,
            category,
            quantity: qty,
            availableQuantity: qty,
            location,
            specs,
            tags,
            borrowedBy: []
        };
        inventory.unshift(newItem);
        DatabaseManager.addLog('add', `Registered new component <span>${name}</span> (Qty: ${qty}) at <span>${location}</span>.`);
        (document.getElementById('add-item-form') as HTMLFormElement).reset();
        this.close('add-item-modal');
        ToastManager.show('Component Saved', `Stored ${qty}x ${name} locally`, 'info');
        if (window.dashboard) {
            window.dashboard.init();
        }
    }

    private static isSubmittingBorrow = false;

    private static async handleBorrowSubmit() {
        if (!selectedItem || this.isSubmittingBorrow) return;

        const borrowerName = (document.getElementById('borrow-name') as HTMLInputElement).value.trim();
        const rollNum = (document.getElementById('borrow-roll') as HTMLInputElement).value.trim();
        const qty = parseInt((document.getElementById('borrow-qty') as HTMLInputElement).value);
        const purpose = (document.getElementById('borrow-purpose') as HTMLInputElement).value.trim();

        const borrowedSum = (selectedItem.borrowedBy || [])
            .filter((r: any) => !r.returned && (r as any).status !== 'RETURNED' && (r as any).status !== 'REJECTED')
            .reduce((sum, rec) => sum + rec.qty, 0);
        const available = typeof selectedItem.availableQuantity === 'number'
            ? selectedItem.availableQuantity
            : Math.max(0, selectedItem.quantity - borrowedSum);

        if (qty > available || qty <= 0 || isNaN(qty) || !borrowerName || !rollNum || !purpose) {
            ToastManager.show('Invalid Input', 'Please enter a valid borrow quantity within available limits.', 'warning');
            return;
        }

        const dueDateInput = document.getElementById('borrow-due-date') as HTMLInputElement | null;
        const defaultDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const dueDate = (dueDateInput && dueDateInput.value) ? dueDateInput.value : defaultDue;

        let durationDays = 7;
        if (dueDate) {
            const t0 = new Date();
            t0.setHours(0, 0, 0, 0);
            const t1 = new Date(dueDate);
            t1.setHours(0, 0, 0, 0);
            const diff = Math.round((t1.getTime() - t0.getTime()) / (1000 * 60 * 60 * 24));
            if (diff > 0) durationDays = diff;
        }

        const token = localStorage.getItem('cicr_token');
        if (!token) {
            ToastManager.show('Login Required', 'Please log in to submit a component issue request.', 'error');
            return;
        }

        const submitBtn = document.getElementById('borrow-form-submit') as HTMLButtonElement | null;
        this.isSubmittingBorrow = true;
        const isAdmin = this.getCurrentRole() === 'ADMIN';

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = isAdmin ? 'Issuing Hardware...' : 'Submitting Request...';
        }

        const storedUser = readCurrentUser();
        const userEmail = storedUser.email || (localStorage.getItem('cicr_auth')?.includes('@') ? localStorage.getItem('cicr_auth') : (storedUser.roll_number ? `${storedUser.roll_number}@mail.jiit.ac.in` : 'admin@cicr.lab'));
        const studentEmail = (rollNum && /^\d+$/.test(rollNum))
            ? `${rollNum}@mail.jiit.ac.in`
            : (rollNum?.includes('@') ? rollNum : userEmail);

        if (isAdmin) {
            // Direct issue directly into student custody via POST /api/borrow
            const directPayload = {
                inventory_id: selectedItem.id,
                itemId: selectedItem.id,
                borrower_name: borrowerName,
                roll_number: rollNum,
                borrower_email: studentEmail,
                quantity: qty,
                purpose: purpose,
                duration_days: durationDays,
                durationDays: durationDays,
                dueDate: dueDate,
                due_date: dueDate
            };

            try {
                const res = await fetch(`${API_BASE}/borrow`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(directPayload)
                });

                const resData = await res.json().catch(() => ({})) as any;
                if (!res.ok) {
                    ToastManager.show('Issue Failed', resData?.message || 'Could not issue component.', 'error');
                    return;
                }

                // Update local inventory available quantity immediately
                const newAvailable = typeof resData?.data?.newAvailableQty === 'number'
                    ? resData.data.newAvailableQty
                    : Math.max(0, (selectedItem.availableQuantity ?? selectedItem.quantity) - qty);
                selectedItem.availableQuantity = newAvailable;

                if (!selectedItem.borrowedBy) selectedItem.borrowedBy = [];
                const recordId = resData?.data?.borrowRecord?.id || `borrow-${Date.now()}`;
                selectedItem.borrowedBy.push({
                    id: recordId,
                    name: borrowerName,
                    userName: borrowerName,
                    borrowerName: borrowerName,
                    roll: rollNum,
                    userRoll: rollNum,
                    email: studentEmail,
                    userEmail: studentEmail,
                    qty: qty,
                    purpose: purpose,
                    date: new Date().toISOString(),
                    dueDate: dueDate,
                    status: 'BORROWED',
                    returned: false
                });

                (document.getElementById('borrow-form') as HTMLFormElement).reset();
                this.close('borrow-form-modal');

                ToastManager.show(
                    'Component Issued',
                    `Successfully issued ${qty}x ${selectedItem.name} to ${borrowerName} (${rollNum}).`,
                    'success'
                );
                DatabaseManager.addLog('borrow', `<span>[Admin]</span> issued ${qty}x <span>${selectedItem.name}</span> to <strong>${borrowerName}</strong> (${rollNum}).`);

                await DatabaseManager.syncFromBackend();
                if (window.dashboard) {
                    window.dashboard.renderInventory(true);
                    window.dashboard.renderStats();
                }
            } catch (err: any) {
                console.error('Direct borrow error:', err);
                ToastManager.show('Network Error', 'Failed to connect to backend.', 'error');
            } finally {
                this.isSubmittingBorrow = false;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerText = isAdmin ? 'Confirm & Issue Hardware' : 'Submit Issue Request';
                }
            }
            return;
        }

        // Route component checkout request to the Admin Portal Request Queue for regular member
        const date = new Date().toISOString().split('T')[0];
        const requestId = `req-${Date.now()}`;
        const newReq: RequestRecord = {
            id: requestId,
            itemId: selectedItem.id,
            itemName: selectedItem.name,
            name: borrowerName,
            roll: rollNum,
            qty: qty,
            purpose: purpose,
            status: 'PENDING',
            requestedAt: date,
            dueDate: dueDate
        };

        const requestPayload = {
            id: requestId,
            itemId: selectedItem.id,
            inventory_id: selectedItem.id,
            item_id: selectedItem.id,
            itemName: selectedItem.name,
            quantity: qty,
            purpose: purpose,
            duration_days: durationDays,
            durationDays: durationDays,
            dueDate: dueDate,
            due_date: dueDate,
            borrowerName: borrowerName,
            borrower_name: borrowerName,
            borrowerEmail: userEmail,
            borrower_email: userEmail,
            rollNumber: rollNum,
            roll_number: rollNum,
            status: 'PENDING'
        };

        try {
            const res = await fetch(`${API_BASE}/borrow/request`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(requestPayload)
            });

            const resData = await res.json().catch(() => ({})) as any;
            if (resData?.data?.id) {
                newReq.id = resData.data.id;
            }

            // Always keep in local requests store so it is instantly reflected on this client, deduplicating against any existing match
            setRequests(requests.filter(r => r.id !== newReq.id && !(r.status === 'PENDING' && r.itemId === newReq.itemId && r.qty === newReq.qty && r.purpose === newReq.purpose)));
            requests.unshift(newReq);
            DatabaseManager.save();

            (document.getElementById('borrow-form') as HTMLFormElement).reset();
            this.close('borrow-form-modal');

            ToastManager.show(
                'Request Transmitted',
                `Issue request for ${qty}x ${selectedItem.name} submitted for Admin authorization.`,
                'success'
            );
            DatabaseManager.addLog('borrow', `<span>${borrowerName}</span> requested ${qty}x <span>${selectedItem.name}</span> for '${purpose}'.`);
            AdminManager.loadHardwareRequests(true);
            DatabaseManager.updateNotificationBadges();
            await DatabaseManager.syncFromBackend();
        } catch (e: any) {
            console.error('Request API error:', e);
            // On offline/failover, save locally
            setRequests(requests.filter(r => r.id !== newReq.id && !(r.status === 'PENDING' && r.itemId === newReq.itemId && r.qty === newReq.qty && r.purpose === newReq.purpose)));
            requests.unshift(newReq);
            DatabaseManager.save();
            (document.getElementById('borrow-form') as HTMLFormElement).reset();
            this.close('borrow-form-modal');
            ToastManager.show(
                'Request Transmitted',
                `Issue request for ${qty}x ${selectedItem.name} queued for Admin authorization.`,
                'success'
            );
            DatabaseManager.addLog('borrow', `<span>${borrowerName}</span> requested ${qty}x <span>${selectedItem.name}</span> for '${purpose}'.`);
            AdminManager.loadHardwareRequests(true);
        } finally {
            this.isSubmittingBorrow = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = 'Submit Issue Request';
            }
        }
    }

    // Opens the return quantity selector. Admins directly restock items into vault inventory;
    // Members submit return requests for Admin verification.
    public static openReturnModal(rec: BorrowRecord, item: InventoryItem, origIdx: number) {
        setSelectedItem(item);
        const isAdmin = this.getCurrentRole() === 'ADMIN';

        if (!rec && item.borrowedBy && item.borrowedBy.length > 0) {
            rec = item.borrowedBy[0];
        }

        if (!rec) {
            ToastManager.show('No Active Loan', 'No active loan found for this component.', 'warning');
            return;
        }

        // Resolve borrowId if missing or unlinked
        let effectiveBorrowId = rec?.id;
        if (!effectiveBorrowId && typeof ProfileViewManager !== 'undefined' && Array.isArray(ProfileViewManager.cachedHistory)) {
            const match = ProfileViewManager.cachedHistory.find((h: any) =>
                String(h.inventory_id || h.inventory?.id) === String(item.id) &&
                (h.status === 'BORROWED' || h.status === 'RETURN_REQUESTED')
            );
            if (match?.id) effectiveBorrowId = match.id;
        }
        if (!effectiveBorrowId && rec) {
            effectiveBorrowId = (rec as any).borrowId || (rec as any)._id || item.id;
        }

        if (!effectiveBorrowId) {
            ToastManager.show('Return Unavailable', 'This loan is not linked to a server record yet.', 'warning');
            return;
        }

        // Strict ownership enforcement: only the person who issued the loan can return it (Admins can return any loan)
        if (!isAdmin && !ModalManager.isUserLoanMatch(rec)) {
            ToastManager.show('Return Prohibited', 'You can only initiate returns for components you have personally borrowed.', 'warning');
            return;
        }

        const borrowedQty = Math.max(1, Number(rec.qty) || 1);

        const nameEl = document.getElementById('return-modal-item-name');
        if (nameEl) nameEl.innerText = item.name;

        const holderInfo = document.getElementById('return-modal-holder-info');
        if (holderInfo) {
            holderInfo.innerText = `Borrower: ${rec.name || 'Member'} (${rec.roll || 'Enrolled'}) · Issued: ${borrowedQty} unit(s) on ${rec.date || 'Active'}`;
        }

        const returnIdInput = document.getElementById('return-borrow-id') as HTMLInputElement;
        if (returnIdInput) {
            returnIdInput.value = effectiveBorrowId;
            returnIdInput.dataset.itemId = item.id;
        }
        (document.getElementById('return-borrow-idx') as HTMLInputElement).value = String(origIdx);

        const formEl = document.getElementById('return-qty-form') as HTMLFormElement | null;
        if (formEl) {
            formEl.dataset.itemId = item.id;
        }

        const qtyInput = document.getElementById('return-qty-input') as HTMLInputElement;
        qtyInput.min = '1';
        qtyInput.max = String(borrowedQty);
        qtyInput.value = String(borrowedQty);

        const maxLabel = document.getElementById('return-qty-max-label');
        if (maxLabel) maxLabel.innerText = `of ${borrowedQty} borrowed`;

        const subtitle = document.getElementById('return-modal-subtitle');
        if (subtitle) {
            subtitle.innerText = isAdmin
                ? 'Admin Direct Restock · Return items to vault inventory'
                : 'Choose how many borrowed units you wish to return';
        }

        const noteText = document.getElementById('return-modal-note-text');
        if (noteText) {
            noteText.innerText = isAdmin
                ? 'Restocking will immediately return units to available vault inventory and close this active loan record.'
                : 'Return requests are sent to the Admin Portal for verification. Stock is checked back into inventory once approved by an administrator.';
        }

        const submitBtn = document.getElementById('btn-confirm-return-submit') as HTMLButtonElement | null;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = isAdmin
                ? '<i data-lucide="package-check"></i> Restock & Return to Vault'
                : '<i data-lucide="corner-up-left"></i> Submit Return to Admin';
        }

        ModalManager.updateReturnQtyPreview();
        this.open('return-qty-modal');
        lucide.createIcons();
    }

    private static isSubmittingReturn = false;

    // Submits a full or partial return. Routes via POST /borrow/return which immediately
    // restocks the vault for admins and registers a verification request for members.
    public static async handleReturnSubmission(borrowId: string, qtyVal: number, _idx: number) {
        if (!borrowId || this.isSubmittingReturn) {
            if (!borrowId) ToastManager.show('Return Error', 'Borrow reference is missing.', 'error');
            return;
        }

        if (!selectedItem) {
            const formEl = document.getElementById('return-qty-form') as HTMLFormElement | null;
            const itemId = formEl?.dataset.itemId;
            if (itemId) {
                setSelectedItem(inventory.find(i => String(i.id) === String(itemId)) || null);
            }
        }

        this.isSubmittingReturn = true;

        const isAdmin = this.getCurrentRole() === 'ADMIN';
        const token = localStorage.getItem('cicr_token');
        const submitBtn = document.getElementById('btn-confirm-return-submit') as HTMLButtonElement | null;
        const itemName = (document.getElementById('return-modal-item-name')?.innerText || selectedItem?.name || 'Component').trim();
        const requestedQty = Math.max(1, Number(qtyVal) || 1);

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = isAdmin ? 'Restocking Vault...' : 'Submitting Return...';
        }

        try {
            const endpoint = `${API_BASE}/borrow/return`;
            const payload = {
                borrow_id: borrowId,
                borrowId: borrowId,
                id: borrowId,
                itemId: selectedItem?.id,
                inventory_id: selectedItem?.id,
                returnQuantity: requestedQty,
                quantity: requestedQty
            };

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            const resData = await res.json().catch(() => ({})) as any;
            const isOk = res.ok || res.status === 200 || res.status === 202;

            if (!isOk) {
                ToastManager.show('Return Error', resData?.message || 'Failed to process return.', 'error');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = isAdmin ? '<i data-lucide="package-check"></i> Restock & Return to Vault' : '<i data-lucide="corner-up-left"></i> Submit Return to Admin';
                    renderLucideIcons(submitBtn);
                }
                return;
            }

            this.close('return-qty-modal');

            // If Admin (status 200) -> Direct Restock into Vault
            if (res.status === 200 || isAdmin) {
                if (selectedItem) {
                    const totalQty = Number(selectedItem.quantity) || 0;
                    selectedItem.availableQuantity = Math.min(totalQty, (selectedItem.availableQuantity ?? 0) + requestedQty);
                    if (selectedItem.borrowedBy) {
                        const rec = selectedItem.borrowedBy.find(r => r.id === borrowId || (r as any).borrowId === borrowId);
                        if (rec) {
                            if (requestedQty >= rec.qty) {
                                rec.returned = true;
                                (rec as any).status = 'RETURNED';
                            } else {
                                rec.qty -= requestedQty;
                            }
                        }
                    }
                }

                ToastManager.show(
                    'Component Restocked',
                    `Successfully returned ${requestedQty}x ${itemName} back into the vault.`,
                    'success'
                );
                DatabaseManager.addLog('return', `<span>[Admin]</span> restocked ${requestedQty}x <span>${itemName}</span> into vault inventory.`);
            } else {
                // Member (status 202) -> Return request submitted
                if (selectedItem && selectedItem.borrowedBy) {
                    const rec = selectedItem.borrowedBy.find(r => r.id === borrowId || (r as any).borrowId === borrowId);
                    if (rec) {
                        (rec as any).status = 'RETURN_REQUESTED';
                    }
                }

                ToastManager.show(
                    'Return Request Submitted',
                    `Return of ${requestedQty}x ${itemName} is awaiting Administrator approval in the Admin Portal.`,
                    'success'
                );
                DatabaseManager.addLog('return', `<span>${itemName}</span> return request submitted for ${requestedQty} unit(s) — pending admin approval.`);

                const localUser = (() => {
                    try { return readCurrentUser(); } catch { return {}; }
                })();
                const returnId = resData?.data?.id || `req-ret-local-${Date.now()}`;
                const localReq: RequestRecord = {
                    id: returnId,
                    type: 'RETURN',
                    borrowId,
                    returnQuantity: requestedQty,
                    itemId: selectedItem?.id || '',
                    itemName,
                    name: localUser.name || localStorage.getItem('cicr_auth') || 'Member',
                    roll: localUser.roll_number || localUser.roll || '',
                    qty: requestedQty,
                    purpose: `Return ${requestedQty} unit(s)`,
                    status: 'PENDING',
                    requestedAt: new Date().toISOString()
                };
                setRequests(requests.filter(r => !(r.id === returnId || (r.type === 'RETURN' && (r as any).borrowId === borrowId))));
                requests.unshift(localReq);
                DatabaseManager.save();
            }

            await DatabaseManager.syncFromBackend();
            if (window.dashboard) {
                window.dashboard.renderInventory(true);
                window.dashboard.renderStats();
            }

            if (selectedItem) {
                const refreshed = inventory.find(i => i.id === selectedItem?.id);
                if (refreshed) this.openDetailModal(refreshed);
            }
            DatabaseManager.updateNotificationBadges();

            if (isAdmin && typeof AdminManager !== 'undefined' && typeof AdminManager.loadHardwareRequests === 'function') {
                AdminManager.loadHardwareRequests(true);
            }
        } catch (e) {
            console.error('Return API error:', e);
            ToastManager.show('Network Error', 'Failed to reach server.', 'error');
        } finally {
            this.isSubmittingReturn = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = isAdmin ? '<i data-lucide="package-check"></i> Restock & Return to Vault' : '<i data-lucide="corner-up-left"></i> Submit Return to Admin';
                renderLucideIcons(submitBtn);
            }
        }
    }

    // Opens the Consolidated Bulk Return Modal ("Return Everything in 1 Go")
    public static openBulkReturnModal() {
        const userLoansMap = new Map<string, { item: InventoryItem; records: BorrowRecord[]; totalQty: number }>();
        let totalIssuedUnits = 0;

        inventory.forEach(item => {
            (item.borrowedBy || []).forEach(rec => {
                if (!rec.returned && (rec as any).status !== 'RETURN_REQUESTED' && ModalManager.isUserLoanMatch(rec)) {
                    const existing = userLoansMap.get(item.id);
                    const qty = Math.max(1, Number(rec.qty) || 1);
                    totalIssuedUnits += qty;
                    if (existing) {
                        existing.records.push(rec);
                        existing.totalQty += qty;
                    } else {
                        userLoansMap.set(item.id, { item, records: [rec], totalQty: qty });
                    }
                }
            });
        });

        if (userLoansMap.size === 0) {
            ToastManager.show('No Active Loans', 'You do not have any active hardware loans available to return.', 'info');
            return;
        }

        const storedUser = (() => {
            try { return readCurrentUser(); } catch { return {}; }
        })();
        const borrowerName = storedUser.name || localStorage.getItem('cicr_auth') || 'Member';
        let rollNum = storedUser.roll_number || storedUser.roll || '';
        if (!rollNum && storedUser.email) {
            const m = String(storedUser.email).match(/^([0-9]{6,12})@/);
            if (m) rollNum = m[1];
        }
        const borrowerEmail = storedUser.email || (rollNum ? `${rollNum}@mail.jiit.ac.in` : (localStorage.getItem('cicr_auth')?.includes('@') ? localStorage.getItem('cicr_auth') : ''));

        const nameEl = document.getElementById('bulk-return-borrower-name');
        if (nameEl) nameEl.innerText = borrowerName;

        const metaEl = document.getElementById('bulk-return-borrower-meta');
        if (metaEl) metaEl.innerText = `Roll: ${rollNum || 'Enrolled'} · ${borrowerEmail}`;

        const avatarEl = document.getElementById('bulk-return-avatar');
        if (avatarEl) avatarEl.innerText = borrowerName.charAt(0).toUpperCase();

        const totalIssuedEl = document.getElementById('bulk-total-issued-count');
        if (totalIssuedEl) totalIssuedEl.innerText = String(totalIssuedUnits);

        const listContainer = document.getElementById('bulk-return-items-list');
        if (!listContainer) return;
        listContainer.innerHTML = '';

        const updateSummary = () => {
            let totalSelectedUnits = 0;
            let totalSelectedItems = 0;
            const rows = listContainer.querySelectorAll<HTMLElement>('.bulk-return-item-card');
            rows.forEach(row => {
                const input = row.querySelector<HTMLInputElement>('.bulk-stepper-input');
                const max = Number(row.dataset.maxQty || 0);
                const val = Math.max(0, Math.min(max, Number(input?.value || 0)));
                if (val > 0) {
                    totalSelectedUnits += val;
                    totalSelectedItems++;
                }

                const badge = row.querySelector<HTMLElement>('.bulk-status-badge');
                if (badge) {
                    if (val === 0) {
                        badge.className = 'bulk-status-badge bulk-status-zero';
                        badge.innerText = `Keep Issued (0/${max})`;
                    } else if (val === max) {
                        badge.className = 'bulk-status-badge bulk-status-full';
                        badge.innerText = `Full Return (${val}/${max})`;
                    } else {
                        badge.className = 'bulk-status-badge bulk-status-partial';
                        badge.innerText = `Partial (${val}/${max})`;
                    }
                }
            });

            const summaryCount = document.getElementById('bulk-summary-count');
            if (summaryCount) {
                summaryCount.innerText = `${totalSelectedItems} item${totalSelectedItems === 1 ? '' : 's'} (${totalSelectedUnits} unit${totalSelectedUnits === 1 ? '' : 's'})`;
            }

            const submitBtn = document.getElementById('btn-submit-bulk-return') as HTMLButtonElement | null;
            if (submitBtn) {
                submitBtn.disabled = totalSelectedUnits === 0;
                submitBtn.innerHTML = `<i data-lucide="corner-up-left"></i> Submit Return (${totalSelectedUnits} Units)`;
                lucide.createIcons();
            }
        };

        userLoansMap.forEach(({ item, totalQty }) => {
            const card = document.createElement('div');
            card.className = 'bulk-return-item-card';
            card.dataset.itemId = item.id;
            card.dataset.maxQty = String(totalQty);

            card.innerHTML = `
                <div class="bulk-item-left">
                    <div class="bulk-item-icon">
                        <i data-lucide="cpu"></i>
                    </div>
                    <div class="bulk-item-info">
                        <div class="bulk-item-name" title="${AdminManager.escapeHtml(item.name)}">${AdminManager.escapeHtml(item.name)}</div>
                        <div class="bulk-item-meta">${totalQty} unit${totalQty === 1 ? '' : 's'} currently issued</div>
                    </div>
                </div>
                <div class="bulk-item-right">
                    <span class="bulk-status-badge bulk-status-full">Full Return (${totalQty}/${totalQty})</span>
                    <div class="bulk-stepper-wrap">
                        <button type="button" class="bulk-stepper-btn btn-minus">-</button>
                        <input type="number" class="bulk-stepper-input" min="0" max="${totalQty}" value="${totalQty}">
                        <button type="button" class="bulk-stepper-btn btn-plus">+</button>
                    </div>
                </div>
            `;

            const input = card.querySelector<HTMLInputElement>('.bulk-stepper-input')!;
            const btnMinus = card.querySelector<HTMLButtonElement>('.btn-minus')!;
            const btnPlus = card.querySelector<HTMLButtonElement>('.btn-plus')!;

            btnMinus.addEventListener('click', () => {
                const cur = Number(input.value) || 0;
                if (cur > 0) {
                    input.value = String(cur - 1);
                    updateSummary();
                }
            });

            btnPlus.addEventListener('click', () => {
                const cur = Number(input.value) || 0;
                if (cur < totalQty) {
                    input.value = String(cur + 1);
                    updateSummary();
                }
            });

            input.addEventListener('input', () => {
                let v = Number(input.value);
                if (isNaN(v) || v < 0) v = 0;
                if (v > totalQty) v = totalQty;
                input.value = String(v);
                updateSummary();
            });

            const statusBadge = card.querySelector<HTMLElement>('.bulk-status-badge');
            if (statusBadge) {
                statusBadge.setAttribute('title', 'Click to toggle return quantity');
                statusBadge.addEventListener('click', () => {
                    const cur = Number(input.value) || 0;
                    input.value = cur > 0 ? '0' : String(totalQty);
                    updateSummary();
                });
            }

            listContainer.appendChild(card);
        });

        // Wire shortcut buttons
        const btnAll100 = document.getElementById('btn-bulk-return-all-100');
        if (btnAll100) {
            btnAll100.onclick = () => {
                listContainer.querySelectorAll<HTMLElement>('.bulk-return-item-card').forEach(row => {
                    const input = row.querySelector<HTMLInputElement>('.bulk-stepper-input');
                    const max = row.dataset.maxQty || '0';
                    if (input) input.value = max;
                });
                updateSummary();
            };
        }

        const btnResetZero = document.getElementById('btn-bulk-reset-zero');
        if (btnResetZero) {
            btnResetZero.onclick = () => {
                listContainer.querySelectorAll<HTMLElement>('.bulk-return-item-card').forEach(row => {
                    const input = row.querySelector<HTMLInputElement>('.bulk-stepper-input');
                    if (input) input.value = '0';
                });
                updateSummary();
            };
        }

        const cancelBtn = document.getElementById('btn-cancel-bulk-return');
        if (cancelBtn) {
            cancelBtn.onclick = () => this.close('bulk-return-modal');
        }

        const closeBtn = document.getElementById('close-bulk-return-modal');
        if (closeBtn) {
            closeBtn.onclick = () => this.close('bulk-return-modal');
        }

        const submitBtn = document.getElementById('btn-submit-bulk-return') as HTMLButtonElement | null;
        if (submitBtn) {
            submitBtn.onclick = async () => {
                await this.submitBulkReturn(listContainer);
            };
        }

        updateSummary();
        this.open('bulk-return-modal');
        lucide.createIcons();
    }

    public static async submitBulkReturn(listContainer: HTMLElement) {
        const itemsToReturn: Array<{ itemId: string; quantity: number }> = [];
        const rows = listContainer.querySelectorAll<HTMLElement>('.bulk-return-item-card');
        rows.forEach(row => {
            const itemId = row.dataset.itemId;
            const input = row.querySelector<HTMLInputElement>('.bulk-stepper-input');
            const qty = Math.max(0, Number(input?.value || 0));
            if (itemId && qty > 0) {
                itemsToReturn.push({ itemId, quantity: qty });
            }
        });

        if (itemsToReturn.length === 0) {
            ToastManager.show('No Items Selected', 'Please select at least 1 unit to return.', 'warning');
            return;
        }

        const submitBtn = document.getElementById('btn-submit-bulk-return') as HTMLButtonElement | null;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i data-lucide="loader-2" class="animate-spin"></i> Submitting Dispatch...';
        }

        const token = localStorage.getItem('cicr_token');
        const isAdmin = this.getCurrentRole() === 'ADMIN';

        try {
            const res = await fetch(`${API_BASE}/borrow/bulk-return-request`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ items: itemsToReturn })
            });

            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                ToastManager.show('Return Error', json.message || 'Failed to submit consolidated return.', 'error');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i data-lucide="corner-up-left"></i> Submit Return to Admin';
                }
                return;
            }

            this.close('bulk-return-modal');

            const totalQty = itemsToReturn.reduce((sum, it) => sum + it.quantity, 0);
            ToastManager.show(
                'Consolidated Return Submitted',
                `Return requests for ${itemsToReturn.length} component(s) (${totalQty} units) dispatched to Admin Portal for verification.`,
                'success'
            );
            DatabaseManager.addLog('return', `Consolidated return request submitted for ${itemsToReturn.length} item(s) (${totalQty} units) — pending admin approval.`);

            // Add local request records so UI immediately reflects pending return status
            const storedUser = (() => {
                try { return readCurrentUser(); } catch { return {}; }
            })();
            const borrowerName = storedUser.name || localStorage.getItem('cicr_auth') || 'Member';
            const rollNum = storedUser.roll_number || storedUser.roll || '';

            itemsToReturn.forEach(({ itemId, quantity }) => {
                const targetItem = inventory.find(it => it.id === itemId);
                const localReq: RequestRecord = {
                    id: `req-ret-bulk-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                    type: 'RETURN',
                    itemId,
                    itemName: targetItem?.name || 'Component',
                    name: borrowerName,
                    roll: rollNum,
                    qty: quantity,
                    purpose: `Return ${quantity} unit(s) (Consolidated)`,
                    status: 'PENDING',
                    requestedAt: new Date().toISOString()
                };
                requests.unshift(localReq);
            });
            DatabaseManager.save();

            await DatabaseManager.syncFromBackend();
            DatabaseManager.updateNotificationBadges();

            if (isAdmin) {
                AdminManager.loadHardwareRequests(true);
            }
        } catch (err: any) {
            console.error('Bulk return submission error:', err);
            ToastManager.show('Network Error', 'Failed to connect to backend server.', 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i data-lucide="corner-up-left"></i> Submit Return to Admin';
                lucide.createIcons();
            }
        }
    }
}
