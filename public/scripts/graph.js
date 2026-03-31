// ============ Graph ============

// ── Visual constants — tweak these to adjust the graph appearance ─────────────
const NODE_SIZE          = 0;   // added to all node radii
const FONT_SIZE          = 12;  // node label font size (px)
const LINK_DISTANCE_SAME = 120; // distance between nodes in the same system
const LINK_DISTANCE_DIFF = 300; // distance between nodes in different systems
const LINK_STRENGTH      = -30; // node repulsion (more negative = further apart)
const DOT_GRID_SIZE      = 30;  // background dot grid spacing (px)
// ─────────────────────────────────────────────────────────────────────────────
// Load graph — fall back to empty graph if file doesn't exist
fetch("/graph")
    .then(r => r.ok ? r.json() : { nodes: [], links: [] })
    .catch(() => ({ nodes: [], links: [] }))
    .then(function(data) {
        window.currentGraphData = data;

        drawGraph(data);

        // Now that currentGraphData is ready, wire up sidebar panels
        if (typeof wireNodeList  === "function") wireNodeList();
        if (typeof wireJsonEditor === "function") wireJsonEditor();

        // Redraw whenever the canvas size changes (e.g. devtools open/close)
        const canvasEl = document.getElementById("canvas");
        new ResizeObserver(() => {
            d3.select("#canvas svg")
                .attr("width",  canvasEl.clientWidth)
                .attr("height", canvasEl.clientHeight);
            if (window.graphSimulation) {
                window.graphSimulation
                    .force("center", d3.forceCenter(canvasEl.clientWidth / 2, canvasEl.clientHeight / 2))
                    .alpha(0.1)
                    .restart();
            }
        }).observe(canvasEl);
    });

