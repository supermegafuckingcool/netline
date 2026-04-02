// ============ Sidebar ============
// Shared time formatter — delegates to graph.js fmtTime if loaded, else fallback
function fmtDatetime(d) {
    if (!(d instanceof Date)) d = new Date(d);
    if (typeof fmtTime === "function") return fmtTime(d);
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+" "+p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds());
}
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
        id: "events",
        icon: "images/icons/placeholder.svg",
        label: "Events",
        render: () => `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <h3 style="margin:0;">Events</h3>
                <div style="display:flex;align-items:center;gap:8px;">
                    <label style="font-size:11px;color:#888;font-weight:normal;">TZ</label>
                    <select id="tz-select" style="font-size:11px;padding:3px 6px;border:1.5px solid #555;border-radius:5px;background:#3a3a3a;color:#eee;outline:none;">
                        <option value="Europe/Paris">CET (Paris)</option>
                        <option value="UTC">UTC</option>
                        <option value="America/New_York">EST (New York)</option>
                        <option value="America/Los_Angeles">PST (Los Angeles)</option>
                        <option value="Asia/Tokyo">JST (Tokyo)</option>
                        <option value="Asia/Shanghai">CST (Shanghai)</option>
                        <option value="Europe/London">GMT (London)</option>
                        <option value="Europe/Berlin">CET (Berlin)</option>
                        <option value="Asia/Dubai">GST (Dubai)</option>
                    </select>
                </div>
            </div>
            <div style="display:flex;gap:16px;margin-bottom:10px;">
                <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px;font-weight:normal;">
                    <input type="checkbox" id="filter-blue" checked
                        style="accent-color:#5153B4;width:14px;height:14px;" />
                    <span style="color:#5153B4;font-weight:bold;">Own (Blue)</span>
                </label>
                <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px;font-weight:normal;">
                    <input type="checkbox" id="filter-red" checked
                        style="accent-color:#B45153;width:14px;height:14px;" />
                    <span style="color:#B45153;font-weight:bold;">Enemy (Red)</span>
                </label>
            </div>
            <div id="events-feed-list" style="overflow-y:auto;"></div>
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
    // Events tab gets a small text label below the icon to fit neatly
    if (tab.id === "events") {
        btn.innerHTML = `<span style="font-size:9px;font-weight:bold;color:rgba(255,255,255,0.7);font-family:Arial,sans-serif;letter-spacing:0.05em;line-height:1;">EVENT</span>`;
    } else {
        btn.innerHTML = `<img src="${tab.icon}" alt="${tab.label}" />`;
    }
    btn.addEventListener("click", () => {
        selectTab(tab.id);
        if (tab.id === "events") setTimeout(wireEventsTab, 10);
    });
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

        <hr style="border:none;border-top:1.5px solid #ddd;margin:16px 0 12px" />

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <h3 style="margin:0;font-size:14px;">Events</h3>
            <button id="node-detail-add-event-btn" class="form-btn-secondary" style="font-size:12px;padding:5px 12px;">+ Add Event</button>
        </div>

        <div id="node-detail-event-form" style="display:none;background:#f0eeee;border-radius:8px;padding:12px;margin-bottom:12px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                <div class="field-group" style="grid-column:1/-1">
                    <label>Date &amp; Time</label>
                    <div style="display:flex;gap:6px;">
                        <input id="ev-date" type="date" style="flex:1;padding:7px 10px;border:1.5px solid #ccc;border-radius:6px;font-size:13px;font-family:Arial,sans-serif;outline:none;" />
                        <input id="ev-time" type="text" placeholder="HH:MM:SS" maxlength="8" pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}" style="width:90px;padding:7px 10px;border:1.5px solid #ccc;border-radius:6px;font-size:13px;font-family:Arial,sans-serif;outline:none;" />
                    </div>
                    <input id="ev-datetime" type="hidden" />
                </div>
                <div class="field-group" style="grid-column:1/-1">
                    <label>Description</label>
                    <textarea id="ev-description" rows="2" style="resize:vertical;padding:7px 10px;border:1.5px solid #ccc;border-radius:6px;font-size:13px;font-family:Arial,sans-serif;outline:none;width:100%;"></textarea>
                </div>
                <div class="field-group">
                    <label>Actor</label>
                    <select id="ev-actor" style="border-color:#ccc;color:#5153B4;font-weight:bold;background:#e8e8f8;">
                        <option value="blue">Own (Blue)</option>
                        <option value="red">Enemy (Red)</option>
                    </select>
                </div>
                <div class="field-group">
                    <label>Severity</label>
                    <select id="ev-severity">
                        <option value="none" selected>None</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                    </select>
                </div>
                <div class="field-group">
                    <label>Source IP <span style="font-weight:normal;color:#888">(optional)</span></label>
                    <input id="ev-srcip" type="text" placeholder="e.g. 10.0.1.5" />
                </div>
                <div class="field-group">
                    <label>Dest IP <span style="font-weight:normal;color:#888">(optional)</span></label>
                    <input id="ev-dstip" type="text" placeholder="e.g. 10.0.1.1" />
                </div>
                <div class="field-group">
                    <label>MITRE ATT&CK <span style="font-weight:normal;color:#888">(optional)</span></label>
                    <input id="ev-mitre" type="text" placeholder="e.g. T1078" />
                </div>
                <div class="field-group">
                    <label>Tool <span style="font-weight:normal;color:#888">(optional)</span></label>
                    <input id="ev-tool" type="text" placeholder="e.g. Mimikatz" />
                </div>
                <div class="field-group" style="grid-column:1/-1">
                    <label>CVE <span style="font-weight:normal;color:#888">(optional)</span></label>
                    <input id="ev-cve" type="text" placeholder="e.g. CVE-2021-44228" />
                </div>
            </div>
            <div id="ev-error" style="font-size:12px;color:#c0392b;min-height:14px;margin-bottom:6px;"></div>
            <div style="display:flex;justify-content:flex-end;gap:8px;">
                <button id="ev-cancel-btn" class="form-btn-secondary" style="font-size:12px;padding:5px 12px;">Cancel</button>
                <button id="ev-save-btn" class="form-btn-primary" style="font-size:12px;padding:5px 14px;">Save Event</button>
            </div>
        </div>

        <div id="node-detail-events-list"></div>
    `;
    contentPanel.appendChild(panel);
})();

