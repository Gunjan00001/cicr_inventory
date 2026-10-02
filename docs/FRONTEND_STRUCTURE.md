# Frontend Structure

The Vite frontend lives in `src/` and is plain TypeScript (no framework). It used
to be a single ~11,600-line `src/main.ts`; it is now split into one module per
manager plus a small `src/core/` of shared helpers. `src/main.ts` is only the
entry point.

Read this together with [`../AGENT.md`](../AGENT.md).

## Entry & shared core

| File | Purpose |
|------|---------|
| `src/main.ts` | **Entry point** (loaded by `index.html`). Imports every manager, installs the `fetch` failover + 401 expiry hooks, exposes window helpers, and boots all managers on `DOMContentLoaded`. |
| `src/core/state.ts` | Shared mutable state (`inventory`, `logs`, `requests`, `selectedItem`). Read via live bindings; **write via `setInventory/setLogs/setRequests/setSelectedItem`** (ESM bindings are read-only to importers). |
| `src/core/api.ts` | `API_BASE` / `CLOUD_API_FALLBACK` resolution (localhost vs LAN vs production). |
| `src/core/ui.ts` | `escapeHtml` (the canonical HTML escaper), safe Lucide rendering, stock-status labels, roll→branch lookup. |
| `src/core/session.ts` | `readCurrentUser()` — safe read of the cached `cicr_user`. |
| `src/core/identity.ts` | `isUserLoanMatch` / `isUserRequestMatch` — "does this record belong to the signed-in user?". |
| `src/core/domain.ts` | Types shared across feature modules (currently `AdminHardwareRequest`). |
| `src/lucide-global.d.ts` | Ambient global for `lucide.createIcons()`. |

## Feature modules

| File | Manager | Responsibility |
|------|---------|----------------|
| `src/toast.ts` | `ToastManager` | Floating toasts / welcome banners. |
| `src/background3d.ts` | `Background3D` | Three.js particle canvas (`decent` theme only). |
| `src/database.ts` | `DatabaseManager` | localStorage caching, REST sync, auto-sync timer, audit writes. |
| `src/dashboard.ts` | `DashboardManager` | App shell + section router, inventory grid/filters, stats, mobile sidebar. |
| `src/cart.ts` | `CartManager` | Multi-item request cart → `POST /borrow/bulk-request`. |
| `src/modal.ts` | `ModalManager` | Modal lifecycle, detail/borrow/return/bulk-return dialogs, notification drawer, role helpers. |
| `src/auth.ts` | `AuthManager` | Login/register/logout, session, inactivity timeout, admin visibility. |
| `src/password-reset.ts` | `PasswordResetManager` | Direct password reset (no OTP). |
| `src/admin.ts` | `AdminManager` | Approvals, hardware request queue, audit stream, inventory actions, user inspector. |
| `src/admin-audit.ts` | *(pure helpers)* | Audit category table, filters, counts, and card HTML for `admin.ts`. |
| `src/hardware-ledger.ts` | `HardwareLedgerManager` | Issue/return ledger table (admin ledger or member history). |
| `src/profile-view.ts` | `ProfileViewManager` | Profile HUD: loans, requests, history, quota. |
| `src/profile-edit.ts` | `ProfileEditManager` | Profile edit modal, avatar upload. |
| `src/team-showcase.ts` | `TeamShowcaseManager` | “Meet the Developers” carousel. |
| `src/notification-center.ts` | `NotificationCenterManager` | Header notification dropdown + unread state. |
| `src/theme.ts` | `ThemeManager` | Theme apply/persist (`light` / `mono` / `decent`). |
| `src/auto-cache.ts` | `AutoCacheManager` | One-shot startup cache sanitizer. |
| `src/types.ts` | *(types)* | Frontend domain types. |
| `src/ui/modal-templates.ts` | *(pure helpers)* | Small HTML builders used by modals. |
| `src/style.css` | — | All styling and the three theme systems (still one large file). |

> `src/terminal.ts` (`TerminalSimulator`) was removed — its target element was never in `index.html`.

## Conventions when editing

- **One manager per file.** Keep a module focused on its manager; put shared logic in `src/core/`.
- **Shared state:** never assign to `inventory`/`logs`/`requests`/`selectedItem` directly from another module — call the `set*` helpers in `core/state.ts`.
- **HTML injection:** always wrap dynamic values in `escapeHtml()`.
- **Cross-module imports are fine** (there are circular imports), but only reference another module's symbols **inside function/method bodies** — never at module load time (that would hit the temporal dead zone).
- **Icons:** call the ambient `lucide.createIcons()`; the safe wrapper is installed in `core/ui.ts`.
- **`git`-ignored:** `.env`, `.env.local`, `node_modules/`, `dist/`.

## Verify a change

```bash
npm install          # root deps (first time)
npx tsc -p tsconfig.json   # typecheck (tsconfig has noEmit)
npm run build              # tsc + vite production build
npm run dev:frontend       # Vite dev server on http://localhost:5173
```

The backend is separate; see `docs/BACKEND_HANDOFF.md`. If no local `backend/.env`
exists, point local dev at the deployed API with a git-ignored `.env.local`:

```
VITE_API_BASE=https://cicr-inventory-backend.onrender.com/api
```
