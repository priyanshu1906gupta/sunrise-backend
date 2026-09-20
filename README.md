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