wireAddNodeForm();
// wireNodeList and wireJsonEditor called by graph.js once data is ready

// Load notes into memory
window.nodeNotes = {};
fetch("/notes")
    .then(r => r.ok ? r.json() : {})
    .catch(() => ({}))
    .then(data => { window.nodeNotes = data; });

// ============ Timeline controls ============
(function() {
    let playing = false;
    let playInterval = null;

    const slider    = document.getElementById("timeline-slider");
    const playBtn   = document.getElementById("tl-play-pause");
    const stepBack  = document.getElementById("tl-step-back");
    const stepFwd   = document.getElementById("tl-step-fwd");
    if (!slider) return;

    function getEvents() { return window.allEvents || []; }

    function getSortedTimes() {
        const eventTimes = [...new Set(getEvents().map(e => new Date(e.datetime).getTime()))].sort((a,b) => a-b);
        // Always include the buffer "before events" stop as the first snap point
        const buf = window._timelineBuffer;
        if (buf != null && (eventTimes.length === 0 || eventTimes[0] !== buf)) {
            return [buf, ...eventTimes];
        }
        return eventTimes;
    }

    function setTime(ms, fromPlayback) {
        const events = getEvents();
        if (!events.length) return;
        const min = window._timelineMin;
        const max = window._timelineMax;
        ms = Math.max(min, Math.min(max, ms));
        slider.value = ms;
        if (typeof updateTimelineLabel === "function") updateTimelineLabel(ms);
        if (typeof window.updateActiveEvents === "function") window.updateActiveEvents(ms, fromPlayback || false);
    }

    // Slider drag — snaps to nearest event time and shows cards
    slider.addEventListener("input", () => {
        const times = getSortedTimes();
        if (!times.length) return;
        const val = parseInt(slider.value);
        const nearest = times.reduce((a, b) => Math.abs(b - val) < Math.abs(a - val) ? b : a);
        slider.value = nearest;
        setTime(nearest, true);
    });

    stepBack.addEventListener("click", () => {
        const times = getSortedTimes();
        const cur   = parseInt(slider.value);
        const prev  = [...times].reverse().find(t => t < cur);
        if (prev != null) setTime(prev, true);
    });

    stepFwd.addEventListener("click", () => {
        const times = getSortedTimes();
        const cur   = parseInt(slider.value);
        const next  = times.find(t => t > cur);
        if (next != null) setTime(next, true);
    });

    playBtn.addEventListener("click", () => {
        playing = !playing;
        playBtn.innerHTML = playing ? "&#9646;&#9646;" : "&#9654;";
        if (playing) {
            // If at end, restart
            const times = getSortedTimes();
            if (times.length && parseInt(slider.value) >= times[times.length - 1]) {
                setTime(times[0]);
            }
            playInterval = setInterval(() => {
                const times = getSortedTimes();
                const cur   = parseInt(slider.value);
                const next  = times.find(t => t > cur);
                if (next != null) {
                    slider.value = next;
                    setTime(next, true);
                } else {
                    playing = false;
                    playBtn.innerHTML = "&#9654;";
                    clearInterval(playInterval);
                    window._eventCardsEnabled = false;
                    if (typeof window.updateActiveEvents === "function")
                        window.updateActiveEvents(parseInt(slider.value), false);
                }
            }, 1200);
        } else {
            clearInterval(playInterval);
            window._eventCardsEnabled = false;
            if (typeof window.updateActiveEvents === "function")
                window.updateActiveEvents(parseInt(slider.value), false);
        }
    });

    // openEventFeed — opens events tab in sidebar
    window.openEventFeed = function() {
        selectTab("events");
        setTimeout(wireEventsTab, 10);
    };
})();

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

