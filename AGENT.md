# AGENT.md

This file gives AI coding agents (and new contributors) the context needed to work
productively in the **CICR VAULT / cicr-inventory** codebase.

## 1. What this project is

CICR VAULT is the inventory management system for the Creative & Innovative Cell in
Robotics (CICR). It lets club members browse a hardware
catalog (microcontrollers, sensors, actuators, power, tools etc), borrow and return items,
and gives admins a dashboard with stock stats and an audit trail.

- Live demo: https://cicrinventory.vercel.app/
- Repo: https://github.com/simplyvardaan/cicr-inventory

## 2. Tech stack

| Layer      | Tech                                                              |
| ---------- | ------------------------------------------------------------------ |
| Frontend   | TypeScript, Vite, HTML5/CSS3 (vanilla, no framework), Three.js    |
| Backend    | Node.js, Express, TypeScript                                      |
| Database   | Supabase (hosted PostgreSQL), accessed via `@supabase/supabase-js` |
| Auth       | Custom JWT (jsonwebtoken) + bcryptjs password hashing              |
| Deployment | Vercel                                                             |

## 3. Repository layout

```
cicr-inventory/
├── src/                        # Frontend (Vite + TS), served from index.html
│   ├── main.ts                 # Entry: manager imports, window wiring, DOMContentLoaded bootstrap
│   ├── core/                   # Shared helpers: state, api, ui, session, identity, domain
│   ├── admin-audit.ts          # Pure audit-stream helpers used by admin.ts
│   ├── ui/                     # Pure HTML builders (modal-templates.ts)
│   ├── toast.ts … theme.ts     # One module per manager (Toast, Modal, Admin, Auth, …)
│   ├── types.ts                # Frontend domain types
│   ├── style.css               # Styling + the three theme systems
│   └── assets/
├── public/                     # Static assets
├── backend/                    # Express + TypeScript API
│   ├── config/
│   │   └── supabase.ts         # NOTE: also boots an Express server — see §6 caveats
│   ├── .env.example            # PORT, SUPABASE_URL, SUPABASE_KEY, JWT_SECRET
│   └── src/
│       ├── app.ts              # Main Express app: mounts routes, creates Supabase client
│       ├── server.ts           # Entrypoint: imports app, calls app.listen()
│       ├── middleware/
│       │   └── auth.middleware.ts   # authenticateToken, requireAdmin
│       ├── modules/            # ACTIVE code — organized by feature
│       │   ├── auth/           # register, login, getProfile
│       │   ├── inventory/      # CRUD for hardware items
│       │   ├── borrow/         # borrow / return / history
│       │   └── dashboard/      # stats + audit log feed
│       ├── controllers/        # LEGACY/empty stubs — do not build on these
│       ├── routes/             # LEGACY/empty stubs — do not build on these
│       └── services/
│           ├── app.ts          # LEGACY duplicate of src/app.ts — unused by server.ts
│           ├── inventory.service.ts  # empty stub
│           └── borrow.service.ts
├── index.html
├── package.json                 # frontend package.json (root)
└── tsconfig.json
```

> The frontend is modular now: `src/main.ts` is only the entry point, each manager
> lives in its own file, and shared code lives in `src/core/`. See
> **`docs/FRONTEND_STRUCTURE.md`** for the full per-module map.

## 4. Where the real logic lives

The actual, wired-up backend logic is under `backend/src/modules/*`. Each module
follows the same shape: `*.routes.ts` defines the Express router, `*.controller.ts`
holds the request handlers and talks to Supabase directly (there is no separate
repository/service layer currently in active use — `backend/src/services/*` and
`backend/src/controllers/*`, `backend/src/routes/*` at the top level are legacy/empty
placeholders left over from an earlier structure).

**When adding features, put new code in `backend/src/modules/<feature>/` following the
existing pattern.** Do not add logic to the top-level `controllers/`, `routes/`, or
`services/` folders — treat them as deprecated until they're cleaned up.

## 5. API surface (mounted in `backend/src/app.ts`)

| Base path      | Module      | Notes                                              |
| -------------- | ----------- | --------------------------------------------------- |
| `/api/auth`    | auth        | `POST /register`, `POST /login`, `GET /profile` (auth required) |
| `/api/items`   | inventory   | CRUD for inventory items; create/update/delete are admin-gated in practice |
| `/api/borrow`  | borrow      | `POST /` (borrow), `POST /return`, `GET /history`  |
| `/api`         | dashboard   | `GET /stats`, `GET /audit`                          |
| `/api/health`  | —           | Health check                                        |

Auth: send `Authorization: Bearer <JWT>`. `authenticateToken` populates `req.user =
{ id, email, role }`. `requireAdmin` restricts a route to `role === 'ADMIN'`.

## 6. Database

Data lives in Supabase Postgres. There are no local migration files in this repo yet —
the schema is inferred from the Supabase queries in the controllers. See
**`docs/ER_DIAGRAM.md`** for the full entity-relationship diagram and column list.

Core tables: `users`, `inventory`, `borrow_records`, `audit_logs`.

Known caveats an agent should be aware of before changing DB-touching code:
- `backend/config/supabase.ts` and `backend/src/server.ts` both call `app.listen()`
  and `testConnection()` — they look like duplicate/legacy entrypoints. The real one
  wired into `package.json`'s `dev`/`start` scripts is `backend/src/server.ts`.
- `available_quantity` on `inventory` is maintained manually in application code
  (decremented on borrow, incremented on return) rather than via a DB constraint or
  trigger — keep this in sync if you touch borrow/return logic.
- `src/types.ts` (frontend) defines an older, simpler shape (`InventoryItem`,
  `BorrowRecord`, `UserDatabase`) that doesn't match the live Supabase schema in
  `docs/ER_DIAGRAM.md`. Treat the Supabase schema as the source of truth for backend
  work; the frontend types likely need updating to match once the frontend is wired to
  the real API.

## 7. Local setup

```bash
# Frontend
npm install
npm run dev            # Vite dev server, usually http://localhost:5173

# Backend
cd backend
npm install
cp .env.example .env   # fill in SUPABASE_URL, SUPABASE_KEY, JWT_SECRET, PORT
npm run dev            # nodemon + ts-node, default http://localhost:5000
```

## 8. Conventions for agents working in this repo

- Follow the `modules/<feature>/{feature}.routes.ts` + `{feature}.controller.ts`
  pattern for any new backend feature.
- Every mutating inventory/borrow action should also write to `audit_logs` (see the
  `logAudit` helper duplicated in `inventory.controller.ts` and `borrow.controller.ts`
  — a good refactor target is extracting this into a shared util).
- Roles are `ADMIN` and `MEMBER` only; gate admin-only routes with `requireAdmin`.
- Keep responses in the existing shape: `{ status: 'success' | 'error', message?,
  data?, count? }`.
- Prefer TypeScript types/interfaces that mirror the actual Supabase columns (see the
  ER diagram) over the older `src/types.ts` shapes when writing new backend code.
