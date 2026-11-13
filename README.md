# Skills Up: backend (NestJS)

REST API for the Skills Up platform. It implements `docs/backend_structure.pdf` (same text in `docs/backend_structure.txt`): roles, tables,
business rules with exact numbers, formulas and the endpoint list.

## Run

```bash
cd backend
npm install
cp .env.example .env      # defaults work for local development
npm run start:dev         # http://localhost:4000/api/v1   (Swagger: http://localhost:4000/api/docs)
```

- **Database:** with an empty `DATABASE_URL` it uses a local file database (`data/dev.sqlite`, pure JS via sql.js, nothing to install).
  For PostgreSQL set `DATABASE_URL=postgres://user:password@localhost:5432/skillsup`. Tables are created automatically
  (`synchronize`); use migrations in production.
- **Demo data:** when the database is empty and `SEED_DEMO` is not `false`, the demo accounts, groups, rooms, lessons, homework in
  every state, payments and content are created. Delete `data/dev.sqlite` to start over.
- **Demo logins** (development only!): `admin` / `admin123`, `dilnoza.rahimova` / `ustoz123`, `bekzod.rahimov` / `oquvchi123`.
- **Frontend:** the React app lives in the separate repository https://github.com/HusanMax/Skills-Up (folder `frontend/`). CORS allows `CORS_ORIGIN` (default `http://localhost:3000`).

## File storage: Cloudflare R2 (or the local folder)

With `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` set in `.env`, uploads go to a Cloudflare R2 bucket;
with them empty, files stay in `UPLOAD_DIR` (good for local work, but **lost on free hosting**, so use R2 there).

1. Cloudflare dashboard -> R2 -> **Create bucket** (e.g. `skillsup-files`). Leave it **private**.
2. R2 -> **Manage R2 API Tokens** -> create a token with **Object Read & Write** for that bucket. Copy the **Access Key ID** and the
   **Secret Access Key** (shown only once).
3. Fill `backend/.env` (it is git-ignored; never commit or share the keys):

```env
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=skillsup-files
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

4. Restart the backend: the log says `Files are stored in Cloudflare R2`. On Render put the same four variables in *Environment*.

The bucket stays private: `GET /files/:id` checks who may open the file, reads it from R2 (with the browser's `Range`, so videos can be
played and skipped through) and passes it on. Files saved before R2 was turned on keep working (each row remembers where its bytes are).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run start:dev` | run with reload |
| `npm run build` / `npm start` | compile to `dist/` and run it |
| `npm run typecheck` | TypeScript check |
| `npm run test:smoke` | end-to-end test of the whole API (see below) |

Smoke test (123 checks: login and roles, guards, student/teacher/admin flows, files, rules). Start a server on an EMPTY database
with a high login limit, then run it:

```bash
rm -f data/dev.sqlite && LOGIN_RATE_LIMIT=1000 PORT=4001 npm run start:dev
API=http://localhost:4001/api/v1 npm run test:smoke
```

## How it is organised

```
src/
  main.ts              prefix /api/v1, CORS, global validation pipe, error filter, Swagger
  app.module.ts        modules + global guards: rate limit -> session token (401) -> roles (403)
  core.module.ts       global module with the domain services and the /me, /files, content endpoints
  config/              rules.ts (every business-rule number), database.ts
  common/              @Roles / @Public / @CurrentUser, SessionAuthGuard, RolesGuard, error filter, validation pipe
  entities/            TypeORM entities (users, groups, lessons, homework, content)
  auth/                POST /auth/login (the role comes from the account), session tokens (SessionsService)
  users/ files/ notifications/ content/   accounts and settings, uploads (type/size rules), notifications, read-only content
  rooms/ groups/       rooms, schedule rules (room busy, teacher clash), enrolment, capacity
  lessons/ homework/ exams/ rewards/ payments/   the business rules (attendance lock, grading, late penalty, exam admission, XP, payment notices)
  student/ teacher/ admin/   controllers per role (+ the services that build their pages)
  seed/                demo data
```

## Rules worth knowing

- **Roles:** `/student/*` only STUDENT, `/teacher/*` only TEACHER, `/admin/*` only ADMIN (403 otherwise). Student endpoints always
  use the user id from the token. A teacher only touches the groups they teach.
- **Sessions, not JWT:** logging in creates a random token; only its SHA-256 hash is stored (table `sessions`) with an expiry (`SESSION_HOURS`, default 12). The client sends `Authorization: Bearer <token>`. Logout, a password change or the expiry ends the session on the server at once. No `JWT_SECRET` is needed.
- **Safety guard:** a remote `DATABASE_URL` (Neon...) is refused on a developer's computer unless `ALLOW_REMOTE_DB=true`; on Render it works as usual. Keep `DATABASE_URL` empty in your local `.env` so tests never touch real data.
- **Admin account from the environment:** set `ADMIN_LOGIN` (default `admin`) and `ADMIN_PASSWORD` (at least 8 characters) in `.env` / on Render. On every start the backend makes the database match them: it creates the admin when missing, or replaces the password when it differs (that admin's sessions end). Login then just checks the typed password. The password never lives in the code. Leave `ADMIN_PASSWORD` empty to leave the admin alone.
- **Login:** a wrong login or password always gives the same 401 message; login attempts are rate limited (`LOGIN_RATE_LIMIT`
  per minute). Passwords are stored as bcrypt hashes and never returned.
- **Errors** always look like `{ "error": { "code", "message", "fields?" } }`.
- **Money** is whole so'm. **Dates** are ISO 8601.
- Rewards (XP, kumush, level, ranking) are computed from attendance and balls, not stored.
