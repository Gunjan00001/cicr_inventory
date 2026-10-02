/**
 * Session helpers for reading the cached current user.
 *
 * `cicr_user` is written by the auth flow and read all over the UI. Reading it
 * defensively here keeps a corrupt/absent value from throwing in render paths
 * and removes the repeated JSON.parse/try-catch boilerplate.
 */

export function readCurrentUser(): any {
    try {
        const raw = localStorage.getItem('cicr_user');
        return raw ? (JSON.parse(raw) || {}) : {};
    } catch {
        return {};
    }
}
