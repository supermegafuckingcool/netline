// ============ Graph ============

// ── Visual constants — tweak these to adjust the graph appearance ─────────────
const NODE_SIZE          = 0;   // added to all node radii
const FONT_SIZE          = 13;  // node label font size (px)
const LINK_DISTANCE_SAME = 120; // distance between nodes in the same system
const LINK_DISTANCE_DIFF = 300; // distance between nodes in different systems
const LINK_STRENGTH      = -30; // node repulsion (more negative = further apart)
const DOT_GRID_SIZE      = 24;  // background dot grid spacing (px)
// ─────────────────────────────────────────────────────────────────────────────

// Escape HTML to prevent XSS when injecting into innerHTML
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

// Resolve D3 link endpoint to string ID
function resolveId(x) { return typeof x === "object" ? x.id : x; }

// Node radius — module-scoped so updateEventCards can use it
function nodeRadiusFor(type) {
    if (type === "fw")          return 60 + NODE_SIZE;
    if (type === "router")      return 54 + NODE_SIZE;
    if (type === "switch")      return 50 + NODE_SIZE;
    if (type === "server")      return 48 + NODE_SIZE;
    if (type === "workstation") return 44 + NODE_SIZE;
    if (type === "client")      return 42 + NODE_SIZE;
    if (type === "iot")         return 38 + NODE_SIZE;
    return 40 + NODE_SIZE;
}

// ── Event / Timeline state ────────────────────────────────────────────────────
const ACTOR_BLUE   = "#5153B4";
const ACTOR_RED    = "#B45153";
const ACTOR_GREY   = "#888888";
const ACTOR_COLOR  = { blue: ACTOR_BLUE, red: ACTOR_RED, grey: ACTOR_GREY };

const NODE_COLOR = {
    fw:          "#f4a8b4",   // pastel rose      — firewall
    router:      "#c8a8f4",   // pastel purple    — router
    switch:      "#a8c8f4",   // pastel blue      — switch
    server:      "#a8d8f4",   // pastel sky       — server
    workstation: "#a8f4c8",   // pastel mint      — workstation
    client:      "#c4f4a8",   // pastel lime      — client
    iot:         "#f4e8a8",   // pastel yellow    — IoT device
    unknown:     "#c8c8d4",   // pastel grey      — unknown
};
const SEVERITY_COLORS = {
    none:     "#666",
    low:      "#6fcf97",
    medium:   "#f2c94c",
    high:     "#f2994a",
    critical: "#eb5757",
};

window.allEvents    = [];   // all events loaded from server
window.currentGraphId = null; // active graph id

// Format datetime as YYYY-MM-DD HH:MM:SS (24h) in selected timezone
function fmtTime(d) {
    if (!(d instanceof Date)) d = new Date(d);
    const tz = window.selectedTimezone || "UTC";
    const p  = n => String(n).padStart(2, "0");
    try {
        // Use Intl.DateTimeFormat for locale-independent 24h formatting
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone:  tz,
            year:      "numeric",
            month:     "2-digit",
            day:       "2-digit",
            hour:      "2-digit",
            minute:    "2-digit",
            second:    "2-digit",
            hour12:    false,
        }).formatToParts(d);
        const get = type => parts.find(pt => pt.type === type)?.value || "00";
        return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
    } catch(e) {
        return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+" "+p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds());
    }
}
window.currentTime  = null; // current slider datetime (ms)
window.activeEvents = [];   // events up to currentTime
// Load all graphs, then load the first one
fetch("/graphs")
    .then(r => r.ok ? r.json() : [])
    .catch(() => [])
    .then(graphs => {
        if (graphs.length === 0) {
            // First run — create Default graph
            return fetch("/create-graph", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Default" })
            }).then(r => r.json()).then(res => {
                window._allGraphs = [res.graph];
                return res.graph.id;
            });
        }
        window._allGraphs = graphs;
        return graphs[0].id;
    })
    .then(graphId => loadGraph(graphId));

