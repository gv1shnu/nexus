let currentQuery = sessionStorage.getItem("currentQuery") || "";
let currentPage = parseInt(sessionStorage.getItem("currentPage")) || 1;
let currentSort = sessionStorage.getItem("currentSort") || "date";
let currentTab = sessionStorage.getItem("currentTab") || "all";
let lastData = JSON.parse(sessionStorage.getItem("lastData")) || null;

const input = document.getElementById("searchInput");
const statusDiv = document.getElementById("status");
const loader = document.getElementById("loader");
const tabsContainer = document.getElementById("tabs");

// --- Lazy Load Date Resolution ---
const dateObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const card = entry.target;
            const dateSpan = card.querySelector('.card-date[data-has-date="false"]');

            if (dateSpan) {
                const url = dateSpan.dataset.url;
                dateSpan.innerHTML = "<i>resolving...</i>";

                fetch(`http://localhost:8000/api/resolve-date?url=${encodeURIComponent(url)}`)
                    .then(r => r.json())
                    .then(data => {
                        if (data.publishedDate) {
                            dateSpan.innerHTML = `${timeAgo(data.publishedDate)}`;
                            dateSpan.dataset.hasDate = "true";
                        } else {
                            dateSpan.innerHTML = "Unknown Date";
                        }
                    })
                    .catch(() => {
                        dateSpan.innerHTML = "Unknown Date";
                    });
            }
            observer.unobserve(card);
        }
    });
}, { rootMargin: '50px' });

function observeCard(cardElement) {
    dateObserver.observe(cardElement);
}

// Only parse URL on fresh hard navigation if no storage
const urlParams = new URLSearchParams(window.location.search);
if (!currentQuery && urlParams.has("q")) {
    const loadedQuery = urlParams.get("q");
    input.value = loadedQuery;
    currentQuery = loadedQuery;
    currentPage = parseInt(urlParams.get("page")) || 1;
    currentSort = urlParams.get("sort") || "date";
    currentTab = urlParams.get("tab") || "all";

    // Defer search slightly to ensure DOM is ready
    setTimeout(() => search(currentPage, false, loadedQuery), 100);
    document.getElementById("homeBtn").style.display = "inline-block";
} else if (lastData && currentQuery) {
    // Restore UI from session storage
    input.value = currentQuery;
    document.getElementById("sortBtn").textContent = currentSort === "date" ? "Date" : "Relevance";
    document.getElementById("sortBtn").style.display = "inline-block";
    document.getElementById("homeBtn").style.display = "inline-block";
    tabsContainer.classList.remove("hidden");
    updateTabCounts(lastData);
    renderTab(lastData, currentTab);
}

// Handle browser back/forward buttons
window.addEventListener("popstate", (e) => {
    if (e.state) {
        const backQuery = e.state.q || "";
        input.value = backQuery;
        currentQuery = backQuery;
        currentPage = e.state.page || 1;
        currentSort = e.state.sort || "date";
        currentTab = e.state.tab || "all";
        if (currentQuery) {
            search(currentPage, false, backQuery);
            document.getElementById("homeBtn").style.display = "inline-block";
        } else {
            // Reset UI if no query
            document.getElementById("results").innerHTML = "";
            document.getElementById("pagination").innerHTML = "";
            tabsContainer.classList.add("hidden");
            document.getElementById("sortBtn").style.display = "none";
            document.getElementById("homeBtn").style.display = "none";
        }
    } else if (currentQuery && lastData) {
        input.value = currentQuery;
        document.getElementById("homeBtn").style.display = "inline-block";
        updateTabCounts(lastData);
        renderTab(lastData, currentTab);
    } else {
        input.value = currentQuery;
        document.getElementById("homeBtn").style.display = "inline-block";
    }
});


input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search();
});

// Update URL immediately when typing
input.addEventListener("input", (e) => {
    const query = input.value.trim();
    if (query !== currentQuery) {
        currentQuery = query;
        currentPage = 1; // Reset to page 1 when query changes
        updateURL(); // Update URL immediately
    }
});

// Tab switching
tabsContainer.addEventListener("click", (e) => {
    if (!e.target.classList.contains("tab")) return;
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    e.target.classList.add("active");
    currentTab = e.target.dataset.tab;
    if (lastData) renderTab(lastData, currentTab);
    updateURL();
});

