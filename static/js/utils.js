/**
 * CMaps — Shared Utilities
 * API wrapper with IndexedDB caching, formatting, and helper functions.
 */
const CMapsUtils = (() => {

    // ═══ IndexedDB Cache ═══
    const IDB_NAME = 'cmaps-cache';
    const IDB_VERSION = 1;
    const IDB_STORE = 'api-cache';
    const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minute TTL
    let idb = null;

    /**
     * Open the IndexedDB for caching.
     */
    function openIDB() {
        return new Promise((resolve, reject) => {
            if (idb) return resolve(idb);
            const req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE, { keyPath: 'url' });
                }
            };
            req.onsuccess = () => { idb = req.result; resolve(idb); };
            req.onerror = () => resolve(null);
        });
    }

    async function idbGet(url) {
        try {
            const db = await openIDB();
            if (!db) return null;
            return new Promise((resolve) => {
                const tx = db.transaction(IDB_STORE, 'readonly');
                const store = tx.objectStore(IDB_STORE);
                const req = store.get(url);
                req.onsuccess = () => {
                    const entry = req.result;
                    if (entry && (Date.now() - entry.timestamp) < CACHE_TTL_MS) {
                        resolve(entry.data);
                    } else {
                        resolve(null);
                    }
                };
                req.onerror = () => resolve(null);
            });
        } catch { return null; }
    }

    async function idbPut(url, data) {
        try {
            const db = await openIDB();
            if (!db) return;
            const tx = db.transaction(IDB_STORE, 'readwrite');
            const store = tx.objectStore(IDB_STORE);
            store.put({ url, data, timestamp: Date.now() });
        } catch { /* ignore */ }
    }

    async function idbClear() {
        try {
            const db = await openIDB();
            if (!db) return;
            const tx = db.transaction(IDB_STORE, 'readwrite');
            const store = tx.objectStore(IDB_STORE);
            store.clear();
        } catch { /* ignore */ }
    }

    // ═══ Formatting ═══

    /**
     * Format a number with commas: 1234567 → "1,234,567"
     */
    function formatNumber(n) {
        if (n == null || isNaN(n)) return '—';
        return Math.round(n).toLocaleString('en-US');
    }

    /**
     * Format area: 1234567.89 → "1,234,568 km²"
     */
    function formatArea(km2) {
        if (km2 == null || isNaN(km2) || km2 === 0) return '—';
        return formatNumber(km2) + ' km²';
    }

    /**
     * Format population with suffix: 1234567 → "1.23M"
     */
    function formatPopShort(n) {
        if (n == null || isNaN(n) || n === 0) return '—';
        if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return n.toString();
    }

    /**
     * Format GDP in millions to readable: 1234567 → "$1.23T"
     */
    function formatGDP(gdpMd) {
        if (gdpMd == null || isNaN(gdpMd) || gdpMd === 0) return '—';
        const usd = gdpMd * 1e6; // Convert from millions
        return '$' + formatPopShort(usd);
    }

    // ═══ Utility Functions ═══

    function debounce(fn, delay = 300) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function throttle(fn, limit = 100) {
        let waiting = false;
        return function (...args) {
            if (!waiting) {
                fn.apply(this, args);
                waiting = true;
                setTimeout(() => { waiting = false; }, limit);
            }
        };
    }

    function lightenColor(hex, amount = 0.3) {
        hex = hex.replace('#', '');
        const r = Math.min(255, parseInt(hex.substr(0, 2), 16) + Math.round(255 * amount));
        const g = Math.min(255, parseInt(hex.substr(2, 2), 16) + Math.round(255 * amount));
        const b = Math.min(255, parseInt(hex.substr(4, 2), 16) + Math.round(255 * amount));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    function darkenColor(hex, amount = 0.2) {
        hex = hex.replace('#', '');
        const r = Math.max(0, parseInt(hex.substr(0, 2), 16) - Math.round(255 * amount));
        const g = Math.max(0, parseInt(hex.substr(2, 2), 16) - Math.round(255 * amount));
        const b = Math.max(0, parseInt(hex.substr(4, 2), 16) - Math.round(255 * amount));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    /**
     * API wrapper with IndexedDB caching for GET requests.
     */
    async function api(url, options = {}) {
        try {
            const defaults = {
                headers: { 'Content-Type': 'application/json' },
            };
            const config = { ...defaults, ...options };
            const isGet = !options.method || options.method === 'GET';

            if (options.body && typeof options.body === 'object') {
                config.body = JSON.stringify(options.body);
            }

            // Invalidate cache on mutations
            if (!isGet) {
                await idbClear();
            } else if (!options.bypassCache) {
                // Try IndexedDB cache first for GET requests
                const cached = await idbGet(url);
                if (cached !== null) {
                    // Stale-while-revalidate: background refresh
                    fetch(url, config).then(async res => {
                        if (res.ok) {
                            const ct = res.headers.get('content-type');
                            if (ct && (ct.includes('application/json') || ct.includes('application/geo+json'))) {
                                const freshData = await res.json();
                                await idbPut(url, freshData);
                            }
                        }
                    }).catch(() => {});
                    return cached;
                }
            }

            // Network request
            const response = await fetch(url, config);
            if (!response.ok) {
                const err = await response.json().catch(() => ({ detail: response.statusText }));
                throw new Error(err.detail || `HTTP ${response.status}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && (contentType.includes('application/json') || contentType.includes('application/geo+json'))) {
                const data = await response.json();
                // Cache successful GET responses in IndexedDB
                if (isGet) await idbPut(url, data);
                return data;
            }
            return response;
        } catch (error) {
            console.error(`API Error [${url}]:`, error);
            throw error;
        }
    }

    /**
     * Show a toast notification.
     */
    function toast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toast-container');
        const icons = {
            success: '✓',
            error: '✗',
            info: 'ℹ',
            warning: '⚠',
        };
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${message}</span>`;
        container.appendChild(el);

        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateX(100px)';
            el.style.transition = 'all 0.3s ease';
            setTimeout(() => el.remove(), 300);
        }, duration);
    }

    /**
     * Set status message in bottom bar.
     */
    function setStatus(msg) {
        const el = document.getElementById('status-message');
        if (el) el.textContent = msg;
    }

    /**
     * Generate a random pastel color.
     */
    function randomColor() {
        const h = Math.floor(Math.random() * 360);
        const s = 30 + Math.floor(Math.random() * 20);
        const l = 45 + Math.floor(Math.random() * 15);
        return hslToHex(h, s, l);
    }

    function hslToHex(h, s, l) {
        s /= 100;
        l /= 100;
        const a = s * Math.min(l, 1 - l);
        const f = (n) => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    return {
        formatNumber,
        formatArea,
        formatPopShort,
        formatGDP,
        debounce,
        throttle,
        lightenColor,
        darkenColor,
        api,
        toast,
        setStatus,
        randomColor,
    };
})();