// ============ Events Tab ============
function wireEventsTab() {
    const tzSel = document.getElementById("tz-select");
    if (tzSel && !tzSel._wired) {
        tzSel._wired = true;
        window.selectedTimezone = "Europe/Paris";
        tzSel.value = "Europe/Paris";
        tzSel.addEventListener("change", function() {
            window.selectedTimezone = this.value;
            if (typeof updateEventFeed === "function") updateEventFeed();
        });
    }

    // Filter checkboxes
    const filterBlue = document.getElementById("filter-blue");
    const filterRed  = document.getElementById("filter-red");
    if (filterBlue && !filterBlue._wired) {
        filterBlue._wired = true;
        filterRed._wired  = true;
        const onChange = () => {
            window._filterBlue = filterBlue.checked;
            window._filterRed  = filterRed.checked;
            if (typeof updateEventFeed      === "function") updateEventFeed();
            if (typeof updateActiveEvents   === "function") updateActiveEvents(window.currentTime || 0);
        };
        filterBlue.addEventListener("change", onChange);
        filterRed.addEventListener("change",  onChange);
        // Init globals
        window._filterBlue = true;
        window._filterRed  = true;
    }

    if (typeof updateEventFeed === "function") updateEventFeed();
}
window.wireEventsTab = wireEventsTab;

// ============ Node Detail Panel ============

