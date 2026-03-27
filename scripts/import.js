// scripts/import.js
// Imports a graph.json file into the database
// Usage: node scripts/import.js ./graph.json
//
// This is safe to run multiple times — it uses upsert so existing
// nodes/links won't be duplicated.

const { PrismaClient } = require("@prisma/client");
const fs   = require("fs");
const path = require("path");

const prisma = new PrismaClient();

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error("Usage: node scripts/import.js <path-to-graph.json>");
        process.exit(1);
    }

    const raw   = fs.readFileSync(path.resolve(filePath), "utf-8");
    const graph = JSON.parse(raw);

    if (!graph.nodes || !graph.links) {
        console.error("Invalid graph.json — must have nodes and links arrays");
        process.exit(1);
    }

    console.log(`Importing ${graph.nodes.length} nodes and ${graph.links.length} links...`);

    // Import nodes + their IPs
    for (const node of graph.nodes) {
        // Normalise legacy single-ip format
        const ips = Array.isArray(node.ips)
            ? node.ips
            : node.ip
                ? [{ address: node.ip.replace(/\/\d+$/, ""), subnet: node.subnet || "" }]
                : [];

        await prisma.node.upsert({
            where:  { id: node.id },
            update: { hostname: node.hostname, system: node.system, type: node.type },
            create: { id: node.id, hostname: node.hostname, system: node.system, type: node.type },
        });

        // Replace IPs for this node
        await prisma.nodeIp.deleteMany({ where: { nodeId: node.id } });
        for (const ip of ips) {
            await prisma.nodeIp.create({
                data: { nodeId: node.id, address: ip.address, subnet: ip.subnet || "" }
            });
        }

        console.log(`  ✓ node ${node.id}`);
    }

    // Import links
    for (const link of graph.links) {
        const source = typeof link.source === "object" ? link.source.id : link.source;
        const target = typeof link.target === "object" ? link.target.id : link.target;

        // Skip if either endpoint doesn't exist
        const srcExists = await prisma.node.findUnique({ where: { id: source } });
        const tgtExists = await prisma.node.findUnique({ where: { id: target } });
        if (!srcExists || !tgtExists) {
            console.warn(`  ⚠ skipping link ${source} → ${target} (node not found)`);
            continue;
        }

        await prisma.link.upsert({
            where:  { source_target: { source, target } },
            update: { label: link.label || "" },
            create: { source, target, label: link.label || "" },
        });

        console.log(`  ✓ link ${source} → ${target}`);
    }

    console.log("\nImport complete.");
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