function toggleSort() {
    currentSort = currentSort === "date" ? "relevance" : "date";
    document.getElementById("sortBtn").textContent = currentSort === "date" ? "Date" : "Relevance";
    if (lastData) {
        currentPage = 1; // reset pagination on sort change
        renderTab(lastData, currentTab);
        updateURL();
    }
}

function goHome() {
    // Clear all state
    currentQuery = "";
    currentPage = 1;
    currentSort = "date";
    currentTab = "all";
    lastData = null;
    
    // Clear input
    input.value = "";
    
    // Clear UI
    document.getElementById("results").innerHTML = "";
    document.getElementById("pagination").innerHTML = "";
    document.getElementById("status").innerHTML = "";
    tabsContainer.classList.add("hidden");
    document.getElementById("sortBtn").style.display = "none";
    document.getElementById("homeBtn").style.display = "none";
    
    // Clear storage
    sessionStorage.clear();
    localStorage.clear();
    
    // Reset URL to clean state
    window.history.pushState({}, "", window.location.pathname);
    
    // Focus back to input
    input.focus();
}

function showLoader() {
    loader.classList.remove("hidden");
    statusDiv.innerHTML = "";
}

function hideLoader() {
    loader.classList.add("hidden");
}

function favicon(url) {
    try {
        const domain = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?sz=32&domain=${domain}`;
    } catch {
        return "";
    }
}

function timeAgo(dateStr) {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    const intervals = [
        { label: "y", seconds: 31536000 },
        { label: "mo", seconds: 2592000 },
        { label: "d", seconds: 86400 },
        { label: "h", seconds: 3600 },
        { label: "m", seconds: 60 }
    ];
    for (const i of intervals) {
        const count = Math.floor(seconds / i.seconds);
        if (count >= 1) return `${count}${i.label} ago`;
    }
    return "just now";
}

function updateURL() {
    const params = new URLSearchParams();
    if (currentQuery) params.set("q", currentQuery);
    if (currentPage > 1) params.set("page", currentPage);
    params.set("sort", currentSort);
    if (currentTab !== "all") params.set("tab", currentTab);

    // Save to sessionStorage
    sessionStorage.setItem("currentQuery", currentQuery);
    sessionStorage.setItem("currentPage", currentPage);
    sessionStorage.setItem("currentSort", currentSort);
    sessionStorage.setItem("currentTab", currentTab);
    if (lastData) sessionStorage.setItem("lastData", JSON.stringify(lastData));

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState({ q: currentQuery, page: currentPage, sort: currentSort, tab: currentTab }, "", newUrl);
}

async function search(page = 1, shouldUpdateUrl = true, forceQuery = null) {
    const q = forceQuery || input.value.trim();
    if (!q) return;

    if (q !== currentQuery) {
        currentQuery = q;
        currentPage = 1;
        tabsContainer.classList.add("hidden");
        document.getElementById("results").innerHTML = "";
        document.getElementById("pagination").innerHTML = "";
        lastData = null;
        document.getElementById("sortBtn").style.display = "none"; // Hide sort button on new query
    } else {
        currentPage = page;
    }

    // Ensure the input box reflects the actual query being searched
    if (input.value.trim() !== currentQuery) {
        input.value = currentQuery;
    }

    showLoader();
    document.getElementById("results").innerHTML = "";
    document.getElementById("pagination").innerHTML = "";
    tabsContainer.classList.add("hidden");
    document.getElementById("sortBtn").style.display = "inline-block";
    document.getElementById("homeBtn").style.display = "inline-block";

    const cacheKey = `nexus_${currentQuery}_${currentPage}_${currentSort}`;
    const cached = localStorage.getItem(cacheKey);

    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (Date.now() < parsed.expiry) {
                lastData = parsed.data;
                hideLoader();
                tabsContainer.classList.remove("hidden");
                document.getElementById("sortBtn").style.display = "inline-block"; // Show sort button if cached data exists
                document.getElementById("homeBtn").style.display = "inline-block";
                updateTabCounts(lastData);
                renderTab(lastData, currentTab);
                if (shouldUpdateUrl) updateURL();
                return;
            } else {
                localStorage.removeItem(cacheKey);
            }
        } catch { }
    }

    try {
        // Initialize clean state for streaming
        lastData = {
            web: { cards: [], total: 0 },
            images: [],
            videos: [],
            news: [],
            documents: [],
            books: [],
            code: [],
            academic: [],
            community: []
        };

        tabsContainer.classList.remove("hidden");
        updateTabCounts(lastData);
        renderTab(lastData, currentTab);

        try {
            const url = `http://localhost:8000/api/search/stream?q=${encodeURIComponent(q)}&page=${currentPage}&sort=${currentSort}`;
            const source = new EventSource(url);

            source.onmessage = (event) => {
                const parsed = JSON.parse(event.data);

                if (parsed.type === 'engine_result') {
                    const engineData = parsed.data;

                    // Merge new data into current state
                    for (const [type, items] of Object.entries(engineData)) {
                        if (Array.isArray(items) && items.length > 0) {
                            if (type === 'web') {
                                lastData.web.cards.push(...items);
                                lastData.web.total += items.length;
                            } else if (lastData[type]) {
                                lastData[type].push(...items);
                            }
                        }
                    }

                    // Immediately update UI
                    updateTabCounts(lastData);
                    renderTab(lastData, currentTab);

                    // Show sort button and hide loader once we get our first piece of data
                    document.getElementById("sortBtn").style.display = "inline-block";
                    if (!loader.classList.contains("hidden")) {
                        hideLoader();
                    }
                }

                if (parsed.type === 'engine_error') {
                    console.warn(`${parsed.engine} error:`, parsed.error);
                }

                if (parsed.type === 'done') {
                    source.close();

                    // Cache the final completed dataset
                    try {
                        localStorage.setItem(cacheKey, JSON.stringify({
                            expiry: Date.now() + 3600000,
                            data: lastData
                        }));
                    } catch { }

                    // Hide loader if it never got hidden (e.g. no results at all)
                    hideLoader();
                    if (shouldUpdateUrl) updateURL();
                }
            };

            source.onerror = (err) => {
                console.error("EventSource failed:", err);
                source.close();
                hideLoader();

                // Only show major error UI if we got absolutely nothing
                if (!lastData || lastData.web.cards.length === 0) {
                    statusDiv.innerHTML = `<div class="error"></div>`;
                    statusDiv.querySelector(".error").textContent = `Connection to search server failed.`;
                }
            };

        } catch (err) {
            hideLoader();
            statusDiv.innerHTML = `<div class="error"></div>`;
            statusDiv.querySelector(".error").textContent = `Error: ${err.message}`;
        }
    } catch (err) {
        hideLoader();
        statusDiv.innerHTML = `<div class="error"></div>`;
        statusDiv.querySelector(".error").textContent = `Outer Error: ${err.message}`;
    }
}

