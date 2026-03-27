# Netline

Network graph documentation tool. Self-hosted, runs anywhere Docker is available.

## Quick start

```bash
# 1. Clone / copy the project files
# 2. Copy the example env file
cp .env.example .env

# 3. Start everything (builds the app, starts MySQL, runs migrations)
docker compose up --build
```

Open http://localhost:3000

To run on a different port: edit `PORT` in your `.env` file.

---

## Importing an existing graph.json

If you have a existing `graph.json`:

```bash
# While the containers are running:
docker compose exec app node scripts/import.js /path/to/graph.json

# Or from outside the container, copy the file in first:
docker compose cp ./graph.json app:/app/graph.json
docker compose exec app node scripts/import.js /app/graph.json
```

The import is non-destructive — it upserts nodes and links, so existing data is preserved.

You can also POST to `/import` directly with a JSON body in the same `{nodes, links}` format.

---

## Development (without Docker)

You'll need MySQL running locally. Set `DATABASE_URL` in a `.env` file:

```
DATABASE_URL=mysql://user:password@localhost:3306/netline
```

Then:

```bash
npm install
npx prisma migrate dev --name init   # first time only
npm run dev
```

---

## Database management

```bash
# Open Prisma Studio (visual database browser)
docker compose exec app npm run db:studio

# Run a migration after schema changes
docker compose exec app npx prisma migrate dev --name <migration-name>

sudo docker compose exec db mysql -u root -prootpassword netline
```

---


## API endpoints

| Method | Path          | Description                              |
|--------|---------------|------------------------------------------|
| GET    | /graph        | Returns full graph as `{nodes, links}`   |
| POST   | /add-node     | Add a single node                        |
| POST   | /edit-node    | Edit a node (fields + IPs + connections) |
| POST   | /delete-node  | Delete a node (cascades links/ips/note)  |
| POST   | /save-graph   | Replace entire graph (from JSON editor)  |
| POST   | /import       | Non-destructive graph import             |
| GET    | /notes        | Get all notes as `{nodeId: content}`     |
| POST   | /save-note    | Save or delete a note for a node         |

