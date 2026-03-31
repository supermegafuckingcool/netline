// ============ Sidebar ============
const sidebar      = document.getElementById("sidebar");
const toggleBtn    = document.getElementById("sidebar-toggle-btn");
const chevron      = document.getElementById("sidebar-chevron");
const tabStrip     = document.getElementById("sidebar-tabs");
const contentPanel = document.getElementById("sidebar-content");

let sidebarOpen = false;

// ============ Escape key closes sidebar ============
document.addEventListener("keydown", e => {
    if (e.key === "Escape" && sidebarOpen) closeSidebar();
});

// ============ Unsaved notes guard ============
let notesUnsaved = false;
window.addEventListener("beforeunload", e => {
    if (notesUnsaved) {
        e.preventDefault();
        e.returnValue = "";
    }
});

// ============ Shared IP rows helper ============
function createIpRows(container, ips) {
    container.innerHTML = "";
    [...(ips.length > 0 ? ips : []), { address: "", subnet: "" }].forEach(ip => {
        addIpRow(container, ip.address, ip.subnet);
    });
}

function addIpRow(container, address = "", subnet = "") {
    const row = document.createElement("div");
    row.className = "ip-row";
    row.innerHTML = `
        <input type="text" class="ip-address" placeholder="e.g. 10.0.1.1" value="${address}" />
        <input type="text" class="ip-subnet" placeholder="/24" value="${subnet}" maxlength="4" />
        <button type="button" class="ip-remove-btn" title="Remove" style="visibility:${address ? 'visible' : 'hidden'};">
            <img src="images/icons/trash.svg" style="width:14px;height:14px;pointer-events:none;" />
        </button>
    `;
    const removeBtn    = row.querySelector(".ip-remove-btn");
    const addressInput = row.querySelector(".ip-address");
    const subnetInput  = row.querySelector(".ip-subnet");

    // Auto-prepend "/" when user starts typing a digit
    subnetInput.addEventListener("input", function() {
        let v = this.value;
        if (v.length > 0 && v[0] !== "/") this.value = "/" + v.replace(/\//g, "");
    });

    removeBtn.addEventListener("click", () => {
        row.remove();
        if (container.querySelectorAll(".ip-row").length === 0) addIpRow(container);
    });

    addressInput.addEventListener("input", function() {
        removeBtn.style.visibility = this.value.trim() ? "visible" : "hidden";
        const rows = container.querySelectorAll(".ip-row");
        if (row === rows[rows.length - 1] && this.value.trim()) addIpRow(container);
    });

    container.appendChild(row);
}

function collectIps(container) {
    const result = [];
    container.querySelectorAll(".ip-row").forEach(row => {
        const address = row.querySelector(".ip-address").value.trim();
        const subnet  = row.querySelector(".ip-subnet").value.trim();
        if (address) result.push({ address, subnet });
    });
    return result;
}

// ============ Tab definitions ============
const tabs = [
    {
        id: "add-node",
        icon: "images/icons/plus.svg",
        label: "Add Node",
        render: () => `
            <h3>Add Node</h3>
            <div style="display:flex;flex-direction:column;gap:12px;margin-top:8px;">
                <div class="field-group">
                    <label>Hostname</label>
                    <input id="input-hostname" type="text" placeholder="e.g. fw01" />
                </div>
                <div class="field-group">
                    <label>IP Address(es)</label>
                    <div id="input-ip-rows"></div>
                </div>
                <div class="field-group">
                    <label>System</label>
                    <input id="input-system" type="text" placeholder="e.g. A" />
                </div>
                <div class="field-group">
                    <label>Type</label>
                    <select id="input-type">
                        <option value="fw">Firewall (fw)</option>
                        <option value="client">Client</option>
                        <option value="server">Server</option>
                    </select>
                </div>
                <div class="field-group">
                    <label>Connect to <span style="font-weight:normal;color:#888">(ID or IP, comma-separated)</span></label>
                    <input id="input-connections" type="text" placeholder="e.g. 10.0.11.1" />
                    <div id="input-connections-warning" style="font-size:11px;color:#f0c040;min-height:14px;margin-top:2px;"></div>
                </div>
                <div id="add-node-error" style="font-size:12px;color:#c0392b;min-height:16px;"></div>
                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">
                    <button id="add-node-clear-btn" class="form-btn-secondary">Clear</button>
                    <button id="add-node-submit-btn" class="form-btn-primary">Add Node</button>
                </div>
            </div>
        `
    },
    {
        id: "nodes",
        icon: "images/icons/nodes.svg",
        label: "Nodes",
        render: () => `
            <h3>Nodes</h3>
            <div style="position:relative;margin-bottom:10px;">
                <input id="node-search" type="text" placeholder="Search nodes…"
                    style="width:100%;padding:7px 32px 7px 10px;border:1.5px solid #555;border-radius:6px;
                           font-size:13px;font-family:Arial,sans-serif;background:#3a3a3a;color:#eee;outline:none;" />
                <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#888;font-size:12px;pointer-events:none;">⌕</span>
            </div>
            <div id="node-list"></div>
        `
    },
    {
        id: "json",
        icon: "images/icons/json.svg",
        label: "JSON",
        render: () => `
            <h3>JSON Editor</h3>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="json-clean-btn" class="form-btn-secondary" style="font-size:12px;padding:5px 12px;">Clean JSON</button>
                <button id="json-export-btn" class="form-btn-secondary" style="font-size:12px;padding:5px 12px;">Export JSON</button>
            </div>
            <div id="json-error" style="font-size:12px;color:#c0392b;min-height:16px;margin-bottom:4px;"></div>
            <textarea id="json-editor" spellcheck="false"></textarea>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
                <button id="json-reload-btn" class="form-btn-secondary">Reload</button>
                <button id="json-save-btn" class="form-btn-primary">Save</button>
            </div>
        `
    },
];

let activeTab = tabs[0].id;

// ============ Build tabs and panels ============
tabs.forEach(tab => {
    const btn = document.createElement("button");
    btn.className = "sidebar-tab" + (tab.id === activeTab ? " active" : "");
    btn.title = tab.label;
    btn.innerHTML = `<img src="${tab.icon}" alt="${tab.label}" />`;
    btn.addEventListener("click", () => selectTab(tab.id));
    tabStrip.appendChild(btn);

    const panel = document.createElement("div");
    panel.className = "panel" + (tab.id === activeTab ? " active" : "");
    panel.id = `panel-${tab.id}`;
    panel.innerHTML = tab.render();
    contentPanel.appendChild(panel);
});

// Hidden node-detail panel
(function() {
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.id = "panel-node-detail";
    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 id="node-detail-title" style="margin:0;"></h3>
            <button id="node-detail-edit-btn" class="form-btn-secondary" style="padding:5px 12px;font-size:12px;">Edit Node</button>
        </div>
        <div id="node-detail-meta" style="font-size:12px;color:#aaa;font-weight:normal;margin-bottom:14px;line-height:1.8;"></div>
        <div class="field-group" style="margin-bottom:8px;">
            <label>Notes <span style="font-weight:normal;color:#888;font-size:11px;">(markdown)</span></label>
            <textarea id="node-detail-notes" spellcheck="false" placeholder="Enter notes in markdown…"></textarea>
        </div>
        <div id="node-detail-preview" class="markdown-preview"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
            <button id="node-detail-preview-btn" class="form-btn-secondary" style="font-size:12px;padding:5px 12px;">Preview</button>
            <button id="node-detail-save-btn" class="form-btn-primary">Save Notes</button>
        </div>
        <div id="node-detail-error" style="font-size:12px;color:#f1948a;min-height:16px;margin-top:6px;"></div>
    `;
    contentPanel.appendChild(panel);
})();

wireAddNodeForm();
// wireNodeList and wireJsonEditor called by graph.js once data is ready

// Load notes from notes.json into memory
window.nodeNotes = {};
fetch("/notes")
    .then(r => r.ok ? r.json() : {})
    .catch(() => ({}))
    .then(data => { window.nodeNotes = data; });

// ============ Simple markdown renderer ============
function renderMarkdown(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/^- (.+)$/gm, "<li>$1</li>")
        .replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
        .replace(/\n\n/g, "</p><p>")
        .replace(/^(?!<[hul]|<\/[hul])/gm, "")
        .replace(/(.+)/gs, s => s.startsWith("<") ? s : `<p>${s}</p>`);
}

// ============ Add Node Form ============
function wireAddNodeForm() {
    const submitBtn = document.getElementById("add-node-submit-btn");
    const clearBtn  = document.getElementById("add-node-clear-btn");
    const ipRows    = document.getElementById("input-ip-rows");
    if (!submitBtn) return;

    addIpRow(ipRows);

    ["input-hostname","input-system","input-type"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("focus", () => el.style.borderColor = "#de8691");
        el.addEventListener("blur",  () => el.style.borderColor = "#ccc");
    });

    // Validate connections in real-time — warn if target not found
    const connInput = document.getElementById("input-connections");
    connInput.addEventListener("input", function() {
        const warning = document.getElementById("input-connections-warning");
        const refs = this.value.split(",").map(s => s.trim()).filter(Boolean);
        const nodes = (window.currentGraphData || {}).nodes || [];
        const unknown = refs.filter(ref => {
            const byIp = nodes.some(n => Array.isArray(n.ips)
                ? n.ips.some(i => i.address === ref)
                : (n.ip === ref));
            const byId = nodes.some(n => n.id === ref);
            return !byIp && !byId;
        });
        warning.textContent = unknown.length
            ? `Unknown: ${unknown.join(", ")}`
            : "";
    });

    clearBtn.addEventListener("click", () => {
        ["input-hostname","input-system","input-connections"]
            .forEach(id => document.getElementById(id).value = "");
        document.getElementById("input-type").selectedIndex = 0;
        document.getElementById("add-node-error").textContent = "";
        document.getElementById("input-connections-warning").textContent = "";
        ipRows.innerHTML = "";
        addIpRow(ipRows);
    });

    submitBtn.addEventListener("click", () => {
        const hostname    = document.getElementById("input-hostname").value.trim();
        const system      = document.getElementById("input-system").value.trim();
        const type        = document.getElementById("input-type").value;
        const connRaw     = document.getElementById("input-connections").value.trim();
        const connections = connRaw ? connRaw.split(",").map(s => s.trim()).filter(Boolean) : [];
        const ips         = collectIps(ipRows);
        const errorEl     = document.getElementById("add-node-error");

        if (!hostname || !system) { errorEl.textContent = "Hostname and System are required."; return; }
        if (ips.length === 0)     { errorEl.textContent = "At least one IP address is required."; return; }

        const id      = `${system}-${hostname}`;
        const newNode = { id, hostname, ips, type, system, ...(connections.length ? { connections } : {}) };

        fetch("/add-node", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newNode)
        })
        .then(r => r.json())
        .then(res => {
            if (res.error) { errorEl.textContent = res.error; return; }
            if (typeof window.addNodeToGraph === "function") window.addNodeToGraph(res.node);
            ["input-hostname","input-system","input-connections"].forEach(id => document.getElementById(id).value = "");
            document.getElementById("input-type").selectedIndex = 0;
            document.getElementById("input-connections-warning").textContent = "";
            ipRows.innerHTML = "";
            addIpRow(ipRows);
            errorEl.textContent = "";
        })
        .catch(err => { console.error(err); errorEl.textContent = "Server error — could not save node."; });
    });
}

// ============ JSON Editor ============
function wireJsonEditor() {
    const editor    = document.getElementById("json-editor");
    const saveBtn   = document.getElementById("json-save-btn");
    const reloadBtn = document.getElementById("json-reload-btn");
    const cleanBtn  = document.getElementById("json-clean-btn");
    const exportBtn = document.getElementById("json-export-btn");
    const errorEl   = document.getElementById("json-error");
    if (!editor) return;

    const SIM_KEYS = ["index","x","y","vx","vy","fx","fy"];

    function loadJson() {
        fetch("/graph")
            .then(r => r.ok ? r.json() : { nodes: [], links: [] })
            .catch(() => ({ nodes: [], links: [] }))
            .then(data => { editor.value = JSON.stringify(data, null, 4); errorEl.textContent = ""; });
    }
    loadJson();

    reloadBtn.addEventListener("click", loadJson);

    // Clean: strip simulation state + deduplicate links
    cleanBtn.addEventListener("click", () => {
        let parsed;
        try { parsed = JSON.parse(editor.value); }
        catch (e) { errorEl.textContent = "Invalid JSON: " + e.message; return; }

        parsed.nodes = parsed.nodes.map(n => {
            const clean = { ...n };
            SIM_KEYS.forEach(k => delete clean[k]);
            return clean;
        });

        // Deduplicate links
        const seen = new Set();
        parsed.links = parsed.links.filter(l => {
            const s = typeof l.source === "object" ? l.source.id : l.source;
            const t = typeof l.target === "object" ? l.target.id : l.target;
            const key = `${s}||${t}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        editor.value = JSON.stringify(parsed, null, 4);
        errorEl.style.color = "#27ae60";
        errorEl.textContent = "Cleaned — click Save to persist.";
        setTimeout(() => { errorEl.textContent = ""; errorEl.style.color = "#c0392b"; }, 3000);
    });

    exportBtn.addEventListener("click", () => {
        let parsed;
        try { parsed = JSON.parse(editor.value); }
        catch (e) { errorEl.textContent = "Invalid JSON: " + e.message; return; }

        // Clean before export — strip simulation state and deduplicate links
        parsed.nodes = parsed.nodes.map(n => {
            const clean = { ...n };
            SIM_KEYS.forEach(k => delete clean[k]);
            return clean;
        });
        const seen = new Set();
        parsed.links = parsed.links.filter(l => {
            const s = typeof l.source === "object" ? l.source.id : l.source;
            const t = typeof l.target === "object" ? l.target.id : l.target;
            const key = s + "||" + t;
            if (seen.has(key)) return false;
            seen.add(key); return true;
        });

        const text = JSON.stringify(parsed, null, 4);
        editor.value = text;

        const blob = new Blob([text], { type: "application/json" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = "netline-graph.json";
        a.click();
        URL.revokeObjectURL(url);
    });

    saveBtn.addEventListener("click", () => {
        let parsed;
        try { parsed = JSON.parse(editor.value); }
        catch (e) { errorEl.textContent = "Invalid JSON: " + e.message; return; }

        fetch("/save-graph", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsed)
        })
        .then(r => r.json())
        .then(res => {
            if (res.error) { errorEl.textContent = res.error; return; }
            window.currentGraphData = parsed;
            d3.select("#canvas svg").remove();
            d3.select("#canvas #node-tooltip").remove();
            drawGraph(parsed);
            renderNodeList();
            errorEl.style.color = "#27ae60";
            errorEl.textContent = "Saved.";
            setTimeout(() => { errorEl.textContent = ""; errorEl.style.color = "#c0392b"; }, 2000);
        })
        .catch(() => { errorEl.textContent = "Server error — could not save."; });
    });
}

