// ============ Graph ============

// ── Visual constants — tweak these to adjust the graph appearance ─────────────
const NODE_SIZE          = 0;   // added to all node radii
const FONT_SIZE          = 12;  // node label font size (px)
const LINK_DISTANCE_SAME = 200; // distance between nodes in the same system
const LINK_DISTANCE_DIFF = 320; // distance between nodes in different systems
const LINK_STRENGTH      = -30; // node repulsion (more negative = further apart)
const DOT_GRID_SIZE      = 45;  // background dot grid spacing (px)
// ─────────────────────────────────────────────────────────────────────────────

// ── Event / Timeline state ────────────────────────────────────────────────────
const ACTOR_BLUE = "#5153B4";
const ACTOR_RED  = "#B45153";
const SEVERITY_COLORS = {
    none:     "#666",
    low:      "#6fcf97",
    medium:   "#f2c94c",
    high:     "#f2994a",
    critical: "#eb5757",
};

window.allEvents    = [];   // all events loaded from server

// Format datetime as YYYY-MM-DD HH:MM (24h) in selected timezone
function fmtTime(d) {
    if (!(d instanceof Date)) d = new Date(d);
    const tz = window.selectedTimezone || "Europe/Paris";
    try {
        return d.toLocaleString("sv-SE", { timeZone: tz }).slice(0, 16).replace("T", " ");
    } catch(e) {
        const p = n => String(n).padStart(2, "0");
        return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+" "+p(d.getHours())+":"+p(d.getMinutes());
    }
}
window.currentTime  = null; // current slider datetime (ms)
window.activeEvents = [];   // events up to currentTime
// Load graph — fall back to empty graph if file doesn't exist
fetch("/graph")
    .then(r => r.ok ? r.json() : { nodes: [], links: [] })
    .catch(() => ({ nodes: [], links: [] }))
    .then(function(data) {
        window.currentGraphData = data;

        // Load events then init timeline
        fetch("/events")
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
            .then(events => {
                window.allEvents = events;
                initTimeline();
                drawGraph(data);

                // Wire up sidebar panels
                if (typeof wireNodeList   === "function") wireNodeList();
                if (typeof wireJsonEditor === "function") wireJsonEditor();

                // Redraw whenever canvas is resized (e.g. devtools open/close)
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
        .style("z-index", "500")
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

    // Build system lookup map before simulation (used in distance function)
    const systemMap = {};
    data.nodes.forEach(n => { systemMap[n.id] = n.system; });

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
            .style("top",  (sy - r - tipH - 4) + "px");
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
            window._lastTransform = transform;
            zoomLayer.attr("transform", transform);
            pattern
                .attr("x", transform.x)
                .attr("y", transform.y)
                .attr("width",  patternSize * transform.k)
                .attr("height", patternSize * transform.k);
            pattern.select("circle")
                .attr("r", Math.max(0.5, 1 * transform.k));
            // Reposition event cards on pan/zoom
            updateEventCards();
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
        // Reposition event cards as nodes move
        updateEventCards();
    });
}

// ============ Timeline ============
function initTimeline() {
    const events = window.allEvents;
    const bar = document.getElementById("timeline-bar");
    if (!bar) return;

    if (events.length === 0) {
        bar.style.display = "none";
        document.getElementById("canvas").style.paddingTop = "0";
        return;
    }
    bar.style.display = "flex";
    // Position bar — positionTimeline sets padding too
    if (typeof window.positionTimeline === "function") window.positionTimeline();
    else {
        bar.style.left  = "12px";
        bar.style.right = "12px";
        document.getElementById("canvas").style.paddingTop = "60px";
    }

    const times = events.map(e => new Date(e.datetime).getTime());
    const minT  = Math.min(...times);
    const maxT  = Math.max(...times);

    // One clean stop before any events — exactly 1 minute before first event
    const bufferT = minT - 60000;

    window._timelineMin    = bufferT;
    window._timelineMax    = maxT;
    window._timelineBuffer = bufferT; // the "before events" stop

    const slider = document.getElementById("timeline-slider");
    slider.min   = bufferT;
    slider.max   = maxT;
    slider.value = bufferT;
    window.currentTime = bufferT;

    updateTimelineLabel(bufferT);
    updateActiveEvents(bufferT);
}

function updateTimelineLabel(ms) {
    const el = document.getElementById("timeline-label");
    if (!el) return;
    if (!ms) { el.textContent = ""; return; }
    const d = new Date(ms);
    el.textContent = fmtTime(d);
}

function updateActiveEvents(ms, fromPlayback) {
    const prev = window.currentTime;
    window.currentTime  = ms;
    const showBlue = window._filterBlue !== false;
    const showRed  = window._filterRed  !== false;
    window.activeEvents = (window.allEvents || [])
        .filter(e => new Date(e.datetime).getTime() <= ms)
        .filter(e => e.actor === "blue" ? showBlue : showRed)
        .sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

    // Cards only visible during playback/step or when feed is open
    if (fromPlayback !== undefined) {
        window._eventCardsEnabled = fromPlayback;
    }

    // Clear dismissed set when time actually changes so new step shows fresh cards
    if (ms !== prev) window._dismissedCards = new Set();

    updateEventCards();
    updateEventFeed();
}

// Exposed so timeline controls in ui.js can enable cards during play/step
window.updateActiveEvents = updateActiveEvents;

// ── Event cards anchored to nodes ─────────────────────────────────────────────
window._eventCardsEnabled = false; // only show during play/step or when feed is open
window._dismissedCards    = new Set(); // nodeIds dismissed via X button

function updateEventCards() {
    const canvas = document.getElementById("canvas");
    // Remove old cards
    canvas.querySelectorAll(".event-card").forEach(el => el.remove());

    if (!window._eventCardsEnabled) return;

    const active = window.activeEvents || [];
    if (!active.length || !window.graphSimulation) return;

    // Show only events whose timestamp exactly equals the current slider position
    const currentMs = window.currentTime || 0;
    const bufferStop = window._timelineBuffer || 0;

    // If we're at the buffer stop (before any events), show nothing
    if (currentMs <= bufferStop) {
        canvas.querySelectorAll(".event-card").forEach(el => el.remove());
        return;
    }

    // Find events that exactly match the current time
    const byNode = {};
    active.forEach(e => {
        const t = new Date(e.datetime).getTime();
        if (t === currentMs) {
            byNode[e.nodeId] = e;
        }
    });

    // If no exact match, fall back to most recent per node
    if (Object.keys(byNode).length === 0) {
        active.forEach(e => {
            if (!byNode[e.nodeId] || new Date(e.datetime) > new Date(byNode[e.nodeId].datetime)) {
                byNode[e.nodeId] = e;
            }
        });
    }

    const nodes = (window.currentGraphData || {}).nodes || [];
    const svg   = document.querySelector("#canvas svg");
    if (!svg) return;
    const transform = window._lastTransform || d3.zoomIdentity;

    Object.entries(byNode).forEach(([nodeId, e]) => {
        if ((window._dismissedCards || new Set()).has(nodeId)) return;
        const node = nodes.find(n => n.id === nodeId);
        if (!node || node.x == null) return;

        const sx = transform.applyX(node.x);
        const sy = transform.applyY(node.y);
        const r  = (node.type === "fw" ? 56 : node.type === "client" ? 48 : 52) + NODE_SIZE;
        const scaledR = r * transform.k;

        const color = e.actor === "red" ? ACTOR_RED : ACTOR_BLUE;
        const sev   = SEVERITY_COLORS[e.severity] || SEVERITY_COLORS.none;
        const time  = fmtTime(e.datetime);

        // Card centered above node with a stem connecting it
        const cardW   = 200;
        const stemH   = 10; // px gap between card bottom and node top
        const cardLeft = sx - cardW / 2;
        const cardTop  = sy - scaledR - stemH;

        // Stem — a thin coloured line from card bottom to node edge
        const stem = document.createElement("div");
        stem.className = "event-card";
        stem.dataset.stemFor = nodeId;
        stem.style.cssText = `
            position:absolute;
            left:${sx - 1}px;
            top:${sy - scaledR}px;
            width:2px;
            height:${stemH}px;
            background:${color};
            pointer-events:none;
            z-index:199;
        `;
        canvas.appendChild(stem);

        const card = document.createElement("div");
        card.className = "event-card";
        card.style.cssText = `
            position:absolute;
            left:${cardLeft}px;
            top:${cardTop}px;
            transform:translateY(-100%);
            width:${cardW}px;
            background:#1e1e1e;
            border:2px solid ${color};
            border-radius:8px;
            padding:8px 10px;
            font-size:11px;
            font-family:Arial,sans-serif;
            color:#eee;
            pointer-events:none;
            box-shadow:0 4px 12px rgba(0,0,0,0.5);
            z-index:200;
        `;
        card.style.pointerEvents = "auto";
        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <span style="color:${color};font-weight:bold;font-size:10px;">${e.actor.toUpperCase()}</span>
                    ${e.severity !== "none" ? `<span style="background:${sev};color:#111;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:bold;">${e.severity.toUpperCase()}</span>` : ""}
                </div>
                <button class="event-card-close" style="background:none;border:none;color:#888;cursor:pointer;font-size:13px;padding:0 2px;line-height:1;" title="Close">✕</button>
            </div>
            <div style="color:#aaa;font-size:10px;margin-bottom:3px;">${time}</div>
            <div>${e.description}</div>
            ${e.mitre ? `<div style="color:#aaa;font-size:10px;margin-top:2px;">MITRE: ${e.mitre}</div>` : ""}
            ${e.tool  ? `<div style="color:#aaa;font-size:10px;">Tool: ${e.tool}</div>` : ""}
            ${e.cve   ? `<div style="color:#aaa;font-size:10px;">CVE: ${e.cve}</div>` : ""}
            ${e.srcIp ? `<div style="color:#aaa;font-size:10px;">Src: ${e.srcIp}</div>` : ""}
            ${e.dstIp ? `<div style="color:#aaa;font-size:10px;">Dst: ${e.dstIp}</div>` : ""}
        `;
        card.querySelector(".event-card-close").addEventListener("click", () => {
            window._dismissedCards.add(nodeId);
            card.remove();
            // Also remove the stem
            document.querySelector(`[data-stem-for="${nodeId}"]`)?.remove();
        });
        canvas.appendChild(card);
    });
}

// ── Event feed (right panel) ──────────────────────────────────────────────────
function updateEventFeed() {
    const feed = document.getElementById("events-feed-list") || document.getElementById("event-feed-list");
    if (!feed) return;

    // Always show ALL events (newest first), filtered by actor checkboxes
    const showBlue = window._filterBlue !== false;
    const showRed  = window._filterRed  !== false;
    const all = (window.allEvents || [])
        .filter(e => e.actor === "blue" ? showBlue : showRed)
        .sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    feed.innerHTML = "";

    if (all.length === 0) {
        feed.innerHTML = `<div style="color:#666;font-size:12px;padding:12px;text-align:center;">No events yet</div>`;
        return;
    }

    const nodes     = (window.currentGraphData || {}).nodes || [];
    const currentMs = window.currentTime || 0;

    all.forEach(e => {
        const node     = nodes.find(n => n.id === e.nodeId);
        const label    = node ? `${node.system} · ${node.hostname}` : e.nodeId;
        const color    = e.actor === "red" ? ACTOR_RED : ACTOR_BLUE;
        const sev      = SEVERITY_COLORS[e.severity] || SEVERITY_COLORS.none;
        const time     = fmtTime(e.datetime);
        const isPast   = new Date(e.datetime).getTime() <= currentMs;
        const opacity  = isPast ? "1" : "0.35";

        const item = document.createElement("div");
        item.style.cssText = `
            border-left:3px solid ${color};
            padding:8px 10px;
            margin-bottom:6px;
            background:#2a2a2a;
            border-radius:0 6px 6px 0;
            cursor:pointer;
            opacity:${opacity};
        `;
        item.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                <span style="color:#ccc;font-size:11px;font-weight:bold;">${label}</span>
                ${e.severity !== "none" ? `<span style="background:${sev};color:#111;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:bold;">${e.severity.toUpperCase()}</span>` : ""}
            </div>
            <div style="color:#888;font-size:10px;margin-bottom:3px;">${time} · <span style="color:${color}">${e.actor.toUpperCase()}</span></div>
            <div style="color:#ddd;font-size:11px;">${e.description}</div>
            ${e.mitre ? `<div style="color:#888;font-size:10px;margin-top:2px;">MITRE: ${e.mitre}</div>` : ""}
        `;
        item.addEventListener("click", () => {
            if (typeof window.selectNode === "function") window.selectNode(e.nodeId);
        });
        feed.appendChild(item);
    });
}

// ── Redraw event cards on zoom/pan ────────────────────────────────────────────
window.refreshEventCards = updateEventCards;

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
