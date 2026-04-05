# AluNotes Web App (PWA)

This is the control plane UI for the AluNotes Bluetooth Bridge. It exposes a frontend for managing and viewing Bluetooth recordings, notes, tasks, and an interactive Excalidraw whiteboard.

## Stack Overview
- **Framework**: Next.js 15 (App Router, React 19)
- **API Engine**: oRPC with TanStack Query
- **Styling**: Tailwind CSS v4 featuring the "Ethereal Curator" glassmorphism design system.
- **Database**: Prisma with SQLite
- **Auth**: Better Auth (Google OAuth + Email/Password) *(Note: check environment variables)*

## Setup

```bash
cd alunotes-bt-web
cp .env.example .env
pnpm install
pnpm db:push
```

## Running the Web App

The app runs out-of-the-box connected to the local Go daemon audio bridge API.
```bash
pnpm dev
# The web app will start on http://localhost:3000
```