// ============ Node List ============
function wireNodeList() {
    const listEl = document.getElementById("node-list");
    if (!listEl) return;
    renderNodeList();

    // Wire search
    const searchEl = document.getElementById("node-search");
    if (searchEl) {
        searchEl.addEventListener("input", function() {
            const q = this.value.toLowerCase();
            document.querySelectorAll(".node-list-item").forEach(item => {
                const text = item.querySelector(".node-list-label").textContent.toLowerCase()
                    + item.dataset.id.toLowerCase();
                item.style.display = text.includes(q) ? "" : "none";
            });
        });
        searchEl.addEventListener("focus", () => searchEl.style.borderColor = "#de8691");
        searchEl.addEventListener("blur",  () => searchEl.style.borderColor = "#555");
    }
}

function renderNodeList() {
    const listEl = document.getElementById("node-list");
    if (!listEl) return;

    const nodes = (window.currentGraphData || {}).nodes || [];
    listEl.innerHTML = "";

    if (nodes.length === 0) {
        listEl.innerHTML = `<p style="color:#888;font-size:13px;font-weight:normal">No nodes yet.</p>`;
        return;
    }

    nodes.forEach(node => {
        const ips = Array.isArray(node.ips)
            ? node.ips
            : (node.ip ? [{ address: node.ip.replace(/\/\d+$/, ""), subnet: node.subnet || (node.ip.match(/\/\d+$/) || [""])[0] }] : []);

        const item = document.createElement("div");
        item.className = "node-list-item";
        item.dataset.id = node.id;

        item.innerHTML = `
            <div class="node-list-header">
                <span class="node-list-label">${node.system} · ${node.hostname}</span>
                <span class="node-list-meta">${node.type}</span>
                <span class="node-list-chevron">▸</span>
            </div>
            <div class="node-list-form" style="display:none;">
                <div class="field-group">
                    <label>Hostname</label>
                    <input class="edit-hostname" type="text" value="${node.hostname}" />
                </div>
                <div class="field-group">
                    <label>IP Address(es)</label>
                    <div class="edit-ip-rows"></div>
                </div>
                <div class="field-group">
                    <label>System</label>
                    <input class="edit-system" type="text" value="${node.system}" />
                </div>
                <div class="field-group">
                    <label>Type</label>
                    <select class="edit-type">
                        <option value="fw" ${node.type==="fw"?"selected":""}>Firewall (fw)</option>
                        <option value="client" ${node.type==="client"?"selected":""}>Client</option>
                        <option value="server" ${node.type==="server"?"selected":""}>Server</option>
                    </select>
                </div>
                <div class="field-group">
                    <label>Connections</label>
                    <input class="edit-connections" type="text" value="${(node.connections||[]).join(", ")}" />
                    <div class="edit-connections-warning" style="font-size:11px;color:#f0c040;min-height:14px;margin-top:2px;"></div>
                </div>
                <div class="node-edit-error" style="font-size:12px;color:#f1948a;min-height:16px;"></div>
                <div style="display:flex;justify-content:space-between;gap:8px;margin-top:8px;">
                    <button class="delete-btn form-btn-danger">Delete</button>
                    <button class="save-edit-btn form-btn-primary">Save</button>
                </div>
            </div>
        `;

        const ipRowsContainer = item.querySelector(".edit-ip-rows");
        createIpRows(ipRowsContainer, ips);

        // Validate connections in real-time
        item.querySelector(".edit-connections").addEventListener("input", function() {
            const warning = item.querySelector(".edit-connections-warning");
            const refs = this.value.split(",").map(s => s.trim()).filter(Boolean);
            const allNodes = (window.currentGraphData || {}).nodes || [];
            const unknown = refs.filter(ref => {
                const byIp = allNodes.some(n => Array.isArray(n.ips)
                    ? n.ips.some(i => i.address === ref)
                    : (n.ip === ref));
                const byId = allNodes.some(n => n.id === ref);
                return !byIp && !byId;
            });
            warning.textContent = unknown.length ? `Unknown: ${unknown.join(", ")}` : "";
        });

        // Toggle expand
        item.querySelector(".node-list-header").addEventListener("click", () => {
            const form = item.querySelector(".node-list-form");
            const chev = item.querySelector(".node-list-chevron");
            const open = form.style.display === "none";
            form.style.display = open ? "block" : "none";
            chev.textContent   = open ? "▾" : "▸";
            item.classList.toggle("selected", open);

            const expanded = [...document.querySelectorAll(".node-list-item")]
                .filter(el => el.querySelector(".node-list-form").style.display !== "none")
                .map(el => el.dataset.id);
            if (typeof window.setHighlightedNodes === "function") window.setHighlightedNodes(expanded);
        });

        // Save edit
        item.querySelector(".save-edit-btn").addEventListener("click", () => {
            const errorEl     = item.querySelector(".node-edit-error");
            const hostname    = item.querySelector(".edit-hostname").value.trim();
            const system      = item.querySelector(".edit-system").value.trim();
            const type        = item.querySelector(".edit-type").value;
            const connRaw     = item.querySelector(".edit-connections").value.trim();
            const connections = connRaw ? connRaw.split(",").map(s => s.trim()).filter(Boolean) : [];
            const ips         = collectIps(ipRowsContainer);

            if (!hostname || !system) { errorEl.textContent = "Hostname and System are required."; return; }
            if (ips.length === 0)     { errorEl.textContent = "At least one IP address is required."; return; }

            const updated = { ...node, hostname, ips, system, type,
                ...(connections.length ? { connections } : { connections: [] }) };
            delete updated.ip; delete updated.subnet;

            fetch("/edit-node", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ originalId: node.id, node: updated })
            })
            .then(r => r.json())
            .then(res => {
                if (res.error) { errorEl.textContent = res.error; return; }
                const data   = window.currentGraphData;
                const newId  = res.node.id;
                const oldId  = node.id;

                // Update node in place, with potentially new ID
                const idx = data.nodes.findIndex(n => n.id === oldId);
                if (idx !== -1) data.nodes[idx] = res.node;

                // Update all links that referenced the old ID
                data.links = data.links
                    .filter(l => {
                        const s = typeof l.source === "object" ? l.source.id : l.source;
                        return s !== oldId;
                    })
                    .map(l => {
                        const t = typeof l.target === "object" ? l.target.id : l.target;
                        return t === oldId ? { ...l, target: newId } : l;
                    });

                if (res.node.connections) {
                    res.node.connections.forEach(t => data.links.push({ source: newId, target: t }));
                }

                // Migrate note key in memory if ID changed
                if (newId !== oldId && window.nodeNotes && window.nodeNotes[oldId]) {
                    window.nodeNotes[newId] = window.nodeNotes[oldId];
                    delete window.nodeNotes[oldId];
                }

                d3.select("#canvas svg").remove();
                d3.select("#canvas #node-tooltip").remove();
                drawGraph(data);
                renderNodeList();
            })
            .catch(() => { errorEl.textContent = "Server error."; });
        });

        // Delete
        item.querySelector(".delete-btn").addEventListener("click", () => {
            const errorEl = item.querySelector(".node-edit-error");
            if (!confirm(`Delete node "${node.id}"?`)) return;
            fetch("/delete-node", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: node.id })
            })
            .then(r => r.json())
            .then(res => {
                if (res.error) { errorEl.textContent = res.error; return; }
                const data = window.currentGraphData;
                data.nodes = data.nodes.filter(n => n.id !== node.id);
                data.links = data.links.filter(l => {
                    const s = typeof l.source === "object" ? l.source.id : l.source;
                    const t = typeof l.target === "object" ? l.target.id : l.target;
                    return s !== node.id && t !== node.id;
                });
                d3.select("#canvas svg").remove();
                d3.select("#canvas #node-tooltip").remove();
                drawGraph(data);
                renderNodeList();
            })
            .catch(() => { errorEl.textContent = "Server error."; });
        });

        listEl.appendChild(item);
    });
}

