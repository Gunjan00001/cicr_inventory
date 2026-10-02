/**
 * admin-audit — pure helpers for the admin audit stream.
 *
 * Kept free of DOM and class state so the audit logic can be read, tested and
 * changed independently of AdminManager. AdminManager supplies the data and
 * the date formatters; this module returns filtered lists, counts and HTML.
 */
import { escapeHtml } from './core/ui';

export type AuditCategory = 'auth' | 'inventory' | 'hardware' | 'loans' | 'system';
export type AuditCounts = Record<'all' | AuditCategory, number>;

/** Audit action -> category. Single source of truth for counters and filters. */
export const AUDIT_CATEGORY_ACTIONS: Record<Exclude<AuditCategory, 'system'>, readonly string[]> = {
    auth: ['Sign In', 'Sign Up', 'User Approved', 'User Rejected', 'Role Changed', 'User Deleted', 'Password Reset'],
    inventory: ['Item Added', 'Item Edited', 'Item Deleted', 'Stock Alert', 'Low Stock'],
    hardware: ['Hardware Requested', 'Bulk Hardware Requested', 'Hardware Approved', 'Hardware Rejected', 'Rejected Request', 'Hardware Cancelled'],
    loans: ['Borrowed', 'Returned', 'OTP Requested', 'Item Borrowed', 'Item Returned', 'Approved Return', 'Return Requested', 'Ledger Record Deleted']
};

export const KNOWN_AUDIT_CATEGORIES: readonly string[] = ['auth', 'inventory', 'hardware', 'loans', 'system'];

export function getAuditCategory(action: string): AuditCategory {
    for (const cat of Object.keys(AUDIT_CATEGORY_ACTIONS) as Array<keyof typeof AUDIT_CATEGORY_ACTIONS>) {
        if (AUDIT_CATEGORY_ACTIONS[cat].includes(action)) return cat;
    }
    return 'system';
}

/** Keeps logs within the last `daysRange` days (all logs when >= 7). */
export function filterAuditLogsByRange<T extends { timestamp?: string }>(logs: T[], daysRange: number, now = Date.now()): T[] {
    const maxAgeMs = (daysRange && daysRange < 7) ? daysRange * 24 * 60 * 60 * 1000 : Infinity;
    return logs.filter(l => {
        if (!l.timestamp || maxAgeMs === Infinity) return true;
        const logTime = new Date(l.timestamp).getTime();
        return !isNaN(logTime) && (now - logTime) <= maxAgeMs;
    });
}

export function computeAuditCategoryCounts(logs: Array<{ action?: string }>): AuditCounts {
    const counts: AuditCounts = { all: logs.length, auth: 0, inventory: 0, hardware: 0, loans: 0, system: 0 };
    for (const l of logs) counts[getAuditCategory(l.action || '')]++;
    return counts;
}

export function filterAuditLogsByCategory<T extends { action?: string }>(logs: T[], category: string): T[] {
    if (!category || category === 'all') return logs;
    const cat = category.toLowerCase();
    if (!KNOWN_AUDIT_CATEGORIES.includes(cat)) return logs;
    return logs.filter(l => getAuditCategory(l.action || '') === cat);
}

/** `searchTerm` must already be lower-cased by the caller. */
export function filterAuditLogsBySearch(logs: any[], searchTerm: string): any[] {
    if (!searchTerm) return logs;
    return logs.filter(l =>
        (l.action && l.action.toLowerCase().includes(searchTerm)) ||
        (l.description && l.description.toLowerCase().includes(searchTerm)) ||
        (l.users?.name && l.users.name.toLowerCase().includes(searchTerm)) ||
        (l.users?.email && l.users.email.toLowerCase().includes(searchTerm)) ||
        (l.inventory?.name && l.inventory.name.toLowerCase().includes(searchTerm))
    );
}

/** Maps an action to its badge/icon/card styling. */
export function classifyAuditAction(action: string): { badgeClass: string; iconName: string; cardCat: string } {
    let badgeClass = 'action-cyan';
    let iconName = 'activity';
    let cardCat = 'cat-system';

    if (['Item Added', 'Hardware Approved', 'User Approved', 'Returned', 'Item Returned', 'Approved Return'].includes(action)) {
        badgeClass = 'action-green';
        iconName = 'check-circle';
        cardCat = 'cat-inventory';
    } else if (['Item Deleted', 'Hardware Rejected', 'User Rejected', 'User Deleted'].includes(action)) {
        badgeClass = 'action-red';
        iconName = 'alert-octagon';
        cardCat = 'cat-danger';
    } else if (['Sign In', 'Sign Up', 'Role Changed', 'Password Reset'].includes(action)) {
        badgeClass = 'action-purple';
        iconName = action === 'Sign In' ? 'log-in' : action === 'Password Reset' ? 'key' : 'user-plus';
        cardCat = 'cat-auth';
    } else if (['Borrowed', 'Item Borrowed', 'Hardware Requested'].includes(action)) {
        badgeClass = 'action-yellow';
        iconName = 'package';
        cardCat = 'cat-loans';
    } else if (['Item Edited', 'Stock Alert'].includes(action)) {
        badgeClass = 'action-cyan';
        iconName = 'cpu';
        cardCat = 'cat-inventory';
    }
    return { badgeClass, iconName, cardCat };
}

export interface AuditCardFormatters {
    dateTime: (raw: string) => { dateStr: string; timeStr: string };
    timeAgo: (raw: string) => string;
}

/** Builds the HTML for a single audit log card. */
export function buildAuditCard(log: any, fmt: AuditCardFormatters): string {
    const action = log.action || 'System Event';
    const { badgeClass, iconName, cardCat } = classifyAuditAction(action);

    const rawTime = log.timestamp || log.created_at || new Date().toISOString();
    const dt = fmt.dateTime(rawTime);
    const timeAgo = fmt.timeAgo(rawTime);

    const actorName = log.users?.name || (log.user_id ? 'Member' : 'System');
    const actorEmail = log.users?.email || '';

    return `
        <div class="audit-log-card ${cardCat}" data-log-id="${escapeHtml(log.id)}" title="Click to view raw event telemetry metadata">
            <div class="audit-left-col">
                <span class="audit-action-badge ${badgeClass}">
                    <i data-lucide="${iconName}" style="width: 11px; height: 11px;"></i>
                    ${escapeHtml(action)}
                </span>
                <div class="audit-content-block">
                    <span class="audit-desc-text">${escapeHtml(log.description || 'Action recorded')}</span>
                    <div class="audit-meta-chips">
                        <span class="audit-actor-chip"><i data-lucide="user" style="width: 11px; height: 11px;"></i> <strong>${escapeHtml(actorName)}</strong> ${actorEmail ? `(${escapeHtml(actorEmail)})` : ''}</span>
                        ${log.inventory?.name ? `<span class="audit-actor-chip" style="color: #00f0ff;"><i data-lucide="box" style="width: 11px; height: 11px;"></i> ${escapeHtml(log.inventory.name)}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="audit-right-col">
                <span class="audit-date-line">${dt.dateStr}</span>
                <span class="audit-time-line">${dt.timeStr} <span class="audit-ago-sub">(${timeAgo})</span></span>
            </div>
        </div>
    `;
}
