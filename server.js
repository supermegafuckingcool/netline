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

            // ID is derived from system + hostname — update it if either changed
            const newId = `${node.system}-${node.hostname}`;
            node.id = newId;

            await prisma.$transaction(async tx => {
                if (newId !== originalId) {
                    // Create new node record with the new ID
                    await tx.node.create({
                        data: {
                            id:       newId,
                            hostname: node.hostname,
                            system:   node.system,
                            type:     node.type,
                        }
                    });
                    // Move IPs to new ID
                    await tx.nodeIp.updateMany({
                        where: { nodeId: originalId },
                        data:  { nodeId: newId },
                    });
                    // Move inbound links to new ID
                    await tx.link.updateMany({
                        where: { target: originalId },
                        data:  { target: newId },
                    });
                    // Move note to new ID
                    await tx.note.updateMany({
                        where: { nodeId: originalId },
                        data:  { nodeId: newId },
                    });
                    // Delete old node (outgoing links cascade-deleted)
                    await tx.node.delete({ where: { id: originalId } });
                } else {
                    await tx.node.update({
                        where: { id: originalId },
                        data:  { hostname: node.hostname, system: node.system, type: node.type },
                    });
                }

                // Replace IPs
                await tx.nodeIp.deleteMany({ where: { nodeId: newId } });
                for (const ip of ips) {
                    await tx.nodeIp.create({ data: { nodeId: newId, address: ip.address, subnet: ip.subnet || "" } });
                }

                // Rebuild outgoing links
                await tx.link.deleteMany({ where: { source: newId } });
                for (const target of connections) {
                    const targetExists = await tx.node.findUnique({ where: { id: target } });
                    if (targetExists) {
                        await tx.link.upsert({
                            where:  { source_target: { source: newId, target } },
                            update: {},
                            create: { source: newId, target, label: "" },
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

        // ── GET /events ────────────────────────────────────────────────────
        if (req.method === "GET" && req.url === "/events") {
            const events = await prisma.event.findMany({
                orderBy: { datetime: "asc" },
            });
            return json(res, 200, events.map(e => ({
                id:          e.id,
                nodeId:      e.nodeId,
                datetime:    e.datetime.toISOString(),
                description: e.description,
                actor:       e.actor,
                severity:    e.severity,
                mitre:       e.mitre,
                tool:        e.tool,
                cve:         e.cve,
                srcIp:       e.srcIp,
                dstIp:       e.dstIp,
            })));
        }

        // ── POST /add-event ─────────────────────────────────────────────────
        if (req.method === "POST" && req.url === "/add-event") {
            const body = await readBody(req);
            const event = await prisma.event.create({
                data: {
                    nodeId:      body.nodeId,
                    datetime:    new Date(body.datetime),
                    description: body.description || "",
                    actor:       body.actor || "blue",
                    severity:    body.severity || "medium",
                    mitre:       body.mitre || "",
                    tool:        body.tool || "",
                    cve:         body.cve || "",
                    srcIp:       body.srcIp || "",
                    dstIp:       body.dstIp || "",
                }
            });
            return json(res, 200, { ok: true, event: {
                ...event,
                datetime: event.datetime.toISOString(),
            }});
        }

        // ── POST /edit-event ────────────────────────────────────────────────
        if (req.method === "POST" && req.url === "/edit-event") {
            const body = await readBody(req);
            const event = await prisma.event.update({
                where: { id: parseInt(body.id) },
                data: {
                    datetime:    new Date(body.datetime),
                    description: body.description || "",
                    actor:       body.actor || "blue",
                    severity:    body.severity || "none",
                    mitre:       body.mitre || "",
                    tool:        body.tool  || "",
                    cve:         body.cve   || "",
                    srcIp:       body.srcIp || "",
                    dstIp:       body.dstIp || "",
                }
            });
            return json(res, 200, { ok: true, event: {
                ...event, datetime: event.datetime.toISOString()
            }});
        }

        // ── POST /delete-event ──────────────────────────────────────────────
        if (req.method === "POST" && req.url === "/delete-event") {
            const { id } = await readBody(req);
            await prisma.event.delete({ where: { id: parseInt(id) } });
            return json(res, 200, { ok: true });
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