window.refreshNodeList = renderNodeList;

// ============ Node Detail Panel ============
// Escape HTML special chars to prevent XSS when injecting into innerHTML
function escHtml(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

window.selectNode = function(id) {
    const data  = window.currentGraphData || {};
    const node  = (data.nodes || []).find(n => n.id === id);
    if (!node) return;

    document.getElementById("node-detail-title").textContent = node.system + " · " + node.hostname;

    const ipList = Array.isArray(node.ips) && node.ips.length
        ? node.ips.map(i => escHtml(i.address + (i.subnet || ""))).join(", ")
        : escHtml(node.ip || "—");
    document.getElementById("node-detail-meta").innerHTML =
        `<span style="color:#ccc">ID</span>&nbsp;&nbsp;${escHtml(node.id)}<br>` +
        `<span style="color:#ccc">IP</span>&nbsp;&nbsp;${ipList}<br>` +
        `<span style="color:#ccc">Type</span>&nbsp;&nbsp;${escHtml(node.type)}`;

    const notesEl   = document.getElementById("node-detail-notes");
    const previewEl = document.getElementById("node-detail-preview");
    notesEl.value = (window.nodeNotes || {})[id] || "";
    notesUnsaved = false;
    document.getElementById("node-detail-error").textContent = "";

    notesEl.oninput = () => { notesUnsaved = true; };

    // Default to preview mode
    const savedText = notesEl.value;
    previewEl.innerHTML = savedText
        ? renderMarkdown(savedText)
        : "<em style='color:#888'>No notes yet. Click Edit to add some.</em>";
    previewEl.style.display = "block";
    notesEl.style.display = "none";

    // Save button
    const saveBtn = document.getElementById("node-detail-save-btn");
    const newSave = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSave, saveBtn);
    newSave.addEventListener("click", () => {
        const notes   = notesEl.value;
        const errorEl = document.getElementById("node-detail-error");
        fetch("/save-note", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: node.id, notes })
        })
        .then(r => r.json())
        .then(res => {
            if (res.error) { errorEl.textContent = res.error; return; }
            if (!window.nodeNotes) window.nodeNotes = {};
            if (notes.trim()) window.nodeNotes[id] = notes;
            else delete window.nodeNotes[id];
            notesUnsaved = false;
            errorEl.style.color = "#6fcf97";
            errorEl.textContent = "Saved.";
            setTimeout(() => { errorEl.textContent = ""; }, 2000);
        })
        .catch(() => { errorEl.textContent = "Server error."; });
    });

    // Preview button — toggles rendered markdown
    const prevBtn = document.getElementById("node-detail-preview-btn");
    const newPrev = prevBtn.cloneNode(true);
    prevBtn.parentNode.replaceChild(newPrev, prevBtn);
    let previewing = true; // start in preview mode
    newPrev.textContent = "Edit";
    newPrev.addEventListener("click", () => {
        previewing = !previewing;
        if (previewing) {
            previewEl.innerHTML = renderMarkdown(notesEl.value) || "<em style='color:#888'>Nothing to preview.</em>";
            previewEl.style.display = "block";
            notesEl.style.display = "none";
            newPrev.textContent = "Edit";
        } else {
            previewEl.style.display = "none";
            notesEl.style.display = "";
            newPrev.textContent = "Preview";
        }
    });

    // Edit Node button
    const editBtn = document.getElementById("node-detail-edit-btn");
    const newEdit = editBtn.cloneNode(true);
    editBtn.parentNode.replaceChild(newEdit, editBtn);
    newEdit.addEventListener("click", () => {
        selectTab("nodes");
        setTimeout(() => {
            const listEl = document.getElementById("node-list");
            if (!listEl) return;
            listEl.querySelectorAll(".node-list-item").forEach(item => {
                if (item.dataset.id === id) {
                    const form = item.querySelector(".node-list-form");
                    const chev = item.querySelector(".node-list-chevron");
                    form.style.display = "block";
                    chev.textContent = "▾";
                    item.classList.add("selected");
                    item.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }
            });
            const expanded = [...listEl.querySelectorAll(".node-list-item")]
                .filter(el => el.querySelector(".node-list-form").style.display !== "none")
                .map(el => el.dataset.id);
            if (typeof window.setHighlightedNodes === "function") window.setHighlightedNodes(expanded);
        }, 50);
    });

    // Open detail panel
    activeTab = "node-detail";
    tabStrip.querySelectorAll(".sidebar-tab").forEach(btn => btn.classList.remove("active"));
    contentPanel.querySelectorAll(".panel").forEach(p => {
        p.classList.toggle("active", p.id === "panel-node-detail");
    });
    if (!sidebarOpen) openSidebar();

    // Toggle highlight
    if (typeof window.setHighlightedNodes === "function") {
        const current = Array.from(document.querySelectorAll(".node-list-item.selected")).map(el => el.dataset.id);
        const idx = current.indexOf(id);
        if (idx === -1) current.push(id);
        else current.splice(idx, 1);
        window.setHighlightedNodes(current);
    }
};

