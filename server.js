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
};

// ── Helpers ──────────────────────────────────────────────────────────────────

// Assemble the {nodes, links} shape the frontend expects from DB records
async function buildGraph() {
    const [dbNodes, dbLinks] = await Promise.all([
        prisma.node.findMany({ include: { ips: true } }),
        prisma.link.findMany(),
    ]);

    const nodes = dbNodes.map(n => ({
        id:          n.id,
        hostname:    n.hostname,
        system:      n.system,
        type:        n.type,
        ips:         n.ips.map(i => ({ address: i.address, subnet: i.subnet })),
        connections: [],   // populated below
    }));

    // Rebuild connections arrays from links
    const connMap = {};
    dbLinks.forEach(l => {
        if (!connMap[l.source]) connMap[l.source] = [];
        connMap[l.source].push(l.target);
    });
    nodes.forEach(n => { n.connections = connMap[n.id] || []; });

    const links = dbLinks.map(l => ({
        source: l.source,
        target: l.target,
        label:  l.label || "",
    }));

    return { nodes, links };
}

// Resolve a connection ref (IP or node ID) to a node ID
async function resolveRef(ref) {
    // Try IP match
    const byIp = await prisma.nodeIp.findFirst({ where: { address: ref } });
    if (byIp) return byIp.nodeId;
    // Try ID match
    const byId = await prisma.node.findUnique({ where: { id: ref } });
    if (byId) return byId.id;
    return ref;
}

// ── Request handler ───────────────────────────────────────────────────────────

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end",  () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
        req.on("error", reject);
    });
}

function json(res, status, data) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
}