function loadGraph(graphId) {
    window.currentGraphId       = graphId;
    window._eventCardsEnabled   = false;
    window._dismissedCards      = new Set();
    window.currentTime          = null;
    window.activeEvents         = [];
    if (typeof window.refreshGraphSwitcher === "function") window.refreshGraphSwitcher();

    // Show loading overlay while fetching
    const canvasEl = document.getElementById("canvas");
    let loadingEl = document.getElementById("graph-loading");
    if (!loadingEl) {
        loadingEl = document.createElement("div");
        loadingEl.id = "graph-loading";
        loadingEl.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(245,245,244,0.7);z-index:90;font-size:13px;color:#6a6a6a;font-family:inherit;pointer-events:none;";
        loadingEl.textContent = "Loading graph…";
        canvasEl.appendChild(loadingEl);
    }
    loadingEl.style.display = "flex";

    Promise.all([
        fetch("/graph?graphId=" + graphId).then(r => r.ok ? r.json() : Promise.reject("graph " + r.status)),
        fetch("/events?graphId=" + graphId).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch("/notes?graphId=" + graphId).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]).then(([data, events, notes]) => {
        window.currentGraphData = data;
        window.allEvents        = events;
        window.nodeNotes        = notes;

        const loadingOverlay = document.getElementById("graph-loading");
        if (loadingOverlay) loadingOverlay.style.display = "none";

        initTimeline();

        d3.select("#canvas svg").remove();
        d3.select("#canvas #node-tooltip").remove();
        drawGraph(data);

        if (typeof wireNodeList   === "function") wireNodeList();
        // wireJsonEditor accumulates listeners — only call once, then just reload content
        if (typeof wireJsonEditor === "function") {
            if (!window._jsonEditorWired) {
                window._jsonEditorWired = true;
                wireJsonEditor();
            } else if (typeof window.reloadJsonEditor === "function") {
                window.reloadJsonEditor();
            }
        }
        if (typeof updateEventFeed === "function") updateEventFeed();

        if (!window._resizeObserverAdded) {
            window._resizeObserverAdded = true;
            new ResizeObserver(() => {
                d3.select("#canvas svg")
                    .attr("width",  canvasEl.clientWidth)
                    .attr("height", canvasEl.clientHeight);
                if (window.graphSimulation) {
                    window.graphSimulation
                        .force("center", d3.forceCenter(canvasEl.clientWidth / 2, canvasEl.clientHeight / 2))
                        .alpha(0.1).restart();
                }
            }).observe(canvasEl);
        }
    }).catch(err => {
        const ov = document.getElementById("graph-loading");
        if (ov) { ov.textContent = "Failed to load graph — " + err; ov.style.color = "#B45153"; }
        console.error("loadGraph failed:", err);
    });
}

window.loadGraph = loadGraph;

// Pan canvas to center on a node without opening the sidebar
window.focusNode = function(nodeId) {
    const nodes = (window.currentGraphData || {}).nodes || [];
    const node  = nodes.find(n => n.id === nodeId);
    if (!node || node.x == null) return;

    const svg       = document.querySelector("#canvas svg");
    if (!svg) return;
    const canvasEl  = document.getElementById("canvas");
    const sb        = document.getElementById("sidebar");
    const sbW       = sb && sb.classList.contains("open") ? sb.clientWidth : 0;
    const W         = canvasEl.clientWidth;
    const H         = canvasEl.clientHeight;
    const curT      = window._lastTransform || d3.zoomIdentity;
    const targetX   = (W + sbW) / 2 - node.x * curT.k;
    const targetY   = H / 2       - node.y * curT.k;
    const newT      = d3.zoomIdentity.translate(targetX, targetY).scale(curT.k);
    d3.select(svg).transition().duration(400).call(
        d3.zoom().scaleExtent([0.02, 4]).transform, newT
    );
    window._lastTransform = newT;
};

