/**
 * CMaps — Search Module
 * Handles country and city search with autocomplete.
 */
const CMapsSearch = (() => {
    let searchTimeout = null;

    function init() {
        const input = document.getElementById('search-input');
        const results = document.getElementById('search-results');

        // Input handler with debounce
        input.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query.length < 2) {
                results.classList.remove('active');
                return;
            }
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => performSearch(query), 250);
        });

        // Focus → show results if non-empty
        input.addEventListener('focus', () => {
            if (results.children.length > 0 && input.value.trim().length >= 2) {
                results.classList.add('active');
            }
        });

        // Close results on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#search-container')) {
                results.classList.remove('active');
            }
        });

        // Escape clears search
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                input.value = '';
                results.classList.remove('active');
                input.blur();
            }
        });
    }

    /**
     * Perform search across countries, regions, capitals, and cities.
     */
    async function performSearch(query) {
        const results = document.getElementById('search-results');

        try {
            // Search all endpoints in parallel
            const [countries, regions, capitals, cities] = await Promise.all([
                CMapsUtils.api(`/api/countries?search=${encodeURIComponent(query)}`).catch(() => []),
                CMapsUtils.api(`/api/regions/search?q=${encodeURIComponent(query)}`).catch(() => ({ features: [] })),
                CMapsUtils.api(`/api/capitals/search?q=${encodeURIComponent(query)}`).catch(() => ({ features: [] })),
                CMapsUtils.api(`/api/cities/search?q=${encodeURIComponent(query)}`).catch(() => ({ features: [] })),
            ]);

            let items = [];

            // Country results
            if (countries && countries.length > 0) {
                for (const country of countries.slice(0, 5)) {
                    const props = country.properties || country;
                    const flagIcon = props.flag_url
                        ? `<img src="${props.flag_url}" alt="" class="country-popup-flag" style="width:18px;height:12px">`
                        : (props.flag_emoji || '🏳️');
                    items.push({
                        type: 'country',
                        name: props.name,
                        meta: `${props.continent || ''} · ${CMapsUtils.formatPopShort(props.population)}`,
                        icon: flagIcon,
                        id: props.id,
                    });
                }
            }

            // Capital results
            if (capitals && capitals.features && capitals.features.length > 0) {
                for (const cap of capitals.features.slice(0, 4)) {
                    const props = cap.properties;
                    items.push({
                        type: 'capital',
                        name: props.name,
                        meta: `${props.country_name || ''} · Capital · ${CMapsUtils.formatPopShort(props.population)}`,
                        icon: props.is_country_capital ? '<span style="color:var(--danger)">★</span>' : '☆',
                        lng: cap.geometry.coordinates[0],
                        lat: cap.geometry.coordinates[1],
                    });
                }
            }

            // Region results
            if (regions && regions.features && regions.features.length > 0) {
                for (const reg of regions.features.slice(0, 4)) {
                    const props = reg.properties;
                    items.push({
                        type: 'region',
                        name: props.name,
                        meta: `${props.region_type || 'Region'} · ${props.iso_country || ''}`,
                        icon: '◰',
                        id: props.id,
                    });
                }
            }

            // City results
            if (cities && cities.features && cities.features.length > 0) {
                for (const city of cities.features.slice(0, 4)) {
                    const props = city.properties;
                    items.push({
                        type: 'city',
                        name: props.name,
                        meta: `${props.country || ''} · ${CMapsUtils.formatPopShort(props.pop_max)}`,
                        icon: '○',
                        lng: city.geometry.coordinates[0],
                        lat: city.geometry.coordinates[1],
                    });
                }
            }

            // Render results
            if (items.length === 0) {
                results.innerHTML = '<div class="empty-state" style="padding:12px">No results found</div>';
            } else {
                // Use DocumentFragment for efficient DOM insertion
                const frag = document.createDocumentFragment();
                items.forEach((item, i) => {
                    const el = document.createElement('div');
                    el.className = 'search-result-item';
                    el.dataset.type = item.type;
                    el.dataset.id = item.id || '';
                    el.dataset.lng = item.lng || '';
                    el.dataset.lat = item.lat || '';
                    el.dataset.index = i;
                    el.innerHTML = `
                        <div class="search-result-icon">${item.icon}</div>
                        <div class="search-result-info">
                            <div class="search-result-name">${item.name}</div>
                            <div class="search-result-meta">${item.meta}</div>
                        </div>
                    `;
                    el.addEventListener('click', () => onResultClick(el));
                    frag.appendChild(el);
                });
                results.textContent = '';
                results.appendChild(frag);
            }

            results.classList.add('active');
        } catch (err) {
            console.error('Search error:', err);
        }
    }

    /**
     * Handle clicking a search result.
     */
    async function onResultClick(el) {
        const type = el.dataset.type;
        const results = document.getElementById('search-results');
        results.classList.remove('active');
        document.getElementById('search-input').value = '';

        if (type === 'country') {
            const id = parseInt(el.dataset.id);
            // Fetch full country data
            try {
                const country = await CMapsUtils.api(`/api/countries/${id}`);
                const centroid = country.properties?.centroid;
                if (centroid) {
                    CMapsGlobe.flyTo(centroid[0], centroid[1], 5);
                }
                // Select after flight
                setTimeout(() => {
                    CMapsGlobe.selectCountry(id);
                }, 800);
            } catch (err) {
                CMapsUtils.toast('Failed to load country', 'error');
            }
        } else if (type === 'city' || type === 'capital') {
            const lng = parseFloat(el.dataset.lng);
            const lat = parseFloat(el.dataset.lat);
            CMapsGlobe.flyTo(lng, lat, 8);
        } else if (type === 'region') {
            const id = parseInt(el.dataset.id);
            try {
                const regionFeature = await CMapsUtils.api(`/api/regions/${id}`);
                if (regionFeature.geometry) {
                    const center = turf.centerOfMass(regionFeature).geometry.coordinates;
                    CMapsGlobe.flyTo(center[0], center[1], 6);
                }
            } catch (err) {
                CMapsUtils.toast('Failed to load region', 'error');
            }
        }
    }

    return { init };
})();