// ============ Sidebar open/close ============
function selectTab(id) {
    activeTab = id;
    tabStrip.querySelectorAll(".sidebar-tab").forEach((btn, i) => {
        btn.classList.toggle("active", tabs[i].id === id);
    });
    contentPanel.querySelectorAll(".panel").forEach(p => {
        p.classList.toggle("active", p.id === `panel-${id}`);
    });
    if (!sidebarOpen) openSidebar();
}

function openSidebar() {
    sidebarOpen = true;
    sidebar.classList.add("open");
    chevron.style.transform = "scaleX(1)";
}

function closeSidebar() {
    sidebarOpen = false;
    sidebar.classList.remove("open");
    chevron.style.transform = "scaleX(-1)";
}

toggleBtn.addEventListener("click", () => {
    sidebarOpen ? closeSidebar() : openSidebar();
});

window.openAddNodePanel = function() { selectTab("add-node"); };

// ============ UI overlay (bottom-right buttons) ============
const uiLayer = d3.select("#canvas").append("div").attr("id", "ui-layer");

const bottomRight = uiLayer.append("div")
    .style("position", "absolute").style("bottom", "20px").style("right", "20px")
    .style("pointer-events", "auto").style("display", "flex")
    .style("align-items", "center").style("gap", "0px");

let isExpanded = false;

