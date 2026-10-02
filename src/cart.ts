/**
 * CartManager — multi-item hardware request cart.
 * Persists to localStorage and checks out via POST /borrow/bulk-request.
 * Depends on: toast, database, admin, core/ui. */

import { readCurrentUser } from './core/session';
import { ToastManager } from './toast';
import { getFastIconSvg, renderLucideIcons } from './core/ui';
import { AdminManager } from './admin';
import { API_BASE } from './core/api';
import { requests, setRequests } from './core/state';
import { DatabaseManager } from './database';
import type { InventoryItem, RequestRecord } from './types';

// ==========================================
// 4b. Hardware Request Cart Manager (Consolidated 1-Go Checkout)
// ==========================================
export interface CartItem {
    id: string;
    name: string;
    category: string;
    quantity: number;
    maxAvailable: number;
    location: string;
    specs: string;
    dueDate?: string;
}

export class CartManager {
    private static items: CartItem[] = [];
    private static itemMap = new Map<string, number>();
    private static isInitialized = false;
    private static isCheckingOut = false;

    private static syncItemMap() {
        this.itemMap.clear();
        for (let i = 0; i < this.items.length; i++) {
            this.itemMap.set(this.items[i].id, this.items[i].quantity);
        }
    }

    public static init() {
        if (this.isInitialized) {
            this.updateCartBadges();
            return;
        }
        this.isInitialized = true;
        this.loadFromStorage();
        this.setupEventListeners();
        this.updateCartBadges();
    }

    private static loadFromStorage() {
        try {
            const raw = localStorage.getItem('cicr_cart_items');
            if (raw) {
                this.items = JSON.parse(raw);
            }
        } catch {
            this.items = [];
        }
        this.syncItemMap();
    }

    private static saveToStorage() {
        try {
            localStorage.setItem('cicr_cart_items', JSON.stringify(this.items));
        } catch {}
        this.syncItemMap();
        this.updateCartBadges();
    }

    public static getItems(): CartItem[] {
        return this.items;
    }

    public static getCount(): number {
        return this.items.length;
    }

    public static getTotalQuantity(): number {
        return this.items.reduce((sum, it) => sum + it.quantity, 0);
    }

    public static hasItem(itemId: string): boolean {
        return this.itemMap.has(itemId);
    }

    public static getItemQty(itemId: string): number {
        return this.itemMap.get(itemId) || 0;
    }

    public static addItem(item: InventoryItem, qty = 1) {
        const borrowedSum = (item.borrowedBy || [])
            .filter((r: any) => !r.returned && (r as any).status !== 'RETURNED' && (r as any).status !== 'REJECTED')
            .reduce((sum, rec) => sum + rec.qty, 0);
        const totalQty = Number(item.quantity) || 0;
        const available = typeof item.availableQuantity === 'number'
            ? Math.min(totalQty, Math.max(0, item.availableQuantity))
            : Math.max(0, totalQty - borrowedSum);

        if (available <= 0) {
            ToastManager.show('Out of Stock', `"${item.name}" currently has 0 available units in the vault.`, 'warning');
            return;
        }

        const globalDueInput = document.getElementById('cart-due-date') as HTMLInputElement | null;
        const defaultDueDate = globalDueInput?.value || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const existing = this.items.find(it => it.id === item.id);
        if (existing) {
            if (existing.quantity >= available) {
                ToastManager.show('Stock Limit Reached', `Only ${available} unit(s) of "${item.name}" are available in the vault.`, 'info');
                return;
            }
            existing.quantity = Math.min(available, existing.quantity + qty);
            existing.maxAvailable = available;
            if (!existing.dueDate) existing.dueDate = defaultDueDate;
            ToastManager.show('Cart Updated', `Incremented "${item.name}" to ${existing.quantity} unit(s).`, 'success');
        } else {
            this.items.push({
                id: item.id,
                name: item.name,
                category: item.category,
                quantity: Math.min(available, Math.max(1, qty)),
                maxAvailable: available,
                location: item.location || 'Lab Shelf',
                specs: item.specs || '',
                dueDate: defaultDueDate
            });
            ToastManager.show('Added to Request Cart', `Added 1x "${item.name}" to your Hardware Request Cart.`, 'success');
        }

        this.saveToStorage();
        if (window.dashboard) {
            window.dashboard.renderInventory(true);
        }
        this.pulseFloatingCart();
    }

