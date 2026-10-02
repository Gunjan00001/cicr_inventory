/**
 * modal-templates — pure HTML builders for modal/drawer content.
 *
 * These functions take data and return markup so the view logic in modal.ts
 * stays focused on wiring and event handling.
 */

/** Empty-state card used by the notification drawer. */
export function notifEmptyCardHtml(icon: string, title: string, desc: string): string {
    return `
        <div class="notif-empty-state">
            <div class="notif-empty-icon-box">
                <i data-lucide="${icon}"></i>
            </div>
            <h4>${title}</h4>
            <p>${desc}</p>
        </div>
    `;
}