http.createServer(async (req, res) => {
    try {
        // ── GET /graph ──────────────────────────────────────────────────────
        // Serves the full graph as JSON (replaces the static graph.json file)
        if (req.method === "GET" && req.url.startsWith("/graph")) {
            const graph = await buildGraph();
            return json(res, 200, graph);
        }

        // ── POST /add-node ──────────────────────────────────────────────────
        if (req.method === "POST" && req.url === "/add-node") {
            const newNode = await readBody(req);

            const exists = await prisma.node.findUnique({ where: { id: newNode.id } });
            if (exists) return json(res, 400, { error: `Node id "${newNode.id}" already exists.` });

            // Resolve connections
            const connections = [];
            if (newNode.connections && Array.isArray(newNode.connections)) {
                for (const ref of newNode.connections) {
                    connections.push(await resolveRef(ref));
                }
            }

            const ips = Array.isArray(newNode.ips) ? newNode.ips : [];

            await prisma.$transaction(async tx => {
                await tx.node.create({
                    data: {
                        id:       newNode.id,
                        hostname: newNode.hostname,
                        system:   newNode.system,
                        type:     newNode.type,
                        ips: { create: ips.map(i => ({ address: i.address, subnet: i.subnet || "" })) },
                    }
                });
                for (const target of connections) {
                    // Only create link if target exists
                    const targetExists = await tx.node.findUnique({ where: { id: target } });
                    if (targetExists) {
                        await tx.link.upsert({
                            where:  { source_target: { source: newNode.id, target } },
                            update: {},
                            create: { source: newNode.id, target, label: "" },
                        });
                    }
                }
            });

            const resolvedNode = { ...newNode, ips, connections };
            return json(res, 200, { ok: true, node: resolvedNode });
        }

        // ── POST /edit-node ─────────────────────────────────────────────────
        if (req.method === "POST" && req.url === "/edit-node") {
            const { originalId, node } = await readBody(req);

            const exists = await prisma.node.findUnique({ where: { id: originalId } });
            if (!exists) return json(res, 400, { error: `Node "${originalId}" not found.` });

            // Resolve connections
            const connections = [];
            if (node.connections && Array.isArray(node.connections)) {
                for (const ref of node.connections) {
                    connections.push(await resolveRef(ref));
                }
            }

            const ips = Array.isArray(node.ips) ? node.ips : [];

            await prisma.$transaction(async tx => {
                // Update node fields
                await tx.node.update({
                    where: { id: originalId },
                    data:  { hostname: node.hostname, system: node.system, type: node.type },
                });

                // Replace IPs
                await tx.nodeIp.deleteMany({ where: { nodeId: originalId } });
                for (const ip of ips) {
                    await tx.nodeIp.create({ data: { nodeId: originalId, address: ip.address, subnet: ip.subnet || "" } });
                }

                // Rebuild outgoing links only
                await tx.link.deleteMany({ where: { source: originalId } });
                for (const target of connections) {
                    const targetExists = await tx.node.findUnique({ where: { id: target } });
                    if (targetExists) {
                        await tx.link.upsert({
                            where:  { source_target: { source: originalId, target } },
                            update: {},
                            create: { source: originalId, target, label: "" },
                        });
                    }
                }
            });

            return json(res, 200, { ok: true, node: { ...node, ips, connections } });
        }

        // ── POST /delete-node ───────────────────────────────────────────────
        if (req.method === "POST" && req.url === "/delete-node") {
            const { id } = await readBody(req);
            // Cascade deletes ips, links (both directions), and note via schema
            await prisma.node.delete({ where: { id } });
            return json(res, 200, { ok: true });
        }

        // ── POST /save-graph (JSON editor save) ─────────────────────────────
        // Replaces the entire graph with the submitted JSON
        if (req.method === "POST" && req.url === "/save-graph") {
            const graph = await readBody(req);
            if (!graph.nodes || !graph.links) return json(res, 400, { error: "Missing nodes or links" });

            await prisma.$transaction(async tx => {
                // Clear everything — cascade handles ips, links, notes
                await tx.node.deleteMany();

                for (const n of graph.nodes) {
                    const ips = Array.isArray(n.ips)
                        ? n.ips
                        : n.ip
                            ? [{ address: n.ip.replace(/\/\d+$/, ""), subnet: n.subnet || "" }]
                            : [];
                    await tx.node.create({
                        data: {
                            id:       n.id,
                            hostname: n.hostname,
                            system:   n.system,
                            type:     n.type,
                            ips: { create: ips.map(i => ({ address: i.address, subnet: i.subnet || "" })) },
                        }
                    });
                }

                for (const l of graph.links) {
                    const source = typeof l.source === "object" ? l.source.id : l.source;
                    const target = typeof l.target === "object" ? l.target.id : l.target;
                    await tx.link.upsert({
                        where:  { source_target: { source, target } },
                        update: { label: l.label || "" },
                        create: { source, target, label: l.label || "" },
                    });
                }
            });

            return json(res, 200, { ok: true });
        }

        // ── GET /notes ──────────────────────────────────────────────────────
        if (req.method === "GET" && req.url === "/notes") {
            const notes = await prisma.note.findMany();
            const result = {};
            notes.forEach(n => { result[n.nodeId] = n.content; });
            return json(res, 200, result);
        }

        // ── POST /save-note ─────────────────────────────────────────────────
        if (req.method === "POST" && req.url === "/save-note") {
            const { id, notes } = await readBody(req);
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
        // Same as save-graph but non-destructive (upsert, keeps existing data)
        if (req.method === "POST" && req.url === "/import") {
            const graph = await readBody(req);
            if (!graph.nodes || !graph.links) return json(res, 400, { error: "Missing nodes or links" });

            let imported = 0;
            await prisma.$transaction(async tx => {
                for (const n of graph.nodes) {
                    const ips = Array.isArray(n.ips)
                        ? n.ips
                        : n.ip
                            ? [{ address: n.ip.replace(/\/\d+$/, ""), subnet: n.subnet || "" }]
                            : [];
                    await tx.node.upsert({
                        where:  { id: n.id },
                        update: { hostname: n.hostname, system: n.system, type: n.type },
                        create: {
                            id: n.id, hostname: n.hostname, system: n.system, type: n.type,
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

        // ── Static file serving ─────────────────────────────────────────────
        let filePath = "./public" + req.url;
        filePath = filePath.split("?")[0];
        if (filePath === "./public/" || filePath === "./public") filePath = "./public/index.html";

        const extname     = String(path.extname(filePath)).toLowerCase();
        const contentType = mimeTypes[extname] || "application/octet-stream";

        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(404, { "Content-Type": "text/plain" });
                res.end("404 - File not found");
            } else {
                res.writeHead(200, { "Content-Type": contentType });
                res.end(content, "utf-8");
            }
        });

    } catch (e) {
        console.error("Unhandled error:", e);
        json(res, 500, { error: "Internal server error", detail: e.message });
    }

}).listen(PORT, () => {
    console.log(`Netline running at http://localhost:${PORT}`);
});
