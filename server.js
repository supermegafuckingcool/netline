const { PrismaClient } = require("@prisma/client");
const http = require("http");
const fs   = require("fs");
const path = require("path");

const prisma = new PrismaClient();
const PORT   = process.env.PORT || 3000;

const mimeTypes = {
    ".html": "text/html",
    ".js":   "text/javascript",
    ".css":  "text/css",
    ".json": "application/json",
    ".ico":  "image/x-icon",
    ".png":  "image/png",
    ".svg":  "image/svg+xml",
    ".gif":  "image/gif",
};

const SECURITY_HEADERS = {
    "X-Content-Type-Options":  "nosniff",
    "X-Frame-Options":         "DENY",
    "Referrer-Policy":         "no-referrer",
    "Cache-Control":           "no-store",
};

const VALID_TYPES      = ["fw","router","switch","server","workstation","client","iot","unknown"];
const VALID_ACTORS     = ["blue","red","grey"];
const VALID_SEVERITIES = ["none","low","medium","high","critical"];

const MAX_BODY = 2 * 1024 * 1024; // 2 MB

// ── Helpers ──────────────────────────────────────────────────────────────────

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "", size = 0;
        req.on("data", chunk => {
            size += chunk.length;
            if (size > MAX_BODY) { req.destroy(); return reject(new Error("Request body too large")); }
            body += chunk;
        });
        req.on("end",   () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
        req.on("error", reject);
    });
}