    public static removeItem(itemId: string) {
        const idx = this.items.findIndex(it => it.id === itemId);
        if (idx !== -1) {
            const removed = this.items.splice(idx, 1)[0];
            this.saveToStorage();
            ToastManager.show('Removed from Cart', `"${removed.name}" was removed from your cart.`, 'info');
            this.renderCartModal();
            if (window.dashboard) {
                window.dashboard.renderInventory(true);
            }
        }
    }

    public static updateQty(itemId: string, newQty: number) {
        const item = this.items.find(it => it.id === itemId);
        if (!item) return;

        if (newQty <= 0) {
            this.removeItem(itemId);
            return;
        }

        item.quantity = Math.min(item.maxAvailable, newQty);
        this.saveToStorage();
        this.renderCartModal();
        if (window.dashboard) {
            window.dashboard.renderInventory(true);
        }
    }

    public static clear() {
        this.items = [];
        this.saveToStorage();
        this.renderCartModal();
        if (window.dashboard) {
            window.dashboard.renderInventory(true);
        }
    }

    public static clearCart() {
        this.items = [];
        this.itemMap.clear();
        localStorage.removeItem('cicr_cart_items');
        this.updateCartBadges();
    }

    public static reloadFromStorage() {
        this.loadFromStorage();
        this.updateCartBadges();
    }

    public static updateCartBadges() {
        const count = this.getCount();

        // Top Navbar Small Cart Button
        const navbarBadge = document.getElementById('header-cart-badge');
        const navbarDot = document.getElementById('header-cart-dot');
        const navbarBtn = document.getElementById('btn-navbar-cart');
        if (navbarBadge) navbarBadge.innerText = String(count);
        if (navbarDot) navbarDot.style.display = count > 0 ? 'block' : 'none';
        if (navbarBtn) {
            if (count > 0) navbarBtn.classList.add('has-items');
            else navbarBtn.classList.remove('has-items');
        }

        // Vault Top Bar Cart Button
        const vaultBadge = document.getElementById('vault-cart-badge');
        const vaultDot = document.getElementById('vault-cart-dot');
        const vaultBtn = document.getElementById('btn-vault-cart-trigger');
        if (vaultBadge) vaultBadge.innerText = String(count);
        if (vaultDot) vaultDot.style.display = count > 0 ? 'block' : 'none';
        if (vaultBtn) {
            if (count > 0) vaultBtn.classList.add('has-items');
            else vaultBtn.classList.remove('has-items');
        }

        // Catalog Header Action Cart Badge
        const catalogBadge = document.getElementById('catalog-cart-badge');
        if (catalogBadge) catalogBadge.innerText = String(count);

        // Sidebar Cart Badge
        const sideNavBadge = document.getElementById('side-nav-cart-badge');
        if (sideNavBadge) {
            sideNavBadge.innerText = String(count);
            sideNavBadge.style.display = count > 0 ? 'inline-flex' : 'none';
        }

        // Dashboard Cart Card Text
        const dashCountText = document.getElementById('dash-cart-count-text');
        if (dashCountText) {
            dashCountText.innerText = count === 0 ? '0 items loaded' : `${count} component${count === 1 ? '' : 's'} staged`;
        }

        // Floating Action Button (FAB)
        const floatingFab = document.getElementById('floating-cart-fab');
        const floatingBadge = document.getElementById('floating-cart-badge');
        const floatingPing = document.getElementById('floating-cart-ping');
        if (floatingBadge) floatingBadge.innerText = String(count);
        if (floatingPing) floatingPing.style.display = count > 0 ? 'block' : 'none';
        if (floatingFab) {
            const isInventory = document.body.classList.contains('view-inventory-view') && (document.getElementById('inventory-view')?.style.display !== 'none');
            floatingFab.style.setProperty('display', isInventory ? 'block' : 'none', 'important');
        }

        // Capsule Nav Cart Badge (if on capsule view)
        const capsuleBadge = document.getElementById('nav-cart-badge');
        if (capsuleBadge) {
            capsuleBadge.innerText = String(count);
            capsuleBadge.style.display = count > 0 ? 'inline-flex' : 'none';
        }

        // Modal badge
        const modalBadge = document.getElementById('cart-manifest-badge');
        if (modalBadge) modalBadge.innerHTML = `<span class="cart-badge-dot"></span> ${count} item${count === 1 ? '' : 's'}`;
    }