function updateTabCounts(data) {
    let totalAll = 0;

    document.querySelectorAll(".tab").forEach(tab => {
        const type = tab.dataset.tab;
        if (type === "all") return; // Handled after the loop

        let count = 0;
        if (type === "web") {
            count = data.web?.total || data.web?.cards?.length || 0;
        } else {
            count = (data[type] || []).length;
        }
        totalAll += count;

        const label = tab.textContent.replace(/ \(\d+\)/, "");
        tab.textContent = count > 0 ? `${label} (${count})` : label;

        // Hide empty tabs dynamically
        tab.style.display = count === 0 ? "none" : "";
    });

    // Update ALL tab
    const allTab = document.querySelector('.tab[data-tab="all"]');
    if (allTab) {
        const label = allTab.textContent.replace(/ \(\d+\)/, "");
        allTab.textContent = totalAll > 0 ? `${label} (${totalAll})` : label;
        allTab.style.display = totalAll === 0 ? "none" : "";
    }
}

function renderTab(data, tab) {
    const container = document.getElementById("results");
    const pagination = document.getElementById("pagination");
    container.innerHTML = "";
    pagination.innerHTML = "";

    // Gather items for paginated tabs
    let itemsToRender = [];
    if (tab === "all") {
        ['web', 'news', 'documents', 'books', 'code', 'academic', 'community', 'osint', 'people'].forEach(t => {
            if (t === "web" && data.web?.cards) itemsToRender.push(...data.web.cards);
            else if (data[t]) itemsToRender.push(...data[t]);
        });
    } else if (tab === "web") {
        itemsToRender = data.web?.cards || [];
    }

    if (tab === "web" || tab === "all") {
        if (itemsToRender.length === 0) {
            container.innerHTML = `<div class="status-msg">No results found.</div>`;
            return;
        }

        // Client-side Sort
        const sortedCards = [...itemsToRender].sort((a, b) => {
            if (currentSort === "date") {
                const da = a.publishedDate ? new Date(a.publishedDate).getTime() : 0;
                const db = b.publishedDate ? new Date(b.publishedDate).getTime() : 0;
                return db - da; // Newest first
            }
            return 0; // Relevance is default arrival order
        });

        // Client-side Pagination (10 per page for web, 20 for all)
        const PER_PAGE = tab === "all" ? 20 : 10;
        const total = sortedCards.length;
        const totalPages = Math.ceil(total / PER_PAGE);
        const actualPage = Math.min(currentPage, totalPages || 1);
        const start = (actualPage - 1) * PER_PAGE;
        const pageCards = sortedCards.slice(start, start + PER_PAGE);

        if (tab === "web") {
            pageCards.forEach(item => {
                const card = document.createElement("div");
                card.className = "card";
                const actualDate = item.publishedDate ? timeAgo(item.publishedDate) : "Unknown Date";
                const dateStr = `<span class="card-date" data-url="${item.url}" data-has-date="${!!item.publishedDate}">${actualDate}</span>`;
                const icon = favicon(item.url);
                card.innerHTML = `
                <img class="card-favicon" src="${icon}" alt="" onerror="this.style.display='none'" />
                <div class="card-content">
                    <a href="${item.url}" target="_blank" class="card-title">${item.title || ""}</a>
                    <div class="card-url">${item.url}</div>
                    <div class="card-body">${item.content || item.body || ""}</div>
                    <div class="card-meta">
                        <span class="card-engine">${item.engine || "web"}</span>
                        ${dateStr}
                    </div>
                </div>
            `;
                container.appendChild(card);
                if (!item.publishedDate) observeCard(card);
            });
        } else if (tab === "all") {
            renderGenericResults(pageCards, container);
        }

        if (totalPages > 1) {
            let html = "";
            if (actualPage > 1) html += `<button onclick="search(${actualPage - 1})">Prev</button>`;
            html += `<span>Page ${actualPage} of ${totalPages}</span>`;
            if (actualPage < totalPages) html += `<button onclick="search(${actualPage + 1})">Next</button>`;
            pagination.innerHTML = html;
        }

    } else if (tab === "images") {
        renderImageResults(data.images || [], container);
    } else if (tab === "videos") {
        renderVideoResults(data.videos || [], container);
    } else if (tab === "news") {
        renderNewsResults(data.news || [], container);
    } else {
        renderGenericResults(data[tab] || [], container);
    }
}