function drawGraph(data) {

    // Normalize links to string IDs (after simulation they become objects)
    data.links = data.links.map(l => ({
        source: typeof l.source === "object" ? l.source.id : l.source,
        target: typeof l.target === "object" ? l.target.id : l.target,
        label:  l.label || "",
    }));

    // Deduplicate links
    const seen = new Set();
    data.links = data.links.filter(l => {
        const key = `${l.source}||${l.target}`;
        if (seen.has(key)) return false;
        seen.add(key); return true;
    });

    const width  = window.innerWidth;
    const height = window.innerHeight;

    const svg = d3.select("#canvas")
        .append("svg")
        .attr("width", width)
        .attr("height", height);

    // ============ Tooltip ============
    const tooltip = d3.select("#canvas")
        .append("div")
        .attr("id", "node-tooltip")
        .style("position", "absolute")
        .style("background", "white")
        .style("border", "2px solid #333")
        .style("border-radius", "6px")
        .style("padding", "5px 10px")
        .style("font-size", "12px")
        .style("font-family", "Arial, sans-serif")
        .style("font-weight", "normal")
        .style("color", "#333")
        .style("pointer-events", "none")
        .style("box-shadow", "0 2px 6px rgba(0,0,0,0.12)")
        .style("white-space", "nowrap")
        .style("display", "none");

    // ============ Background grid ============
    const defs = svg.append("defs");
    const patternSize = DOT_GRID_SIZE;

    const pattern = defs.append("pattern")
        .attr("id", "dotGrid")
        .attr("width", patternSize)
        .attr("height", patternSize)
        .attr("patternUnits", "userSpaceOnUse");

    pattern.append("circle")
        .attr("cx", 1)
        .attr("cy", 1)
        .attr("r", 1)
        .attr("fill", "#aaa")
        .attr("opacity", 0.5);

    svg.append("rect")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("fill", "url(#dotGrid)");

    const zoomLayer = svg.append("g");

    // ============ Physics ============
    window.graphSimulation = d3.forceSimulation(data.nodes)
        .force("link", d3.forceLink(data.links)
            .id(d => d.id)
            .distance(d => {
                const src = typeof d.source === "object" ? d.source.id : d.source;
                const tgt = typeof d.target === "object" ? d.target.id : d.target;
                return systemMap[src] === systemMap[tgt] ? LINK_DISTANCE_SAME : LINK_DISTANCE_DIFF;
            })
        )
        .alphaDecay(0.08)
        .alphaMin(0.02)
        .force("charge", d3.forceManyBody().strength(LINK_STRENGTH))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide(d => {
            if (d.type === "fw")     return 56 + NODE_SIZE + 4;
            if (d.type === "client") return 48 + NODE_SIZE + 4;
            return 52 + NODE_SIZE + 4;
        }));

    // ============ Visual ============
    // Build a map for quick system lookup
    const systemMap = {};
    data.nodes.forEach(n => { systemMap[n.id] = n.system; });

    const link = zoomLayer.append("g")
        .selectAll("line")
        .data(data.links)
        .join("line")
        .attr("stroke", "#aaa")
        .attr("stroke-width", d => {
            const src = typeof d.source === "object" ? d.source.id : d.source;
            const tgt = typeof d.target === "object" ? d.target.id : d.target;
            return systemMap[src] === systemMap[tgt] ? 2 : 1;
        });

    // Link labels
    const linkLabel = zoomLayer.append("g")
        .selectAll("text")
        .data(data.links.filter(l => l.label))
        .join("text")
        .attr("text-anchor", "middle")
        .attr("font-size", 10)
        .attr("fill", "#aaa")
        .attr("font-family", "Arial, sans-serif")
        .style("pointer-events", "none")
        .text(d => d.label);

    const node = zoomLayer.append("g")
        .selectAll("g")
        .data(data.nodes)
        .join("g")
        .call(drag(window.graphSimulation, tooltip, (v) => { isDragging = v; }));

    node.append("circle")
        .attr("r", d => {
            if (d.type === "fw")     return 56 + NODE_SIZE;
            if (d.type === "client") return 48 + NODE_SIZE;
            return 52 + NODE_SIZE;
        })
        .attr("fill", d => {
            if (d.type === "fw")     return "#de8691";
            if (d.type === "client") return "#86dea8";
            return "#86bcde";
        })
        .attr("stroke", "none")
        .attr("stroke-width", 2.5);

    node.append("text")
        .text(d => d.type === "fw" ? d.system + " " + d.hostname : d.hostname)
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .style("pointer-events", "none")
        .attr("font-size", FONT_SIZE);

    // ============ Hover ============
    function nodeRadius(d) {
        if (d.type === "fw")     return 56 + NODE_SIZE;
        if (d.type === "client") return 48 + NODE_SIZE;
        return 52 + NODE_SIZE;
    }

    function positionTooltip(d) {
        const transform = d3.zoomTransform(svg.node());
        const sx   = transform.applyX(d.x);
        const sy   = transform.applyY(d.y);
        const r    = nodeRadius(d) * transform.k;
        const tipW = tooltip.node().offsetWidth;
        const tipH = tooltip.node().offsetHeight;
        tooltip
            .style("left", (sx - tipW / 2) + "px")
            .style("top",  (sy - r - tipH - 8) + "px");
    }

    let isDragging = false;

    // Highlight set — controlled externally via window.setHighlightedNodes
    let highlightedIds = new Set();

    function updateHighlight() {
        node.select("circle")
            .attr("stroke",       d => highlightedIds.has(d.id) ? "#f0c040" : "none")
            .attr("stroke-width", d => highlightedIds.has(d.id) ? 4 : 2.5);
    }

    window.setHighlightedNodes = function(ids) {
        highlightedIds = new Set(ids);
        updateHighlight();
    };

    node.on("click", function(event, d) {
            if (typeof window.selectNode === "function") window.selectNode(d.id);
        })
        .on("mouseover", function(event, d) {
            d3.select(this).select("circle")
                .attr("stroke", highlightedIds.has(d.id) ? "#f0c040" : "#333")
                .attr("stroke-width", 4);
            if (isDragging) return;
            // Support both new ips array and legacy ip string
            const ipLines = Array.isArray(d.ips) && d.ips.length
                ? d.ips.map(i => `<span style="color:#888;margin-right:4px">IP</span>${i.address}${i.subnet || ''}`).join("<br>")
                : `<span style="color:#888;margin-right:4px">IP</span>${d.ip || ""}${d.subnet || ""}`;
            tooltip
                .style("display", "block")
                .html(
                    `<span style="color:#888;margin-right:4px">System</span>${d.system}<br>` +
                    `<span style="color:#888;margin-right:4px">ID</span>${d.id}<br>` +
                    ipLines
                );
            positionTooltip(d);
        })
        .on("mousemove", function(event, d) {
            if (isDragging) return;
            positionTooltip(d);
        })
        .on("mouseout", function(event, d) {
            d3.select(this).select("circle")
                .attr("stroke",       highlightedIds.has(d.id) ? "#f0c040" : "none")
                .attr("stroke-width", highlightedIds.has(d.id) ? 4 : 2.5);
            tooltip.style("display", "none");
        });

    // ============ Zoom ============
    const zoom = d3.zoom()
        .scaleExtent([0.2, 4])
        .on("zoom", (event) => {
            const { transform } = event;
            zoomLayer.attr("transform", transform);
            pattern
                .attr("x", transform.x)
                .attr("y", transform.y)
                .attr("width",  patternSize * transform.k)
                .attr("height", patternSize * transform.k);
            pattern.select("circle")
                .attr("r", Math.max(0.5, 1 * transform.k));
        });

    svg.call(zoom);

    window.resetZoom = function() {
        const sb = document.getElementById("sidebar");
        const sbW = sb.classList.contains("open") ? sb.clientWidth : 0;
        const cx  = sbW + (window.innerWidth - sbW) / 2;
        const cy  = window.innerHeight / 2;
        svg.transition().duration(300).call(zoom.transform,
            d3.zoomIdentity.translate(cx - width / 2, cy - height / 2)
        );
    };

    // ============ Tick ============
    window.graphSimulation.on("tick", () => {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);
        linkLabel
            .attr("x", d => (d.source.x + d.target.x) / 2)
            .attr("y", d => (d.source.y + d.target.y) / 2 - 5);
        node.attr("transform", d => `translate(${d.x}, ${d.y})`);
    });
}

