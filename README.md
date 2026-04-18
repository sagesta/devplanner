# DevPlanner

![1-Minute Guide](URL) <!-- Placeholder for your video guide -->

DevPlanner is an intelligent, behavior-aware task planner designed specifically for developers. Built with a calm, modern aesthetic, it helps you seamlessly balance deep work and shallow tasks based on your energy levels and available capacity. DevPlanner automatically adapts to your workflow, learns your peak productivity windows, and shields you from scheduling churn.

## Why DevPlanner?
- **Intelligent Scheduling (3-Level Hierarchy)**: Organizes your work neatly into Sprints → Tasks → Subtasks. (Subtasks are the atomic units of execution).
- **Behavior-Aware Load Balancing**: Adapts your daily/weekly goals to your historical completion behavior instead of setting rigid, punitive deadlines.
- **Cognitive Load Modeling**: Matches tasks to your physical energy and work depth. (e.g. Deep Work vs Admin, High vs Low Energy).
- **Rich Calendar Sync**: Deep two-way integration with both Google Calendar and CalDAV (Apple Calendar, Radicale, etc).
- **Privacy & Ownership**: Easily self-hostable with Docker, enabling complete control over your productivity data.

## Full Tech Stack
- **Web**: Next.js 14, TailwindCSS, dnd-kit (Kanban Board), Lucide Icons.
- **API**: Hono, Drizzle ORM, Postgres (with pgvector for Semantic AI).
- **Infra**: Docker Compose, Redis (for Worker Queues), Radicale (CalDAV server).

---

## 🚀 Quick Start (Self-Hosting using Docker)

### Prerequisites
- Docker + Docker Compose v2
- A domain pointed at your server (or localhost for dev)
- Google Cloud project with a Web OAuth 2.0 client

### 1. Clone & Configure
```bash
git clone https://github.com/sagesta/devplanner.git
cd devplanner
./setup.sh          # creates .env from .env.example
```
**Required `.env` values:**
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: From Google Cloud Console
- `NEXTAUTH_SECRET`: Run `openssl rand -base64 32`
- `ALLOWED_EMAILS`: Your comma-separated login emails
- `OPENAI_API_KEY`: For AI functionality (optional)

### 2. Start the Stack
```bash
docker compose up -d --build
```
*Wait a few moments for the database to spin up. The API container will automatically run the schema migrations.*

### 3. Seed Initial Data (Optional)
```bash
docker compose exec api npm run seed:start -w @devplanner/api
```
DevPlanner is now running at **[http://localhost:3000](http://localhost:3000)**!

---

## 🛠️ Local Node Development

If you prefer to run the Node tools directly on your host rather than inside Docker:

```bash
cd devplanner
./setup.sh
cp apps/web/.env.local.example apps/web/.env.local

# 1. Start only the background infrastructure (DB, Redis, Radicale)
npm run docker:infra          

# 2. Install dependencies
npm install

# 3. Apply schema & extensions
npm run db:vector             
npm run db:push
npm run seed                  

# 4. Start the dev server!
npm run dev                   
```
*Note for WSL Users: Webpack polling on DrvFS (`/mnt/c/`) can be quite slow. For best performance, keep the repo natively inside your WSL Linux filesystem (e.g. `~/code/devplanner`).*

---

## 📅 Calendar Sync

### Google Calendar Setup
1. In the **Google Cloud Console**, enable the **Google Calendar API**.
2. Add your Authorized redirect URI: `http://localhost:3001/api/sync/google/callback` (or your production API URL).
3. Update `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `WEB_APP_URL`, and `CORS_ORIGIN` in `.env`.
4. In DevPlanner: **Settings → Calendar → Connect Google Calendar**.

### CalDAV (Apple, Radicale)
1. In `.env`, configure `CALDAV_CALENDAR_URL`, `CALDAV_USER`, and `CALDAV_PASSWORD`. (For docker, use `http://radicale:5232/youruser/tasks/`).
2. Run the worker `npm run worker` (if running locally natively) to handle background sync queues.
3. In DevPlanner: **Settings → Calendar → Connect CalDAV**.

---

## License
MIT License. See the [LICENSE](LICENSE) file for more information.