// --- Renderers ---

function renderImageResults(images, container) {
    if (!images.length) {
        container.innerHTML = '<div class="loading">No image results found.</div>';
        return;
    }

    const grid = document.createElement("div");
    grid.className = "image-grid";

    images.forEach(img => {
        const div = document.createElement("div");
        div.className = "image-card";
        div.innerHTML = `
            <a href="${img.url || img.image}" target="_blank">
                <img src="${img.thumbnail || img.image}" alt="${img.title || ""}" loading="lazy" />
            </a>
            <div class="image-title">${img.title || ""}</div>
        `;
        grid.appendChild(div);
    });

    container.appendChild(grid);
}

function renderVideoResults(videos, container) {
    if (!videos.length) {
        container.innerHTML = '<div class="loading">No video results found.</div>';
        return;
    }

    videos.forEach(vid => {
        const div = document.createElement("div");
        div.className = "card";
        const actualDate = vid.publishedDate ? timeAgo(vid.publishedDate) : "Unknown Date";
        const dateStr = `<span class="card-date" data-url="${vid.url}" data-has-date="${!!vid.publishedDate}">${actualDate}</span>`;
        const thumb = vid.thumbnail ? `<img class="video-thumb" src="${vid.thumbnail}" alt="" loading="lazy" />` : "";
        const icon = favicon(vid.url);

        div.innerHTML = `
            ${thumb}
            <div class="card-content">
                <a href="${vid.url}" target="_blank" class="card-title">${vid.title || ""}</a>
                <div class="card-url">${vid.url}</div>
                <div class="card-body">${vid.description || ""}</div>
                <div class="card-meta">
                    <img class="card-favicon" src="${icon}" alt="" onerror="this.style.display='none'" style="width: 12px; height: 12px; border-radius: 2px;" />
                    <span class="card-engine">${vid.publisher || vid.engine || "video"}</span>
                    ${vid.duration ? `<span>${vid.duration}</span>` : ""}
                    ${dateStr}
                </div>
            </div>
        `;
        container.appendChild(div);
        if (!vid.publishedDate) observeCard(div);
    });
}

