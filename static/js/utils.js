/**
 * CMaps — Shared Utilities
 */
const CMapsUtils = (() => {

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
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return n.toString();
    }

    /**
     * Debounce a function.
     */
    function debounce(fn, delay = 300) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    /**
     * Throttle a function.
     */
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

    /**
     * Lighten a hex color.
     */
    function lightenColor(hex, amount = 0.3) {
        hex = hex.replace('#', '');
        const r = Math.min(255, parseInt(hex.substr(0, 2), 16) + Math.round(255 * amount));
        const g = Math.min(255, parseInt(hex.substr(2, 2), 16) + Math.round(255 * amount));
        const b = Math.min(255, parseInt(hex.substr(4, 2), 16) + Math.round(255 * amount));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    /**
     * Darken a hex color.
     */
    function darkenColor(hex, amount = 0.2) {
        hex = hex.replace('#', '');
        const r = Math.max(0, parseInt(hex.substr(0, 2), 16) - Math.round(255 * amount));
        const g = Math.max(0, parseInt(hex.substr(2, 2), 16) - Math.round(255 * amount));
        const b = Math.max(0, parseInt(hex.substr(4, 2), 16) - Math.round(255 * amount));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    /**
     * API wrapper with error handling.
     */
    async function api(url, options = {}) {
        try {
            const defaults = {
                headers: { 'Content-Type': 'application/json' },
            };
            const config = { ...defaults, ...options };
            if (options.body && typeof options.body === 'object') {
                config.body = JSON.stringify(options.body);
            }
            const response = await fetch(url, config);
            if (!response.ok) {
                const err = await response.json().catch(() => ({ detail: response.statusText }));
                throw new Error(err.detail || `HTTP ${response.status}`);
            }
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json') || contentType.includes('application/geo+json')) {
                return await response.json();
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