    public static pulseFloatingCart() {
        const btns = [
            document.getElementById('btn-navbar-cart'),
            document.getElementById('btn-vault-cart-trigger'),
            document.getElementById('btn-floating-cart')
        ];
        btns.forEach(btn => {
            if (btn) {
                btn.classList.remove('pulse-anim');
                void btn.offsetWidth;
                btn.classList.add('pulse-anim');
            }
        });
    }

    public static openCart() {
        const storedUser = readCurrentUser();
        let userName = storedUser.name || storedUser.username || localStorage.getItem('cicr_auth') || 'Member';
        let userRoll = storedUser.roll_number || storedUser.roll || '';
        if (!userRoll && storedUser.email) {
            const m = String(storedUser.email).match(/^([0-9]{6,12})@/);
            if (m) userRoll = m[1];
        }

        const nameEl = document.getElementById('cart-borrower-name');
        const rollEl = document.getElementById('cart-borrower-roll');
        if (nameEl) nameEl.innerText = userName;
        if (rollEl) rollEl.innerText = userRoll || 'Student / Guest';

        const dueDateInput = document.getElementById('cart-due-date') as HTMLInputElement | null;
        if (dueDateInput && !dueDateInput.value) {
            const defaultDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            dueDateInput.min = new Date().toISOString().split('T')[0];
            dueDateInput.value = defaultDue;
        }

        this.renderCartModal();
        const cartModal = document.getElementById('cart-modal');
        if (cartModal) {
            cartModal.classList.add('active');
            renderLucideIcons(cartModal);
        }
    }

    public static closeCart() {
        const cartModal = document.getElementById('cart-modal');
        if (cartModal) {
            cartModal.classList.remove('active');
        }
    }

    public static renderCartModal() {
        const listEl = document.getElementById('cart-items-list');
        const emptyState = document.getElementById('cart-empty-state');
        const checkoutPane = document.getElementById('cart-checkout-pane');
        const summaryCount = document.getElementById('cart-summary-count');
        const summaryTotalQty = document.getElementById('cart-summary-total-qty');
        const modalBadge = document.getElementById('cart-manifest-badge');

        const count = this.getCount();
        const totalQty = this.getTotalQuantity();

        if (summaryCount) {
            summaryCount.innerHTML = `<span class="hud-number">${count}</span> <span class="hud-suffix">component${count === 1 ? '' : 's'}</span>`;
        }
        if (summaryTotalQty) {
            summaryTotalQty.innerHTML = `<span class="hud-number text-cyan">${totalQty}</span> <span class="hud-suffix text-cyan-sub">unit${totalQty === 1 ? '' : 's'}</span>`;
        }
        if (modalBadge) modalBadge.innerHTML = `<span class="cart-badge-dot"></span> ${count} item${count === 1 ? '' : 's'}`;

        if (!listEl) return;
        listEl.innerHTML = '';

        if (count === 0) {
            if (emptyState) {
                emptyState.style.display = 'block';
                renderLucideIcons(emptyState);
            }
            if (checkoutPane) (checkoutPane as HTMLElement).style.opacity = '1';
            const submitBtn = document.getElementById('btn-submit-cart-checkout') as HTMLButtonElement | null;
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.title = 'Add components from the catalog to submit request';
            }
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        if (checkoutPane) (checkoutPane as HTMLElement).style.opacity = '1';
        const submitBtn = document.getElementById('btn-submit-cart-checkout') as HTMLButtonElement | null;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.title = 'Checkout and submit hardware request';
        }

        const globalDueInput = document.getElementById('cart-due-date') as HTMLInputElement | null;
        const globalDueDate = globalDueInput?.value || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const minDate = new Date().toISOString().split('T')[0];

