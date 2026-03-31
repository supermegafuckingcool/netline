# Netline

Self-hosted network graph documentation tool. Runs in docker. 

---

## Starting the app

```bash
chmod +x start.sh
sudo ./start.sh
```

Open http://localhost:3000

---

## Offline deployment

On a machine with internet, build and export the images:

```bash
sudo ./start.sh --export-images
```

This saves two files alongside the repo:
- `netline-app.tar.gz`
- `netline-mysql.tar.gz`

Copy the entire project folder and both tar files to the target machine, then:

```bash
sudo ./start.sh
```

The script detects the tar files and loads them automatically — no internet needed.

---

## Importing a graph.json

If you have an existing `graph.json` from a previous version or another tool:

```bash
docker compose cp ./graph.json app:/app/graph.json
docker compose exec app node scripts/import.js /app/graph.json
```

The import is non-destructive — existing nodes and links are preserved.

---

## Browsing the database

```bash
# Visual browser (opens at http://localhost:5555)
docker compose exec app npx prisma studio

# MySQL shell
docker compose exec db mysql -u netline --password=netlinepassword netline
```

---

## Viewing logs

```bash
docker compose logs -f app
docker compose logs -f db
```

---

## API endpoints

| Method | Path           | Description                               |
|--------|----------------|-------------------------------------------|
| GET    | /graph         | Full graph as `{nodes, links}`            |
| POST   | /add-node      | Add a node                                |
| POST   | /edit-node     | Edit a node (updates ID if name changed)  |
| POST   | /delete-node   | Delete a node (cascades links/IPs/note)   |
| POST   | /save-graph    | Replace entire graph (from JSON editor)   |
| POST   | /import        | Non-destructive graph import              |
| GET    | /notes         | All notes as `{nodeId: content}`          |
| POST   | /save-note     | Save or delete a note                     |

---

## Environment variables

Defaults work out of the box. Override by editing `.env`:

```
MYSQL_ROOT_PASSWORD=rootpassword
MYSQL_PASSWORD=netlinepassword
PORT=3000
```