const chevronImg = bottomRight.append("button")
    .style("width", "20px").style("height", "45px").style("display", "flex")
    .style("align-items", "center").style("justify-content", "center")
    .style("cursor", "pointer").style("background", "white")
    .style("border", "2px solid #333").style("border-radius", "7px")
    .style("transition", "all 0.2s ease")
    .on("click", () => {
        isExpanded = !isExpanded;
        expandPanel
            .style("max-width",   isExpanded ? "200px" : "0px")
            .style("opacity",     isExpanded ? "1"     : "0")
            .style("margin-left", isExpanded ? "5px"   : "0px");
        chevronImg.style("transform", isExpanded ? "scaleX(-1)" : "scaleX(1)");
    })
    .append("img")
        .attr("src", "images/icons/chevron-left-small.svg")
        .style("width", "24px").style("height", "24px")
        .style("pointer-events", "none").style("transform", "scaleX(1)")
        .style("transition", "transform 0.3s ease");

const expandPanel = bottomRight.append("div")
    .style("display", "flex").style("flex-direction", "row").style("gap", "8px")
    .style("overflow", "hidden").style("max-width", "0px").style("opacity", "0")
    .style("margin-left", "0px")
    .style("transition", "max-width 0.3s ease, opacity 0.3s ease, margin-left 0.3s ease");

