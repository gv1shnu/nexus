const API = "http://localhost:8000/api/stats";
const content = document.getElementById("content");

const pct = n => `${(n * 100).toFixed(1)}%`;
const num = n => (n ?? 0).toLocaleString();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function card(value, label, note = "", hero = false) {
    return `
    <div class="card ${hero ? "hero" : ""}">
      <div class="value">${value}</div>
      <div class="label">${label}</div>
      ${note ? `<div class="note">${note}</div>` : ""}
    </div>`;
}

function render(s) {
    if (!s || !s.searches) {
        content.innerHTML = `<div class="empty">No searches recorded yet.<br>Run a few searches, then refresh this page.</div>`;
        return;
    }

    const ttfr = s.timeToFirstResultMs || { p50: 0, p95: 0 };
    const lat = s.latencyMs || { p50: 0, p95: 0, max: 0 };

    // --- Headline cards ---
    const cards = [
        card(`${ttfr.p95}<small> ms</small>`, "Time-to-first-result (p95)", "perceived latency over SSE", true),
        card(num(s.searches), "Searches served", `${num(s.uniqueQueries)} unique queries`),
        card(num(s.avgResultsPerSearch), "Avg results / query", `peak ${num(s.maxResultsInOneSearch)}`),
        card(num(s.totalResultsAggregated), "Results aggregated", `across ${Object.keys(s.engines || {}).length} sources`),
        card(pct(s.cacheHitRate), "Cache hit rate", "on repeat queries"),
        card(pct(s.noiseReductionRate), "Noise removed", "filter + de-dup"),
    ].join("");

    // --- Per-engine latency chart ---
    const engines = Object.entries(s.engines || {}).sort((a, b) => b[1].avgLatencyMs - a[1].avgLatencyMs);
    const maxLat = Math.max(1, ...engines.map(([, e]) => e.avgLatencyMs));
    const engineRows = engines.map(([name, e]) => {
        const w = (e.avgLatencyMs / maxLat) * 100;
        return `
      <div class="bar-row">
        <div class="name">${esc(name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>
        <div class="meta">${e.avgLatencyMs} ms · ${e.avgResults}</div>
      </div>`;
    }).join("");

    // --- Latency comparison: perceived vs full completion ---
    const maxCmp = Math.max(1, ttfr.p95, lat.p95);
    const cmp = [
        ["First result (p95)", ttfr.p95],
        ["Full completion (p95)", lat.p95],
    ].map(([n, v]) => `
      <div class="bar-row">
        <div class="name">${n}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(v / maxCmp) * 100}%"></div></div>
        <div class="meta">${num(v)} ms</div>
      </div>`).join("");

    // --- Pipeline funnel ---
    const aggregated = s.totalResultsAggregated || 0;
    const served = s.totalResultsServed || 0;
    const filtered = s.offTopicFilteredOut || 0;
    const deduped = s.duplicatesRemoved || 0;
    const maxF = Math.max(1, aggregated);
    const fRow = (name, amt, val) => `
      <div class="funnel-row">
        <div class="name">${name}</div>
        <div class="funnel-bar" style="width:${(val / maxF) * 100}%"></div>
        <div class="amt">${amt}</div>
      </div>`;
    const funnel =
        fRow("Aggregated", num(aggregated), aggregated) +
        fRow("Off-topic dropped", `−${num(filtered)}`, filtered) +
        fRow("Duplicates dropped", `−${num(deduped)}`, deduped) +
        fRow("Served", num(served), served);

    content.innerHTML = `
    <div class="section-title">Overview</div>
    <div class="cards">${cards}</div>

    <div class="section-title">Latency — streaming wins</div>
    <div class="bars">${cmp}</div>

    <div class="section-title">Per-engine latency &nbsp;·&nbsp; ms · avg results</div>
    <div class="bars">${engineRows}</div>

    <div class="section-title">Ranking pipeline</div>
    <div class="funnel">${funnel}</div>
  `;

    // Animate bars in after paint.
    requestAnimationFrame(() => {
        document.querySelectorAll(".bar-fill, .funnel-bar").forEach(el => {
            const w = el.style.width;
            el.style.width = "0";
            requestAnimationFrame(() => { el.style.width = w; });
        });
    });
}

fetch(API)
    .then(r => {
        if (!r.ok) throw new Error(`Server responded ${r.status}`);
        return r.json();
    })
    .then(render)
    .catch(err => {
        content.innerHTML = `<div class="err">Could not load stats.<br>${esc(err.message)}<br><br>Is the backend running on :8000?</div>`;
    });