function json(res, status, data) {
    res.writeHead(status, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    res.end(JSON.stringify(data));
}

// Get or create the Default graph, return its id
async function ensureDefaultGraph() {
    let g = await prisma.graph.findFirst({ where: { name: "Default" } });
    if (!g) g = await prisma.graph.create({ data: { name: "Default" } });
    return g.id;
}

// Assemble {nodes, links} for a given graphId
async function buildGraph(graphId) {
    const [dbNodes, dbLinks] = await Promise.all([
        prisma.node.findMany({ where: { graphId }, include: { ips: true } }),
        prisma.link.findMany({
            where: { sourceNode: { graphId } },
        }),
    ]);

    const nodes = dbNodes.map(n => ({
        id: n.id, hostname: n.hostname, system: n.system,
        type: n.type, graphId: n.graphId,
        ips: n.ips.map(i => ({ address: i.address, subnet: i.subnet })),
        connections: [],
    }));

    const connMap = {};
    dbLinks.forEach(l => {
        if (!connMap[l.source]) connMap[l.source] = [];
        connMap[l.source].push(l.target);
    });
    nodes.forEach(n => { n.connections = connMap[n.id] || []; });

    const links = dbLinks.map(l => ({ source: l.source, target: l.target, label: l.label || "" }));
    return { nodes, links };
}

// Resolve a connection ref (IP or node ID) to a node ID within a graph
async function resolveRef(ref, graphId) {
    const byIp = await prisma.nodeIp.findFirst({
        where: { address: ref, node: { graphId } },
    });
    if (byIp) return byIp.nodeId;
    const byId = await prisma.node.findFirst({ where: { id: ref, graphId } });
    if (byId) return byId.id;
    return ref;
}

function parseGraphId(url) {
    const u = new URL(url, "http://localhost");
    const g = u.searchParams.get("graphId");
    if (!g) return null;
    const n = parseInt(g, 10);
    return isNaN(n) ? null : n;
}

// ── Request handler ───────────────────────────────────────────────────────────

http.createServer(async (req, res) => {
    try {
        const urlObj = new URL(req.url, "http://localhost");
        const pathname = urlObj.pathname;

        // ── GET /graphs ─────────────────────────────────────────────────────
        if (req.method === "GET" && pathname === "/graphs") {
            const graphs = await prisma.graph.findMany({ orderBy: { createdAt: "asc" } });
            return json(res, 200, graphs);
        }

        // ── POST /create-graph ──────────────────────────────────────────────
        if (req.method === "POST" && pathname === "/create-graph") {
            const { name } = await readBody(req);
            if (!name || !name.trim()) return json(res, 400, { error: "Name required." });
            const graph = await prisma.graph.create({ data: { name: name.trim() } });
            return json(res, 200, { ok: true, graph });
        }

        // ── POST /rename-graph ──────────────────────────────────────────────
        if (req.method === "POST" && pathname === "/rename-graph") {
            const { id, name } = await readBody(req);
            if (!name || !name.trim()) return json(res, 400, { error: "Name required." });
            const gid = parseInt(id, 10);
            if (isNaN(gid)) return json(res, 400, { error: "Invalid graph id." });
            const graph = await prisma.graph.update({ where: { id: gid }, data: { name: name.trim() } });
            return json(res, 200, { ok: true, graph });
        }

        // ── POST /delete-graph ──────────────────────────────────────────────
        if (req.method === "POST" && pathname === "/delete-graph") {
            const { id } = await readBody(req);
            const gid = parseInt(id, 10);
            if (isNaN(gid)) return json(res, 400, { error: "Invalid graph id." });
            const count = await prisma.graph.count();
            if (count <= 1) return json(res, 400, { error: "Cannot delete the last graph." });
            // Cascade deletes nodes → ips, links, notes, events
            await prisma.graph.delete({ where: { id: gid } });
            return json(res, 200, { ok: true });
        }

        // ── GET /graph?graphId=X ────────────────────────────────────────────
        if (req.method === "GET" && pathname === "/graph") {
            let graphId = parseGraphId(req.url);
            if (!graphId) graphId = await ensureDefaultGraph();
            const graph = await buildGraph(graphId);
            return json(res, 200, graph);
        }

        // ── POST /add-node ──────────────────────────────────────────────────
        if (req.method === "POST" && pathname === "/add-node") {
            const newNode = await readBody(req);
            const graphId = newNode.graphId || await ensureDefaultGraph();

            const exists = await prisma.node.findUnique({ where: { id: newNode.id } });
            if (exists) return json(res, 400, { error: `Node id "${newNode.id}" already exists.` });
            if (!VALID_TYPES.includes(newNode.type)) return json(res, 400, { error: "Invalid node type." });
            if (!newNode.hostname || !newNode.system) return json(res, 400, { error: "hostname and system are required." });

            const connections = [];
            if (Array.isArray(newNode.connections)) {
                for (const ref of newNode.connections) connections.push(await resolveRef(ref, graphId));
            }
            const ips = Array.isArray(newNode.ips) ? newNode.ips : [];

            await prisma.$transaction(async tx => {
                await tx.node.create({
                    data: {
                        id: newNode.id, hostname: newNode.hostname,
                        system: newNode.system, type: newNode.type, graphId,
                        ips: { create: ips.map(i => ({ address: i.address, subnet: i.subnet || "" })) },
                    }
                });
                for (const target of connections) {
                    const exists = await tx.node.findFirst({ where: { id: target, graphId } });
                    if (exists) await tx.link.upsert({
                        where:  { source_target: { source: newNode.id, target } },
                        update: {},
                        create: { source: newNode.id, target, label: "" },
                    });
                }
            });

            return json(res, 200, { ok: true, node: { ...newNode, ips, connections, graphId } });
        }

        // ── POST /edit-node ─────────────────────────────────────────────────
        if (req.method === "POST" && pathname === "/edit-node") {
            const { originalId, node } = await readBody(req);
            const existing = await prisma.node.findUnique({ where: { id: originalId } });
            if (!existing) return json(res, 400, { error: `Node "${originalId}" not found.` });
            const graphId = existing.graphId;

            const connections = [];
            if (Array.isArray(node.connections)) {
                for (const ref of node.connections) connections.push(await resolveRef(ref, graphId));
            }
            const ips = Array.isArray(node.ips) ? node.ips : [];
            const newId = `${node.system}-${node.hostname}`;
            node.id = newId;

            await prisma.$transaction(async tx => {
                if (newId !== originalId) {
                    await tx.node.create({
                        data: { id: newId, hostname: node.hostname, system: node.system, type: node.type, graphId }
                    });
                    await tx.nodeIp.updateMany({ where: { nodeId: originalId }, data: { nodeId: newId } });
                    await tx.link.updateMany({ where: { target: originalId }, data: { target: newId } });
                    await tx.note.updateMany({ where: { nodeId: originalId }, data: { nodeId: newId } });
                    await tx.event.updateMany({ where: { nodeId: originalId }, data: { nodeId: newId } });
                    await tx.node.delete({ where: { id: originalId } });
                } else {
                    await tx.node.update({
                        where: { id: originalId },
                        data:  { hostname: node.hostname, system: node.system, type: node.type },
                    });
                }
                await tx.nodeIp.deleteMany({ where: { nodeId: newId } });
                for (const ip of ips) {
                    await tx.nodeIp.create({ data: { nodeId: newId, address: ip.address, subnet: ip.subnet || "" } });
                }
                await tx.link.deleteMany({ where: { source: newId } });
                for (const target of connections) {
                    const exists = await tx.node.findFirst({ where: { id: target, graphId } });
                    if (exists) await tx.link.upsert({
                        where:  { source_target: { source: newId, target } },
                        update: {},
                        create: { source: newId, target, label: "" },
                    });
                }
            });

            return json(res, 200, { ok: true, node: { ...node, ips, connections, graphId } });
        }

        // ── POST /delete-node ───────────────────────────────────────────────
        if (req.method === "POST" && pathname === "/delete-node") {
            const { id } = await readBody(req);
            await prisma.node.delete({ where: { id } });
            return json(res, 200, { ok: true });
        }

        // ── POST /save-graph ────────────────────────────────────────────────
        if (req.method === "POST" && pathname === "/save-graph") {
            const body = await readBody(req);
            const { graph, graphId: gid } = body;
            if (!graph || !graph.nodes || !graph.links) return json(res, 400, { error: "Missing nodes or links" });
            const graphId = parseInt(gid, 10) || await ensureDefaultGraph();

            await prisma.$transaction(async tx => {
                await tx.event.deleteMany({ where: { node: { graphId } } });
                await tx.node.deleteMany({ where: { graphId } });
                // Batch-create nodes then IPs, much faster than sequential creates
                const nodeRows = graph.nodes.map(n => ({
                    id: n.id, hostname: n.hostname || "", system: n.system || "",
                    type: VALID_TYPES.includes(n.type) ? n.type : "unknown", graphId,
                }));
                if (nodeRows.length) await tx.node.createMany({ data: nodeRows, skipDuplicates: true });

                const ipRows = [];
                for (const n of graph.nodes) {
                    const ips = Array.isArray(n.ips) ? n.ips
                        : n.ip ? [{ address: n.ip.replace(/\/\d+$/, ""), subnet: n.subnet || "" }] : [];
                    for (const ip of ips) {
                        ipRows.push({ nodeId: n.id, address: ip.address, subnet: ip.subnet || "" });
                    }
                }
                if (ipRows.length) await tx.nodeIp.createMany({ data: ipRows, skipDuplicates: true });

                const linkRows = graph.links.map(l => ({
                    source: typeof l.source === "object" ? l.source.id : l.source,
                    target: typeof l.target === "object" ? l.target.id : l.target,
                    label:  l.label || "",
                }));
                if (linkRows.length) await tx.link.createMany({ data: linkRows, skipDuplicates: true });
            });
            return json(res, 200, { ok: true });
        }

        // ── GET /notes?graphId=X ────────────────────────────────────────────
        if (req.method === "GET" && pathname === "/notes") {
            const graphId = parseGraphId(req.url) || await ensureDefaultGraph();
            const notes = await prisma.note.findMany({ where: { node: { graphId } } });
            const result = {};
            notes.forEach(n => { result[n.nodeId] = n.content; });
            return json(res, 200, result);
        }

        // ── POST /save-note ─────────────────────────────────────────────────
        if (req.method === "POST" && pathname === "/save-note") {
            const { id, notes } = await readBody(req);
            const noteNode = await prisma.node.findUnique({ where: { id } });
            if (!noteNode) return json(res, 400, { error: `Node "${id}" not found.` });
            if (notes && notes.trim()) {
                await prisma.note.upsert({
                    where:  { nodeId: id },
                    update: { content: notes },
                    create: { nodeId: id, content: notes },
                });
            } else {
                await prisma.note.deleteMany({ where: { nodeId: id } });
            }
            return json(res, 200, { ok: true });
        }

        // ── POST /import ────────────────────────────────────────────────────
        if (req.method === "POST" && pathname === "/import") {
            const body = await readBody(req);
            const { graph, graphId: gid } = body;
            if (!graph || !graph.nodes || !graph.links) return json(res, 400, { error: "Missing nodes or links" });
            const graphId = parseInt(gid, 10) || await ensureDefaultGraph();

            let imported = 0;
            await prisma.$transaction(async tx => {
                for (const n of graph.nodes) {
                    const ips = Array.isArray(n.ips) ? n.ips
                        : n.ip ? [{ address: n.ip.replace(/\/\d+$/, ""), subnet: n.subnet || "" }] : [];
                    await tx.node.upsert({
                        where:  { id: n.id },
                        update: { hostname: n.hostname, system: n.system, type: n.type || "unknown" },
                        create: {
                            id: n.id, hostname: n.hostname, system: n.system,
                            type: n.type || "unknown", graphId,
                            ips: { create: ips.map(i => ({ address: i.address, subnet: i.subnet || "" })) },
                        },
                    });
                    imported++;
                }
                for (const l of graph.links) {
                    const source = typeof l.source === "object" ? l.source.id : l.source;
                    const target = typeof l.target === "object" ? l.target.id : l.target;
                    await tx.link.upsert({
                        where:  { source_target: { source, target } },
                        update: {},
                        create: { source, target, label: l.label || "" },
                    });
                }
            });
            return json(res, 200, { ok: true, imported });
        }

        // ── GET /events?graphId=X ───────────────────────────────────────────
        if (req.method === "GET" && pathname === "/events") {
            const graphId = parseGraphId(req.url) || await ensureDefaultGraph();
            const events = await prisma.event.findMany({
                where: { node: { graphId } },
                orderBy: { datetime: "asc" },
            });
            return json(res, 200, events.map(e => ({
                id: e.id, nodeId: e.nodeId,
                datetime: e.datetime.toISOString(),
                description: e.description, actor: e.actor, severity: e.severity,
                mitre: e.mitre, tool: e.tool, cve: e.cve, srcIp: e.srcIp, dstIp: e.dstIp,
            })));
        }

        // ── POST /add-event ─────────────────────────────────────────────────
        if (req.method === "POST" && pathname === "/add-event") {
            const body = await readBody(req);
            const nodeExists = await prisma.node.findUnique({ where: { id: body.nodeId } });
            if (!nodeExists) return json(res, 400, { error: `Node "${body.nodeId}" not found.` });
            if (body.actor   && !VALID_ACTORS.includes(body.actor))       return json(res, 400, { error: "Invalid actor." });
            if (body.severity && !VALID_SEVERITIES.includes(body.severity)) return json(res, 400, { error: "Invalid severity." });
            const event = await prisma.event.create({
                data: {
                    nodeId: body.nodeId, datetime: new Date(body.datetime),
                    description: body.description || "", actor: body.actor || "blue",
                    severity: body.severity || "none", mitre: body.mitre || "",
                    tool: body.tool || "", cve: body.cve || "",
                    srcIp: body.srcIp || "", dstIp: body.dstIp || "",
                }
            });
            return json(res, 200, { ok: true, event: { ...event, datetime: event.datetime.toISOString() } });
        }

        // ── POST /edit-event ────────────────────────────────────────────────
        if (req.method === "POST" && pathname === "/edit-event") {
            const body = await readBody(req);
            const eventId = parseInt(body.id, 10);
            if (isNaN(eventId)) return json(res, 400, { error: "Invalid event id" });
            if (body.actor    && !VALID_ACTORS.includes(body.actor))       return json(res, 400, { error: "Invalid actor." });
            if (body.severity && !VALID_SEVERITIES.includes(body.severity)) return json(res, 400, { error: "Invalid severity." });
            const event = await prisma.event.update({
                where: { id: eventId },
                data: {
                    datetime: new Date(body.datetime), description: body.description || "",
                    actor: body.actor || "blue", severity: body.severity || "none",
                    mitre: body.mitre || "", tool: body.tool || "",
                    cve: body.cve || "", srcIp: body.srcIp || "", dstIp: body.dstIp || "",
                }
            });
            return json(res, 200, { ok: true, event: { ...event, datetime: event.datetime.toISOString() } });
        }

        // ── POST /delete-event ──────────────────────────────────────────────
        if (req.method === "POST" && pathname === "/delete-event") {
            const { id } = await readBody(req);
            const eventId = parseInt(id);
            if (isNaN(eventId)) return json(res, 400, { error: "Invalid event id" });
            await prisma.event.delete({ where: { id: eventId } });
            return json(res, 200, { ok: true });
        }

        // ── GET /health ─────────────────────────────────────────────────────
        if (req.method === "GET" && pathname === "/health") {
            return json(res, 200, { ok: true, uptime: process.uptime() });
        }

        // ── 405 for known API routes hit with wrong method ─────────────────
        const apiRoutes = ["/graphs","/graph","/create-graph","/rename-graph",
            "/delete-graph","/add-node","/edit-node","/delete-node","/save-graph",
            "/notes","/save-note","/import","/events","/add-event","/edit-event",
            "/delete-event","/health"];
        if (apiRoutes.includes(pathname)) {
            return json(res, 405, { error: "Method not allowed" });
        }

        // ── Static file serving ─────────────────────────────────────────────
        const publicRoot = path.resolve("./public");
        let rawPath = urlObj.pathname;
        if (rawPath === "/" || rawPath === "") rawPath = "/index.html";
        const filePath = path.resolve(publicRoot, "." + rawPath);
        if (!filePath.startsWith(publicRoot + path.sep) && filePath !== publicRoot) {
            res.writeHead(403, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
            return res.end("403 - Forbidden");
        }
        const extname     = String(path.extname(filePath)).toLowerCase();
        const contentType = mimeTypes[extname] || "application/octet-stream";
        // Assets (JS/CSS/images) are versioned by filename — safe to cache.
        // HTML is never cached so the app shell always stays fresh.
        const cacheControl = (extname === ".html" || extname === "")
            ? "no-store"
            : "public, max-age=86400, stale-while-revalidate=3600";
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(404, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
                res.end("404 - File not found");
            } else {
                res.writeHead(200, { "Content-Type": contentType,
                    ...SECURITY_HEADERS, "Cache-Control": cacheControl });
                res.end(content, "utf-8");
            }
        });

    } catch (e) {
        console.error("Unhandled error:", e);
        json(res, 500, { error: "Internal server error" });
    }

}).listen(PORT, async () => {
    // Ensure a Default graph exists on first run
    const count = await prisma.graph.count();
    if (count === 0) {
        await prisma.graph.create({ data: { name: "Default" } });
        console.log("Created Default graph");
    }
    console.log(`Netline running at http://localhost:${PORT}`);
});

async function shutdown() {
    await prisma.$disconnect();
    process.exit(0);
}
process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", e => { console.error("Uncaught:", e); shutdown(); });
