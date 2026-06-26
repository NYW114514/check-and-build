# Check and Build

Check and Build is an internal development management platform for Checkit Analytics subscribers. Subscribers submit customized financial tool requests (e.g., DCF models, data scrapers, dashboards) through an AI-assisted intake process. An internal tiered development team (L1/L2/L3) claims, builds, reviews, and delivers these requests through a gamified point-based economy.

## Tech Stack

- Next.js 15 + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase (PostgreSQL)
- Vercel (deployment)
- Fireworks AI (AI intake and task generation)

## Project Structure
app/

├── admin/        # Admin panel (project management, task breakdown, user management)

├── api/          # Backend API routes (AI intake, document parsing, task suggestion)

├── archive/      # Read-only project snapshot page

├── assembly/     # L3 project-level review page

├── dashboard/    # Role-based home page

├── intake/       # Subscriber AI intake page

├── profile/      # Points and transaction history

├── projects/     # Developer project browser

├── review/       # L2/L3 review queue

└── tasks/        # Task submission page
lib/

├── context/      # Global user state

├── services/     # Database service layer (projects, tasks, reviews, submissions, points, users)

└── types/        # Type definitions

## Local Development

```bash
npm install
npm run dev
```

Or run `start-dev.bat` directly.