        this.items.forEach(it => {
            const itemDue = it.dueDate || globalDueDate;
            const row = document.createElement('div');
            row.className = 'cart-item-card';
            row.innerHTML = `
                <div class="cart-item-main-row">
                    <div class="cart-item-left">
                        <div class="cart-item-title-row">
                            <span class="cart-item-cat-chip">${AdminManager.escapeHtml(it.category || 'MCU')}</span>
                            <span class="cart-item-name" title="${AdminManager.escapeHtml(it.name)}">${AdminManager.escapeHtml(it.name)}</span>
                        </div>
                        <div class="cart-item-meta">
                            <span><i data-lucide="map-pin" style="width:11px;height:11px;vertical-align:middle;"></i> ${AdminManager.escapeHtml(it.location)}</span>
                            <span>&bull; Max Available: <strong class="cart-max-val">${it.maxAvailable}</strong></span>
                        </div>
                    </div>
                    <div class="cart-item-right">
                        <div class="cart-qty-ctrl">
                            <button type="button" class="cart-qty-btn btn-qty-minus" data-id="${it.id}" title="Decrease Quantity">
                                ${getFastIconSvg('minus', 11)}
                            </button>
                            <span class="cart-qty-val">${it.quantity}</span>
                            <button type="button" class="cart-qty-btn btn-qty-plus" data-id="${it.id}" title="Increase Quantity" ${it.quantity >= it.maxAvailable ? 'disabled' : ''}>
                                ${getFastIconSvg('plus', 11)}
                            </button>
                        </div>
                        <button type="button" class="btn-cart-remove" data-id="${it.id}" title="Remove Item">
                            ${getFastIconSvg('trash-2', 13)}
                        </button>
                    </div>
                </div>
                <div class="cart-item-date-bar">
                    <span class="item-date-label">
                        ${getFastIconSvg('calendar', 12)} Expected Return:
                    </span>
                    <div class="cart-item-date-right">
                        <input type="date" class="item-due-input" data-id="${it.id}" value="${itemDue}" min="${minDate}" title="Select custom return date for this component">
                        <button type="button" class="btn-item-date-sync" data-id="${it.id}" title="Sync with overall default return date">
                            ${getFastIconSvg('link', 11)} Same Date
                        </button>
                    </div>
                </div>
            `;

            row.querySelector('.btn-qty-minus')?.addEventListener('click', () => {
                this.updateQty(it.id, it.quantity - 1);
            });
            row.querySelector('.btn-qty-plus')?.addEventListener('click', () => {
                this.updateQty(it.id, it.quantity + 1);
            });
            row.querySelector('.btn-cart-remove')?.addEventListener('click', () => {
                this.removeItem(it.id);
            });

            // Per-item return date selection listener
            const itemDateInp = row.querySelector('.item-due-input') as HTMLInputElement | null;
            if (itemDateInp) {
                itemDateInp.addEventListener('change', (e) => {
                    const target = e.target as HTMLInputElement;
                    it.dueDate = target.value;
                    this.saveToStorage();
                    ToastManager.show('Return Date Updated', `Return date for "${it.name}" set to ${it.dueDate}.`, 'info');
                });
            }

            // Sync with default date button
            const syncBtn = row.querySelector('.btn-item-date-sync') as HTMLButtonElement | null;
            if (syncBtn) {
                syncBtn.addEventListener('click', () => {
                    const curGlobal = (document.getElementById('cart-due-date') as HTMLInputElement)?.value || globalDueDate;
                    it.dueDate = curGlobal;
                    if (itemDateInp) itemDateInp.value = curGlobal;
                    this.saveToStorage();
                    ToastManager.show('Date Synced', `"${it.name}" return date synced to overall checkout date (${curGlobal}).`, 'success');
                });
            }

            listEl.appendChild(row);
        });