// ── Render events list inside node detail panel ──────────────────────────────
function renderNodeEvents(nodeId, container) {
    if (!container) return;
    const events = (window.allEvents || [])
        .filter(e => e.nodeId === nodeId)
        .sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

    container.innerHTML = "";
    if (events.length === 0) {
        container.innerHTML = `<p style="color:#888;font-size:12px;font-weight:normal;margin:0;">No events yet.</p>`;
        return;
    }

    events.forEach(e => {
        const color = e.actor === "red" ? "#B45153" : "#5153B4";
        const sev   = { none:"#888", low:"#6fcf97", medium:"#f2c94c", high:"#f2994a", critical:"#eb5757" }[e.severity] || "#888";
        const time  = fmtDatetime(e.datetime);

        const item = document.createElement("div");
        item.style.cssText = `border-left:3px solid ${color};padding:8px 10px;margin-bottom:6px;background:#f0eeee;border-radius:0 6px 6px 0;cursor:pointer;`;
        item.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
                <span style="color:${color};font-size:11px;font-weight:bold;">${escHtml(e.actor).toUpperCase()}</span>
                <div style="display:flex;gap:6px;align-items:center;">
                    ${e.severity !== "none" ? `<span style="background:${sev};color:#111;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:bold;">${escHtml(e.severity).toUpperCase()}</span>` : ""}
                    <button data-edit="${e.id}" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:11px;padding:0 2px;" title="Edit">✎</button>
                    <button data-evid="${e.id}" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:12px;padding:0 2px;" title="Delete">✕</button>
                </div>
            </div>
            <div style="color:#888;font-size:10px;margin-bottom:3px;">${escHtml(time)}</div>
            <div style="font-size:12px;font-weight:normal;color:#333;">${escHtml(e.description)}</div>
            ${e.mitre ? `<div style="color:#888;font-size:10px;margin-top:2px;">MITRE: ${escHtml(e.mitre)}</div>` : ""}
            ${e.tool  ? `<div style="color:#888;font-size:10px;">Tool: ${escHtml(e.tool)}</div>` : ""}
            ${e.cve   ? `<div style="color:#888;font-size:10px;">CVE: ${escHtml(e.cve)}</div>` : ""}
            ${e.srcIp ? `<div style="color:#888;font-size:10px;">Src: ${escHtml(e.srcIp)}</div>` : ""}
            ${e.dstIp ? `<div style="color:#888;font-size:10px;">Dst: ${escHtml(e.dstIp)}</div>` : ""}
        `;

        // Click item body — seek timeline to this event and show card
        item.addEventListener("click", ev => {
            if (ev.target.closest("button")) return; // ignore button clicks
            const ms = new Date(e.datetime).getTime();
            const slider = document.getElementById("timeline-slider");
            if (slider) {
                slider.value = ms;
                if (typeof updateTimelineLabel === "function") updateTimelineLabel(ms);
                if (typeof window.updateActiveEvents === "function") window.updateActiveEvents(ms, true);
            }
        });

        // Edit button — pre-fill the add-event form
        item.querySelector("[data-edit]").addEventListener("click", ev => {
            ev.stopPropagation();
            const evForm = document.getElementById("node-detail-event-form");
            if (!evForm) return;
            evForm.style.display = "block";
            evForm.dataset.editId = e.id; // mark as edit mode

            // Pre-fill fields
            const dt = new Date(e.datetime);
            const pad = n => String(n).padStart(2, "0");
            document.getElementById("ev-date").value = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
            document.getElementById("ev-time").value = `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
            document.getElementById("ev-description").value = e.description || "";
            document.getElementById("ev-actor").value    = e.actor || "blue";
            document.getElementById("ev-severity").value = e.severity || "none";
            document.getElementById("ev-srcip").value   = e.srcIp || "";
            document.getElementById("ev-dstip").value   = e.dstIp || "";
            document.getElementById("ev-mitre").value   = e.mitre || "";
            document.getElementById("ev-tool").value    = e.tool  || "";
            document.getElementById("ev-cve").value     = e.cve   || "";

            // Update actor colour
            const actorSel = document.getElementById("ev-actor");
            const c  = actorSel.value === "red" ? "#B45153" : "#5153B4";
            const bg = actorSel.value === "red" ? "#f8e8e8" : "#e8e8f8";
            actorSel.style.borderColor = "#ccc";
            actorSel.style.color = c;
            actorSel.style.background = bg;

            // Change save button label
            const saveBtn = document.getElementById("ev-save-btn");
            if (saveBtn) saveBtn.textContent = "Update Event";

            evForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });

        // Delete button
        item.querySelector("[data-evid]").addEventListener("click", ev => {
            ev.stopPropagation();
            if (!confirm("Delete this event?")) return;
            fetch("/delete-event", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: e.id })
            })
            .then(r => r.json())
            .then(res => {
                if (res.ok) {
                    window.allEvents = window.allEvents.filter(ev => ev.id !== e.id);
                    if (typeof initTimeline      === "function") initTimeline();
                    if (typeof updateActiveEvents === "function") updateActiveEvents(window.currentTime || 0);
                    renderNodeEvents(nodeId, container);
                }
            });
        });

        container.appendChild(item);
    });
}