function renderNewsResults(news, container) {
    if (!news.length) {
        container.innerHTML = '<div class="loading">No news results found.</div>';
        return;
    }

    news.forEach(item => {
        const div = document.createElement("div");
        div.className = "card";
        const actualDate = item.publishedDate ? timeAgo(item.publishedDate) : "Unknown Date";
        const dateStr = `<span class="card-date" data-url="${item.url}" data-has-date="${!!item.publishedDate}">${actualDate}</span>`;
        const icon = favicon(item.url);

        div.innerHTML = `
            <img class="card-favicon" src="${icon}" alt="" onerror="this.style.display='none'" />
            <div class="card-content">
                <a href="${item.url}" target="_blank" class="card-title">${item.title || ""}</a>
                <div class="card-url">${item.url}</div>
                <div class="card-body">${item.content || item.body || ""}</div>
                <div class="card-meta">
                    <span class="card-engine">${item.source || item.engine || "news"}</span>
                    ${dateStr}
                </div>
            </div>
        `;
        container.appendChild(div);
        if (!item.publishedDate) observeCard(div);
    });
}

function renderGenericResults(items, container) {
    if (!items.length) {
        container.innerHTML = '<div class="loading">No results found.</div>';
        return;
    }

    items.forEach(item => {
        const div = document.createElement("div");
        div.className = "card";
        const actualDate = item.publishedDate ? timeAgo(item.publishedDate) : "Unknown Date";
        const dateStr = `<span class="card-date" data-url="${item.url}" data-has-date="${!!item.publishedDate}">${actualDate}</span>`;
        const icon = favicon(item.url);

        // Extra metadata
        const extras = [];
        if (item.subreddit) extras.push(item.subreddit);
        if (item.upvotes) extras.push(`Upvotes: ${item.upvotes}`);
        if (item.commentCount) extras.push(`Comments: ${item.commentCount}`);
        if (item.answerCount) extras.push(`Answers: ${item.answerCount}`);
        if (item.cweId) extras.push(`CWE-${item.cweId}`);
        if (item.severity && item.severity !== "Unknown") extras.push(`${item.severity}`);
        if (item.authors) extras.push(item.authors.slice(0, 3).join(", "));
        if (item.filetype) extras.push(`${item.filetype.toUpperCase()}`);
        if (item.pdfUrl) extras.push(`<a href="${item.pdfUrl}" target="_blank" class="pdf-link">PDF</a>`);
        if (item.tags) extras.push(item.tags.slice(0, 4).map(t => `<span class="tag">${t}</span>`).join(" "));

        div.innerHTML = `
            <img class="card-favicon" src="${icon}" alt="" onerror="this.style.display='none'" />
            <div class="card-content">
                <a href="${item.url}" target="_blank" class="card-title">${item.title || ""}</a>
                <div class="card-url">${item.url}</div>
                <div class="card-body">${item.content || item.body || ""}</div>
                <div class="card-meta">
                    <span class="card-engine">${item.engine || "source"}</span>
                    ${extras.join(" · ")}
                    ${dateStr}
                </div>
            </div>
        `;
        container.appendChild(div);
        if (!item.publishedDate) observeCard(div);
    });
}