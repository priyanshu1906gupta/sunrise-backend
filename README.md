# Sunrise Coaching Khargone — Backend

Node.js + TypeScript REST API (Express + Prisma + MySQL) for the Sunrise Coaching Khargone ERP.

## Prerequisites

- Node.js 18+
- MySQL with database `sunrise_coaching`

## Quick start

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

API: **http://localhost:3000/api**

## GoDaddy (Node.js git deploy)

Same layout as Fitness Freaks: this repo is the application root. The Angular production build is copied to `public/app` (`baseHref` `/app/`, API `/api`). `/` redirects to `/app/` until a marketing landing is added.

1. On this PC (Node 22): from the workspace root
   - `npm run build` in `sunrise-frontend`
   - `npm run build` in `sunrise-backend` (compiles the API and copies `public/app`)
2. Commit `public/` (the SPA) and push `sunrise-backend` to GitHub.
3. In cPanel **Setup Node.js App**:
   - Application root: the cloned `sunrise-backend` folder
   - Application startup file: `app.js`
   - Node 18+ (20 if available)
   - Environment: paste keys from `.env.production.example` (MySQL, `JWT_SECRET`, SMTP, `PUBLIC_URL`, `CORS_ORIGIN`)
4. Run **NPM Install**, then `npm run build`, then **Restart**.
5. Open `https://YOUR_DOMAIN.com/app/`

Do not set `UPLOAD_BASE_DIR` to `[internal]` on AiroApp. Leave upload paths unset so photos go to `public/assets`.

## Seed logins

- Admin: `admin@sunrise.com` / `Admin@123`
- Teacher: `teacher@sunrise.com` / `Sunriseteacher@123`
- Student: `amit@example.com` / `student@123`

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Production |
| `npm run db:push` | Sync Prisma schema |
| `npm run db:seed` | Dummy data |
