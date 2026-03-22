/**
 * CMaps — Leaderboard Module
 * Floating overlay panel with global stat rankings.
 */
const CMapsLeaderboard = (() => {
    let panelEl = null;
    let isVisible = false;

    function init() {
        panelEl = document.getElementById('leaderboard-panel');
        if (!panelEl) return;

        const toggleBtn = document.getElementById('btn-leaderboard');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', toggle);
        }

        const closeBtn = panelEl.querySelector('.leaderboard-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', hide);
        }
    }

    async function toggle() {
        if (isVisible) {
            hide();
        } else {
            await show();
        }
    }

    async function show() {
        if (!panelEl) return;
        isVisible = true;
        panelEl.classList.remove('hidden');
        panelEl.classList.add('visible');
        await loadData();
    }

    function hide() {
        if (!panelEl) return;
        isVisible = false;
        panelEl.classList.add('hidden');
        panelEl.classList.remove('visible');
    }

    async function loadData() {
        const content = panelEl.querySelector('.leaderboard-content');
        if (!content) return;

        content.innerHTML = '<div class="empty-state">Loading rankings...</div>';

        try {
            const data = await CMapsUtils.api('/api/stats/leaderboard');
            renderLeaderboard(content, data);
        } catch (err) {
            content.innerHTML = '<div class="empty-state">Failed to load rankings</div>';
        }
    }

    function renderLeaderboard(container, data) {
        const medals = ['🥇', '🥈', '🥉'];

        const sections = [
            { key: 'by_population', title: 'Most Populated', icon: '👥', format: (v) => CMapsUtils.formatPopShort(v) },
            { key: 'by_area', title: 'Largest by Area', icon: '🗺️', format: (v) => CMapsUtils.formatArea(v) },
            { key: 'by_gdp', title: 'Richest (GDP)', icon: '💰', format: (v) => CMapsUtils.formatGDP(v) },
            { key: 'by_regions', title: 'Most Regions', icon: '🏘️', format: (v) => `${v} regions` },
        ];

        let html = '';

        // Global stats summary
        if (data.global) {
            html += `
                <div class="lb-global">
                    <div class="lb-global-stat">
                        <span class="lb-global-value">${CMapsUtils.formatNumber(data.global.total_countries)}</span>
                        <span class="lb-global-label">Countries</span>
                    </div>
                    <div class="lb-global-stat">
                        <span class="lb-global-value">${CMapsUtils.formatPopShort(data.global.total_population)}</span>
                        <span class="lb-global-label">Population</span>
                    </div>
                    <div class="lb-global-stat">
                        <span class="lb-global-value">${CMapsUtils.formatArea(data.global.total_area)}</span>
                        <span class="lb-global-label">Land Area</span>
                    </div>
                </div>
            `;
        }

        for (const section of sections) {
            const items = data[section.key];
            if (!items || items.length === 0) continue;

            html += `<div class="lb-section">`;
            html += `<div class="lb-section-title">${section.icon} ${section.title}</div>`;

            items.forEach((item, i) => {
                const medal = i < 3 ? medals[i] : `<span class="lb-rank">${i + 1}</span>`;
                html += `
                    <div class="lb-item" data-country-id="${item.id}">
                        <span class="lb-medal">${medal}</span>
                        <span class="lb-name">${item.flag || '🏳️'} ${item.name}</span>
                        <span class="lb-value">${section.format(item.value)}</span>
                    </div>
                `;
            });

            html += `</div>`;
        }

        container.innerHTML = html;

        // Click to fly to country
        container.querySelectorAll('.lb-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = parseInt(item.dataset.countryId);
                if (id) {
                    CMapsGlobe.selectCountry(id);
                    CMapsGlobe.flyToCountry(id);
                }
            });
        });
    }

    return { init, show, hide, toggle };
})();