// Escape HTML special chars to prevent XSS when injecting into innerHTML
function escHtml(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

window.selectNode = function(id) {
    const data  = window.currentGraphData || {};
    const node  = (data.nodes || []).find(n => n.id === id);
    if (!node) return;

    // If this node's panel is already open, close sidebar and deselect
    if (activeTab === "node-detail" && sidebarOpen &&
        document.getElementById("node-detail-title")?.textContent === node.system + " · " + node.hostname) {
        closeSidebar();
        if (typeof window.setHighlightedNodes === "function") {
            const current = Array.from(document.querySelectorAll(".node-list-item.selected")).map(el => el.dataset.id);
            const idx = current.indexOf(id);
            if (idx !== -1) current.splice(idx, 1);
            window.setHighlightedNodes(current);
        }
        return;
    }

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

    // ── Event form ────────────────────────────────────────────────────────────
    const addEvBtn = document.getElementById("node-detail-add-event-btn");
    const evForm   = document.getElementById("node-detail-event-form");
    const evList   = document.getElementById("node-detail-events-list");

    // Default datetime to now
    const now = new Date();
    const pad = n => String(n).padStart(2, "0");
    document.getElementById("ev-date").value =
        `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const evTimeEl = document.getElementById("ev-time");
    evTimeEl.value = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    // Auto-insert colons: 14 → 14: → 14:30 → 14:30: → 14:30:00
    evTimeEl.addEventListener("input", function() {
        let v = this.value.replace(/[^0-9]/g, "");
        if (v.length >= 5) v = v.slice(0,2) + ":" + v.slice(2,4) + ":" + v.slice(4,6);
        else if (v.length >= 3) v = v.slice(0,2) + ":" + v.slice(2,4);
        this.value = v;
    });

    // Actor select colour
    const actorSel = document.getElementById("ev-actor");
    function updateActorColour() {
        const c  = actorSel.value === "red" ? "#B45153" : "#5153B4";
        const bg = actorSel.value === "red" ? "#f8e8e8" : "#e8e8f8";
        actorSel.style.borderColor = "#ccc";   // same grey as other fields
        actorSel.style.color       = c;
        actorSel.style.background  = bg;
    }
    actorSel.onchange = updateActorColour;
    updateActorColour();

    // Re-wire buttons by cloning to remove old listeners
    const newAddEvBtn = addEvBtn.cloneNode(true);
    addEvBtn.parentNode.replaceChild(newAddEvBtn, addEvBtn);
    newAddEvBtn.addEventListener("click", () => {
        evForm.style.display = evForm.style.display === "none" ? "block" : "none";
    });

    const evCancel = document.getElementById("ev-cancel-btn");
    const newEvCancel = evCancel.cloneNode(true);
    evCancel.parentNode.replaceChild(newEvCancel, evCancel);
    newEvCancel.addEventListener("click", () => {
        evForm.style.display = "none";
        delete evForm.dataset.editId;
        newEvSave.textContent = "Save Event";
    });

    const evSave = document.getElementById("ev-save-btn");
    const newEvSave = evSave.cloneNode(true);
    evSave.parentNode.replaceChild(newEvSave, evSave);
    newEvSave.addEventListener("click", () => {
        const evDate      = document.getElementById("ev-date").value;
        const evTime      = document.getElementById("ev-time").value || "00:00:00";
        const datetime    = evDate ? `${evDate}T${evTime}` : "";
        const description = document.getElementById("ev-description").value.trim();
        const actor       = document.getElementById("ev-actor").value;
        const severity    = document.getElementById("ev-severity").value;
        const srcIp       = document.getElementById("ev-srcip").value.trim();
        const dstIp       = document.getElementById("ev-dstip").value.trim();
        const mitre       = document.getElementById("ev-mitre").value.trim();
        const tool        = document.getElementById("ev-tool").value.trim();
        const cve         = document.getElementById("ev-cve").value.trim();
        const errorEl     = document.getElementById("ev-error");

        if (!datetime)    { errorEl.textContent = "Date & Time is required."; return; }
        if (!description) { errorEl.textContent = "Description is required."; return; }
        errorEl.textContent = "";

        const editId = evForm.dataset.editId;
        const isEdit = !!editId;
        const url    = isEdit ? "/edit-event" : "/add-event";
        const body   = isEdit
            ? { id: parseInt(editId), datetime, description, actor, severity, srcIp, dstIp, mitre, tool, cve }
            : { nodeId: node.id, datetime, description, actor, severity, srcIp, dstIp, mitre, tool, cve };

        fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        })
        .then(r => r.json())
        .then(res => {
            if (res.error) { errorEl.textContent = res.error; return; }
            if (isEdit) {
                const idx = (window.allEvents || []).findIndex(ev => ev.id === res.event.id);
                if (idx !== -1) window.allEvents[idx] = res.event;
            } else {
                window.allEvents = window.allEvents || [];
                window.allEvents.push(res.event);
            }
            if (typeof initTimeline      === "function") initTimeline();
            if (typeof updateActiveEvents === "function") updateActiveEvents(window.currentTime || new Date(res.event.datetime).getTime());
            renderNodeEvents(node.id, evList);
            ["ev-description","ev-srcip","ev-dstip","ev-mitre","ev-tool","ev-cve"]
                .forEach(fid => document.getElementById(fid).value = "");
            delete evForm.dataset.editId;
            newEvSave.textContent = "Save Event";
            evForm.style.display = "none";
        })
        .catch(() => { document.getElementById("ev-error").textContent = "Server error."; });
    });

    // Show existing events for this node
    renderNodeEvents(node.id, evList);

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

function positionTimeline() {
    const bar  = document.getElementById("timeline-bar");
    if (!bar || bar.style.display === "none") return;
    const sbW  = sidebarOpen ? (sidebar.clientWidth || 0) : 0;
    // Left: always at least 80px from screen edge to clear sidebar toggle button
    const leftPx = Math.max(80, sbW + 12);
    bar.style.left  = leftPx + "px";
    bar.style.right = "78px";
    document.getElementById("canvas").style.paddingTop = "60px";
}

window.positionTimeline = positionTimeline;

function openSidebar() {
    sidebarOpen = true;
    sidebar.classList.add("open");
    chevron.style.transform = "scaleX(1)";
    positionTimeline();
}

function closeSidebar() {
    sidebarOpen = false;
    sidebar.classList.remove("open");
    sidebar.style.width = ""; // clear any inline width from resizing
    chevron.style.transform = "scaleX(-1)";
    positionTimeline();
}

toggleBtn.addEventListener("click", () => {
    sidebarOpen ? closeSidebar() : openSidebar();
});

// ============ Sidebar resize ============
(function() {
    const handle = document.getElementById("sidebar-resize-handle");
    if (!handle) return;

    let startX, startWidth;

    handle.addEventListener("mousedown", e => {
        if (!sidebarOpen) return;
        e.preventDefault();
        startX     = e.clientX;
        startWidth = sidebar.offsetWidth;
        handle.classList.add("dragging");

        // Disable transition during drag for instant feedback
        sidebar.style.transition = "none";

        function onMove(e) {
            const dx       = e.clientX - startX;
            const newWidth = Math.max(200, Math.min(window.innerWidth * 0.8, startWidth + dx));
            sidebar.style.width = newWidth + "px";
        }

        function onUp() {
            handle.classList.remove("dragging");
            sidebar.style.transition = "";
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup",   onUp);
        }

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup",   onUp);
    });
})();

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