function drag(simulation, tooltip, setDragging) {
    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
        setDragging(true);
        tooltip.style("display", "none");
    }
    function dragged(event, d) {
        d.fx = event.x; d.fy = event.y;
    }
    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
        setDragging(false);
    }
    return d3.drag()
        .on("start", dragstarted)
        .on("drag",  dragged)
        .on("end",   dragended);
}

// ============ Live add node ============
window.addNodeToGraph = function(newNode) {
    const data = window.currentGraphData;
    if (data.nodes.find(n => n.id === newNode.id)) return;

    newNode.x = window.innerWidth  / 2 + (Math.random() - 0.5) * 100;
    newNode.y = window.innerHeight / 2 + (Math.random() - 0.5) * 100;
    data.nodes.push(newNode);

    // Add links — server already persisted them, add to in-memory data for live render
    if (newNode.connections) {
        newNode.connections.forEach(targetId => {
            // Only add if not already present
            const exists = data.links.some(l => {
                const s = typeof l.source === "object" ? l.source.id : l.source;
                return s === newNode.id && (typeof l.target === "object" ? l.target.id : l.target) === targetId;
            });
            if (!exists) data.links.push({ source: newNode.id, target: targetId, label: "" });
        });
    }

    d3.select("#canvas svg").remove();
    d3.select("#canvas #node-tooltip").remove();
    drawGraph(data);
    if (typeof window.refreshNodeList === "function") window.refreshNodeList();
};