        renderLucideIcons(listEl);
    }

    public static async handleCheckout(e: Event) {
        e.preventDefault();
        if (this.isCheckingOut) return;

        const count = this.getCount();
        if (count === 0) {
            ToastManager.show('Cart Empty', 'Please add at least one component before checking out.', 'warning');
            return;
        }

        const purposeInput = document.getElementById('cart-purpose') as HTMLInputElement | null;
        const purpose = (purposeInput?.value || '').trim();
        if (!purpose) {
            ToastManager.show('Purpose Required', 'Please provide a project or purpose for this hardware issue.', 'warning');
            purposeInput?.focus();
            return;
        }

        const dueDateInput = document.getElementById('cart-due-date') as HTMLInputElement | null;
        const defaultDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const dueDate = dueDateInput?.value || defaultDue;

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
            ToastManager.show('Authentication Required', 'Please log in to submit your hardware request.', 'error');
            return;
        }

        const storedUser = readCurrentUser();
        const borrowerName = storedUser.name || storedUser.username || localStorage.getItem('cicr_auth') || 'Member';
        let rollNum = storedUser.roll_number || storedUser.roll || '';
        if (!rollNum && storedUser.email) {
            const m = String(storedUser.email).match(/^([0-9]{6,12})@/);
            if (m) rollNum = m[1];
        }
        const userEmail = storedUser.email || (rollNum ? `${rollNum}@mail.jiit.ac.in` : (localStorage.getItem('cicr_auth')?.includes('@') ? localStorage.getItem('cicr_auth') : ''));

        const submitBtn = document.getElementById('btn-submit-cart-checkout') as HTMLButtonElement | null;
        this.isCheckingOut = true;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Processing Request Manifest...`;
            renderLucideIcons(submitBtn);
        }

        const date = new Date().toISOString().split('T')[0];
        const itemsToSubmit = [...this.items];

        const payload = {
            purpose,
            dueDate,
            due_date: dueDate,
            durationDays,
            duration_days: durationDays,
            borrowerName,
            borrower_name: borrowerName,
            borrowerEmail: userEmail,
            borrower_email: userEmail,
            rollNumber: rollNum,
            roll_number: rollNum,
            items: itemsToSubmit.map(it => {
                const itDueDate = it.dueDate || dueDate;
                let itDuration = durationDays;
                if (itDueDate) {
                    const t0 = new Date();
                    t0.setHours(0, 0, 0, 0);
                    const t1 = new Date(itDueDate);
                    t1.setHours(0, 0, 0, 0);
                    const diff = Math.round((t1.getTime() - t0.getTime()) / (1000 * 60 * 60 * 24));
                    if (diff > 0) itDuration = diff;
                }
                return {
                    itemId: it.id,
                    inventory_id: it.id,
                    itemName: it.name,
                    name: it.name,
                    quantity: it.quantity,
                    qty: it.quantity,
                    dueDate: itDueDate,
                    due_date: itDueDate,
                    durationDays: itDuration,
                    duration_days: itDuration
                };
            })
        };

        try {
            const res = await fetch(`${API_BASE}/borrow/bulk-request`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            const resData = await res.json().catch(() => ({})) as any;

            itemsToSubmit.forEach((it, idx) => {
                const reqId = resData?.data?.[idx]?.id || `req-cart-${Date.now()}-${idx}`;
                const itDueDate = it.dueDate || dueDate;
                const newReq: RequestRecord = {
                    id: reqId,
                    itemId: it.id,
                    itemName: it.name,
                    name: borrowerName,
                    roll: rollNum,
                    qty: it.quantity,
                    purpose: purpose,
                    status: 'PENDING',
                    requestedAt: date,
                    dueDate: itDueDate
                };
                setRequests(requests.filter(r => r.id !== newReq.id && !(r.status === 'PENDING' && r.itemId === newReq.itemId && r.qty === newReq.qty && r.purpose === newReq.purpose)));
                requests.unshift(newReq);
            });

            DatabaseManager.save();
            DatabaseManager.addLog('borrow', `<span>${borrowerName}</span> checked out request cart with ${itemsToSubmit.length} components for '${purpose}'.`);

            this.clear();
            this.closeCart();
            if (purposeInput) purposeInput.value = '';

            ToastManager.show(
                'Request Manifest Transmitted',
                `Successfully submitted ${itemsToSubmit.length} component(s) to the Admin Portal.`,
                'success'
            );

            AdminManager.loadHardwareRequests(true);
            DatabaseManager.updateNotificationBadges();
            await DatabaseManager.syncFromBackend();
        } catch (err: any) {
            console.error('Bulk checkout error, queuing locally:', err);
            itemsToSubmit.forEach((it, idx) => {
                const reqId = `req-cart-${Date.now()}-${idx}`;
                const itDueDate = it.dueDate || dueDate;
                const newReq: RequestRecord = {
                    id: reqId,
                    itemId: it.id,
                    itemName: it.name,
                    name: borrowerName,
                    roll: rollNum,
                    qty: it.quantity,
                    purpose: purpose,
                    status: 'PENDING',
                    requestedAt: date,
                    dueDate: itDueDate
                };
                setRequests(requests.filter(r => r.id !== newReq.id && !(r.status === 'PENDING' && r.itemId === newReq.itemId && r.qty === newReq.qty && r.purpose === newReq.purpose)));
                requests.unshift(newReq);
            });

            DatabaseManager.save();
            DatabaseManager.addLog('borrow', `<span>${borrowerName}</span> queued request cart with ${itemsToSubmit.length} components for '${purpose}'.`);

            this.clear();
            this.closeCart();
            if (purposeInput) purposeInput.value = '';

            ToastManager.show(
                'Request Manifest Queued',
                `Hardware request for ${itemsToSubmit.length} components queued for Admin authorization.`,
                'success'
            );
            AdminManager.loadHardwareRequests(true);
        } finally {
            this.isCheckingOut = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `<i data-lucide="send"></i> Checkout & Submit Request`;
                renderLucideIcons(submitBtn);
            }
        }
    }

    private static setupEventListeners() {
        document.getElementById('btn-navbar-cart')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.openCart();
        });

        document.getElementById('nav-capsule-cart')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.openCart();
        });

        document.getElementById('btn-vault-cart-trigger')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.openCart();
        });

        document.getElementById('btn-catalog-cart-trigger')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.openCart();
        });

        document.getElementById('side-nav-cart')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.openCart();
        });

        document.getElementById('dash-card-cart')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.openCart();
        });

        document.getElementById('btn-floating-cart')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.openCart();
        });

        document.getElementById('btn-close-cart-modal')?.addEventListener('click', () => {
            this.closeCart();
        });

        document.getElementById('btn-clear-cart')?.addEventListener('click', () => {
            if (this.getCount() > 0) {
                this.clear();
            }
        });

        document.getElementById('btn-empty-cart-browse')?.addEventListener('click', () => {
            this.closeCart();
            if ((window as any).switchSection) {
                (window as any).switchSection('inventory-view');
            }
        });

        const form = document.getElementById('cart-checkout-form') as HTMLFormElement | null;
        if (form && !form.dataset.bound) {
            form.dataset.bound = 'true';
            form.addEventListener('submit', (e) => this.handleCheckout(e));
        }

        const cartPresets = document.querySelectorAll('.date-preset-pill.cart-preset');
        const dueDateInput = document.getElementById('cart-due-date') as HTMLInputElement | null;
        const durationBadge = document.getElementById('cart-duration-badge');

        const updateCartDurationBadge = (dateVal: string) => {
            if (!durationBadge || !dateVal) return;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const target = new Date(dateVal);
            target.setHours(0, 0, 0, 0);
            const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays <= 0) {
                durationBadge.textContent = 'Due Today';
            } else if (diffDays === 1) {
                durationBadge.textContent = '1 Day Loan';
            } else {
                durationBadge.textContent = `${diffDays} Days Loan`;
            }
        };

        const syncAllItemsToGlobalDate = (newDate: string) => {
            this.items.forEach(it => {
                it.dueDate = newDate;
            });
            this.saveToStorage();
            document.querySelectorAll<HTMLInputElement>('.item-due-input').forEach(inp => {
                inp.value = newDate;
            });
        };

        dueDateInput?.addEventListener('input', () => {
            if (dueDateInput.value) {
                updateCartDurationBadge(dueDateInput.value);
                syncAllItemsToGlobalDate(dueDateInput.value);
            }
        });

        cartPresets.forEach(pill => {
            pill.addEventListener('click', (e) => {
                e.preventDefault();
                const days = Number((pill as HTMLElement).dataset.days) || 7;
                const newDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                if (dueDateInput) {
                    dueDateInput.value = newDate;
                    updateCartDurationBadge(newDate);
                    syncAllItemsToGlobalDate(newDate);
                }
                cartPresets.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
            });
        });
    }
}

(window as any).CartManager = CartManager;