// Export SVG button — in the expand panel
expandPanel.append("button")
    .style("width", "45px").style("height", "45px").style("display", "flex")
    .style("align-items", "center").style("justify-content", "center")
    .style("cursor", "pointer").style("background", "white")
    .style("border", "2px solid #333").style("border-radius", "8px")
    .style("transition", "all 0.2s ease")
    .on("click", () => {
        const svgEl = document.querySelector("#canvas svg");
        if (!svgEl) return;
        const serializer = new XMLSerializer();
        const svgStr = serializer.serializeToString(svgEl);
        const blob = new Blob([svgStr], { type: "image/svg+xml" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = "netline-export.svg";
        a.click();
        URL.revokeObjectURL(url);
    })
    .append("img").attr("src", "images/icons/export.svg")
        .style("width", "24px").style("height", "24px").style("pointer-events", "none");

// Home / reset zoom button
bottomRight.append("button")
    .style("width", "45px").style("height", "45px").style("display", "flex")
    .style("align-items", "center").style("justify-content", "center")
    .style("cursor", "pointer").style("background", "white")
    .style("border", "2px solid #333").style("border-radius", "8px")
    .style("margin-left", "5px").style("transition", "all 0.2s ease")
    .on("click", () => { if (typeof window.resetZoom === "function") window.resetZoom(); })
    .append("img").attr("src", "images/icons/fullscreen.svg")
        .style("width", "24px").style("height", "24px").style("pointer-events", "none");