function drawGraph(data) {

    // Normalize links to string IDs (after simulation they become objects)
    data.links = data.links.map(l => ({
        source: resolveId(l.source),
        target: resolveId(l.target),
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
        .style("background", "#ffffff")
        .style("border", "1px solid #dddcda")
        .style("border-radius", "6px")
        .style("padding", "5px 10px")
        .style("font-size", "12px")
        .style("font-family", "Arial, sans-serif")
        .style("font-weight", "normal")
        .style("color", "#1a1a1a")
        .style("pointer-events", "none")
        .style("box-shadow", "0 4px 12px rgba(0,0,0,0.10)")
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
        .attr("cx", 1.5)
        .attr("cy", 1.5)
        .attr("r", 1.5)
        .attr("fill", "#b0ada8")
        .attr("opacity", 0.8);

    svg.append("rect")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("fill", "url(#dotGrid)");

    const zoomLayer = svg.append("g");

    // Use module-level nodeRadiusFor
    function nodeRadius(d) { return nodeRadiusFor(d.type); }

    // Build system lookup map before simulation (used in distance function)
    const systemMap = {};
    data.nodes.forEach(n => { systemMap[n.id] = n.system; });

    // Build degree map — number of connections per node
    const degreeMap = {};
    data.nodes.forEach(n => { degreeMap[n.id] = 0; });
    data.links.forEach(l => {
        const s = resolveId(l.source);
        const t = resolveId(l.target);
        if (s in degreeMap) degreeMap[s]++;
        if (t in degreeMap) degreeMap[t]++;
    });

    // High-degree nodes get extra repulsion + more link distance to push children out
    function nodeCharge(d) {
        const deg = degreeMap[d.id] || 0;
        const base = d.type === "fw" || d.type === "router" ? LINK_STRENGTH * 4 : LINK_STRENGTH * 2;
        // Scale extra repulsion logarithmically with degree
        const extra = deg > 4 ? Math.log(deg - 3) * LINK_STRENGTH * 1.5 : 0;
        return base + extra;
    }

    function linkDistance(d) {
        const src = resolveId(d.source);
        const tgt = resolveId(d.target);
        const sameSystem = systemMap[src] === systemMap[tgt];
        const baseD = sameSystem ? LINK_DISTANCE_SAME : LINK_DISTANCE_DIFF;
        // If the hub has many connections, push children further away
        const hubDeg = Math.max(degreeMap[src] || 0, degreeMap[tgt] || 0);
        const degScale = hubDeg > 6 ? 1 + Math.log(hubDeg - 5) * 0.3 : 1;
        return baseD * degScale;
    }

    // Collision radius also scales with degree for hub nodes
    function collisionRadius(d) {
        const deg = degreeMap[d.id] || 0;
        const extra = deg > 4 ? Math.min(Math.log(deg - 3) * 8, 40) : 0;
        return nodeRadius(d) + 14 + extra;
    }

    // ============ Physics ============
    window.graphSimulation = d3.forceSimulation(data.nodes)
        .force("link", d3.forceLink(data.links)
            .id(d => d.id)
            .distance(linkDistance)
        )
        .alphaDecay(0.04)
        .alphaMin(0.008)
        .force("charge", d3.forceManyBody().strength(nodeCharge))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide(collisionRadius));

    // ============ Visual ============

    const link = zoomLayer.append("g")
        .selectAll("line")
        .data(data.links)
        .join("line")
        .attr("stroke", "#b0ada8")
        .attr("stroke-width", d => {
            const src = resolveId(d.source);
            const tgt = resolveId(d.target);
            return systemMap[src] === systemMap[tgt] ? 2 : 1;
        });

    // Link labels
    const linkLabel = zoomLayer.append("g")
        .selectAll("text")
        .data(data.links.filter(l => l.label))
        .join("text")
        .attr("text-anchor", "middle")
        .attr("font-size", 10)
        .attr("fill", "#a8a8a8")
        .attr("font-family", "system-ui, Arial, sans-serif")
        .style("pointer-events", "none")
        .text(d => d.label);

    const node = zoomLayer.append("g")
        .selectAll("g")
        .data(data.nodes)
        .join("g")
        .call(drag(window.graphSimulation, tooltip, (v) => { isDragging = v; }));

    node.append("circle")
        .attr("r", d => nodeRadius(d))
        .attr("fill", d => NODE_COLOR[d.type] || NODE_COLOR.server)
        .attr("stroke", "none")
        .attr("stroke-width", 2.5);

    node.append("text")
        .text(d => d.type === "fw" ? d.system + " " + d.hostname : d.hostname)
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .style("pointer-events", "none")
        .attr("font-size", FONT_SIZE)
        .attr("fill", "#2a2a2a")
        .attr("font-weight", "600")
        .attr("font-family", "Inter, system-ui, sans-serif");

    // ============ Hover ============

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
                ? d.ips.map(i => `<span style="color:#8a8a8a;margin-right:6px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">IP</span>${esc(i.address)}${esc(i.subnet || '')}`).join("<br>")
                : `<span style="color:#8a8a8a;margin-right:6px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">IP</span>${esc(d.ip || "")}${esc(d.subnet || "")}`;
            tooltip
                .style("display", "block")
                .html(
                    `<span style="color:#8a8a8a;margin-right:6px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">System</span>${esc(d.system)}<br>` +
                    `<span style="color:#8a8a8a;margin-right:6px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">ID</span>${esc(d.id)}<br>` +
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
        .scaleExtent([0.02, 4])
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
        const nodes = (window.currentGraphData || {}).nodes || [];
        const sb    = document.getElementById("sidebar");
        const sbW   = sb && sb.classList.contains("open") ? sb.clientWidth : 0;
        const W     = document.getElementById("canvas").clientWidth;
        const H     = document.getElementById("canvas").clientHeight;
        const pad   = 60; // px padding around the graph

        if (nodes.length === 0) {
            svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
            return;
        }

        // Find bounding box of all nodes that have been placed
        const placed = nodes.filter(n => n.x != null && n.y != null);
        if (placed.length === 0) {
            svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
            return;
        }
        const xs = placed.map(n => n.x);
        const ys = placed.map(n => n.y);
        const minX = Math.min(...xs) - pad;
        const maxX = Math.max(...xs) + pad;
        const minY = Math.min(...ys) - pad;
        const maxY = Math.max(...ys) + pad;

        // Available canvas area (excluding sidebar)
        const availW = W - sbW;
        const availH = H;
        const scaleX = availW  / (maxX - minX);
        const scaleY = availH  / (maxY - minY);
        const k      = Math.min(scaleX, scaleY, 2); // cap at 2x

        // Center within available area
        const midX  = (minX + maxX) / 2;
        const midY  = (minY + maxY) / 2;
        const tx    = sbW + availW / 2 - k * midX;
        const ty    = availH    / 2 - k * midY;

        svg.transition().duration(400).call(
            zoom.transform,
            d3.zoomIdentity.translate(tx, ty).scale(k)
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
        // Reposition event cards as nodes move (only when visible)
        if (window._eventCardsEnabled) updateEventCards();
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
    const prevTime = window.currentTime;
    slider.min = bufferT;
    slider.max = maxT;

    // Preserve current position if slider was already in use
    if (prevTime && prevTime > bufferT && prevTime <= maxT) {
        slider.value = prevTime;
        updateTimelineLabel(prevTime);
        updateActiveEvents(prevTime);
    } else {
        slider.value = bufferT;
        window.currentTime = bufferT;
        updateTimelineLabel(bufferT);
        updateActiveEvents(bufferT);
    }
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
    const showGrey = window._filterGrey !== false;
    window.activeEvents = (window.allEvents || [])
        .filter(e => new Date(e.datetime).getTime() <= ms)
        .filter(e => e.actor === "blue" ? showBlue : e.actor === "red" ? showRed : showGrey)
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
window.fmtTime = fmtTime;

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
        const scaledR = nodeRadiusFor(node.type) * transform.k;

        // SVG may sit below the canvas top edge (e.g. when the timeline bar
        // adds padding-top to #canvas). Cards are absolutely positioned inside
        // #canvas, so we need the SVG's top relative to the canvas — not the
        // document. getBoundingClientRect gives reliable rendered positions.
        const canvasEl  = document.getElementById("canvas");
        const canvasTop = canvasEl.getBoundingClientRect().top;
        const svgBcr    = (document.querySelector("#canvas svg") || canvasEl).getBoundingClientRect();
        const svgOffY   = svgBcr.top - canvasTop;
        const absY      = sy + svgOffY;   // canvas-relative Y of node centre

        const color = ACTOR_COLOR[e.actor] || ACTOR_BLUE;
        const sev   = SEVERITY_COLORS[e.severity] || SEVERITY_COLORS.none;
        const time  = fmtTime(e.datetime);

        // Card centered above node — stem bottom touches node top edge exactly
        const cardW    = 220;
        const stemH    = 20;
        const nodeTop  = absY - scaledR;   // canvas-relative Y of node top edge
        const stemTop  = nodeTop - stemH;
        const cardLeft = sx - cardW / 2;

        // Stem
        const stem = document.createElement("div");
        stem.className = "event-card";
        stem.dataset.stemFor = nodeId;
        stem.style.cssText = `
            position:absolute;
            left:${sx - 1}px;
            top:${stemTop}px;
            width:2px;
            height:${stemH}px;
            background:${color};
            pointer-events:none;
            z-index:120;
        `;
        canvas.appendChild(stem);

        const card = document.createElement("div");
        card.className = "event-card";
        card.style.cssText = `
            position:absolute;
            left:${cardLeft}px;
            top:${stemTop}px;
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
            z-index:120;
        `;
        card.style.pointerEvents = "auto";
        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <span style="color:${color};font-weight:bold;font-size:10px;">${esc(e.actor).toUpperCase()}</span>
                    ${e.severity !== "none" ? `<span style="background:${sev};color:#111;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:bold;">${esc(e.severity).toUpperCase()}</span>` : ""}
                </div>
                <button class="event-card-close" style="background:none;border:none;color:#888;cursor:pointer;font-size:13px;padding:0 2px;line-height:1;" title="Close">✕</button>
            </div>
            <div style="color:#666;font-size:9px;margin-bottom:1px;font-family:monospace;">${esc(e.nodeId)}</div>
            <div style="color:#aaa;font-size:10px;margin-bottom:3px;">${esc(time)}</div>
            <div>${esc(e.description)}</div>
            ${e.mitre ? `<div style="color:#aaa;font-size:10px;margin-top:2px;">MITRE: ${esc(e.mitre)}</div>` : ""}
            ${e.tool  ? `<div style="color:#aaa;font-size:10px;">Tool: ${esc(e.tool)}</div>` : ""}
            ${e.cve   ? `<div style="color:#aaa;font-size:10px;">CVE: ${esc(e.cve)}</div>` : ""}
            ${e.srcIp ? `<div style="color:#aaa;font-size:10px;">Src: ${esc(e.srcIp)}</div>` : ""}
            ${e.dstIp ? `<div style="color:#aaa;font-size:10px;">Dst: ${esc(e.dstIp)}</div>` : ""}
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
    const feed = document.getElementById("events-feed-list");
    if (!feed) return;

    // Always show ALL events (newest first), filtered by actor checkboxes
    const showBlue = window._filterBlue !== false;
    const showRed  = window._filterRed  !== false;
    const showGrey = window._filterGrey !== false;
    const all = (window.allEvents || [])
        .filter(e => e.actor === "blue" ? showBlue : e.actor === "red" ? showRed : showGrey)
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
        const color    = ACTOR_COLOR[e.actor] || ACTOR_BLUE;
        const sev      = SEVERITY_COLORS[e.severity] || SEVERITY_COLORS.none;
        const time     = fmtTime(e.datetime);
        const isPast   = new Date(e.datetime).getTime() <= currentMs;
        const opacity  = isPast ? "1" : "0.35";

        const item = document.createElement("div");
        item.style.cssText = `
            border-left:3px solid ${color};
            padding:8px 10px;
            margin-bottom:6px;
            background:#f7f7f6;
            border-radius:0 6px 6px 0;
            cursor:pointer;
            opacity:${opacity};
        `;
        item.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                <span style="color:#1a1a1a;font-size:12px;font-weight:600;">${esc(label)}</span>
                ${e.severity !== "none" ? `<span style="background:${sev};color:#111;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:bold;">${esc(e.severity).toUpperCase()}</span>` : ""}
            </div>
            <div style="color:#666;font-size:11px;margin-bottom:3px;">${esc(time)} · <span style="color:${color};font-weight:600;">${esc(e.actor).toUpperCase()}</span></div>
            <div style="color:#2a2a2a;font-size:12px;">${esc(e.description)}</div>
            ${e.mitre ? `<div style="color:#777;font-size:11px;margin-top:2px;">MITRE: ${esc(e.mitre)}</div>` : ""}
        `;
        // "→" button — opens node detail panel
        const gotoBtn = document.createElement("button");
        gotoBtn.innerHTML = "&#x2192;";
        gotoBtn.title = "Open node detail";
        gotoBtn.style.cssText = "background:none;border:1px solid var(--border,#d0cec9);border-radius:4px;color:var(--text-2,#6a6a6a);cursor:pointer;font-size:12px;padding:1px 6px;line-height:1.4;flex-shrink:0;margin-left:4px;transition:background 0.1s,color 0.1s;";
        gotoBtn.addEventListener("mouseenter", () => { gotoBtn.style.background = "var(--accent-bg,#eeeeff)"; gotoBtn.style.color = "var(--accent,#5153B4)"; gotoBtn.style.borderColor = "rgba(81,83,180,0.4)"; });
        gotoBtn.addEventListener("mouseleave", () => { gotoBtn.style.background = "none"; gotoBtn.style.color = "var(--text-2,#6a6a6a)"; gotoBtn.style.borderColor = "var(--border,#d0cec9)"; });
        gotoBtn.addEventListener("click", ev => {
            ev.stopPropagation();
            if (typeof window.selectNode === "function") window.selectNode(e.nodeId);
        });
        // Append button to first row of item
        const firstRow = item.querySelector("div");
        if (firstRow) firstRow.appendChild(gotoBtn);

        item.addEventListener("click", ev => {
            if (ev.target.closest("button")) return;
            // Seek timeline to this event's time
            const ms = new Date(e.datetime).getTime();
            const slider = document.getElementById("timeline-slider");
            if (slider && ms >= (window._timelineMin||0) && ms <= (window._timelineMax||Infinity)) {
                slider.value = ms;
                if (typeof updateTimelineLabel === "function") updateTimelineLabel(ms);
                if (typeof updateActiveEvents  === "function") updateActiveEvents(ms, true);
            }
            // Pan canvas to node without opening sidebar
            if (typeof window.focusNode === "function") window.focusNode(e.nodeId);
        });
        feed.appendChild(item);
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

    // Place new node near the centre of the visible area
    const t = window._lastTransform || d3.zoomIdentity;
    const canvasEl = document.getElementById("canvas");
    const cx = (canvasEl.clientWidth  / 2 - t.x) / t.k;
    const cy = (canvasEl.clientHeight / 2 - t.y) / t.k;
    newNode.x = cx + (Math.random() - 0.5) * 120;
    newNode.y = cy + (Math.random() - 0.5) * 120;
    data.nodes.push(newNode);

    if (newNode.connections) {
        newNode.connections.forEach(targetId => {
            const exists = data.links.some(l =>
                resolveId(l.source) === newNode.id && resolveId(l.target) === targetId
            );
            if (!exists) data.links.push({ source: newNode.id, target: targetId, label: "" });
        });
    }

    // Full redraw is acceptable for a single add; avoids complex incremental D3 bookkeeping
    d3.select("#canvas svg").remove();
    d3.select("#canvas #node-tooltip").remove();
    drawGraph(data);
    if (typeof window.refreshNodeList === "function") window.refreshNodeList();
};
