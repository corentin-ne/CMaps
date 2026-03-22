/**
 * CMaps — Globe Module
 * Initializes MapLibre GL JS with globe projection, atmosphere,
 * zoom-adaptive data loading, and manages map layers.
 */
const CMapsGlobe = (() => {
    let map = null;
    let hoveredCountryId = null;
    let selectedCountryId = null;
    let countriesData = null;
    let regionsData = null;
    let countryToRegions = {};
    let popup = null;
    let currentCountryResolution = '110m'; // Track which resolution is loaded

    const LAYERS = {
        COUNTRY_FILL: 'country-fill',
        COUNTRY_BORDER: 'country-border',
        COUNTRY_HIGHLIGHT: 'country-highlight',
        COUNTRY_OUTLINE: 'country-outline', // glow outline on hover
        RIVERS: 'rivers-line',
        LAKES: 'lakes-fill',
        MOUNTAINS: 'mountains-symbol',
        CITIES: 'cities-symbol',
        CITIES_LABEL: 'cities-label',
        REGIONS_FILL: 'regions-fill',
        REGIONS_BORDER: 'regions-border',
        CAPITALS: 'capitals-symbol',
        CAPITALS_LABEL: 'capitals-label',
        SKY: 'sky-atmosphere',
        UNCLAIMED_PATTERN: 'unclaimed-pattern',
    };

    // Zoom thresholds for data resolution switching
    const ZOOM_THRESHOLDS = {
        LOW: 3,     // Below: 110m data
        MED: 5,     // 3-5: 50m data
        HIGH: 5,    // Above: 10m data (regions)
    };

    /**
     * Initialize the MapLibre GL globe.
     */
    async function init() {
        CMapsUtils.setStatus('Initializing 3D globe...');

        map = new maplibregl.Map({
            container: 'map',
            style: {
                version: 8,
                name: 'CMaps Light',
                projection: { type: 'globe' },
                sources: {},
                layers: [
                    {
                        id: 'background',
                        type: 'background',
                        paint: {
                            'background-color': '#0d1b2a'
                        }
                    }
                ],
                glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            },
            center: [15, 30],
            zoom: 1.8,
            pitch: 35,
            minZoom: 0.5,
            maxZoom: 15,
            maxPitch: 75, // Allow steeper viewing angles
            attributionControl: false,
        });

        map.addControl(new maplibregl.AttributionControl({
            compact: true,
            customAttribution: '© Natural Earth | MapLibre | CMaps'
        }), 'bottom-left');

        map.addControl(new maplibregl.NavigationControl({
            visualizePitch: true,
            showZoom: true,
            showCompass: true
        }), 'bottom-right');

        popup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 12,
        });

        await new Promise((resolve) => map.on('load', resolve));

        // Enforce globe projection
        map.setProjection({ type: 'globe' });

        // Load all data layers
        await loadLayers();

        // Set up interactions
        setupInteractions();

        updateBottomBar();
        map.on('move', CMapsUtils.throttle(updateBottomBar, 50));
        map.on('zoom', CMapsUtils.throttle(updateBottomBar, 50));

        const overlay = document.getElementById('loading-overlay');
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.remove(), 500);

        CMapsUtils.setStatus('Ready');
        return map;
    }

    /**
     * Load all map data layers.
     */
    async function loadLayers() {
        CMapsUtils.setStatus('Loading map data...');
        try {
            countriesData = await CMapsUtils.api('/api/countries/geojson');
            addCountryLayers(countriesData);

            const [rivers, lakes, mountains, cities, regions, capitals] = await Promise.all([
                CMapsUtils.api('/api/features/rivers').catch(() => ({ type: 'FeatureCollection', features: [] })),
                CMapsUtils.api('/api/features/lakes').catch(() => ({ type: 'FeatureCollection', features: [] })),
                CMapsUtils.api('/api/features/mountains').catch(() => ({ type: 'FeatureCollection', features: [] })),
                CMapsUtils.api('/api/cities?zoom=0').catch(() => ({ type: 'FeatureCollection', features: [] })),
                CMapsUtils.api('/api/regions/geojson').catch(() => ({ type: 'FeatureCollection', features: [] })),
                CMapsUtils.api('/api/capitals?zoom=0').catch(() => ({ type: 'FeatureCollection', features: [] })),
            ]);

            addRiversLayer(rivers);
            addLakesLayer(lakes);
            addMountainsLayer(mountains);

            regionsData = regions;
            regionsData.features.forEach(f => {
                const cId = f.properties.country_id;
                if (cId) {
                    if (!countryToRegions[cId]) countryToRegions[cId] = [];
                    if (f.id === undefined) f.id = f.properties.id;
                    countryToRegions[cId].push(f.id);
                }
            });

            addRegionsLayer(regionsData);
            addCitiesLayer(cities);
            addCapitalsLayer(capitals);

            const count = countriesData.features?.length || 0;
            document.getElementById('country-count').textContent = `${count} countries`;
            CMapsUtils.setStatus('All layers loaded');

        } catch (error) {
            console.error('Failed to load layers:', error);
            CMapsUtils.toast('Failed to load map data. Check server connection.', 'error');
        }
    }

    /**
     * Add country polygons + borders + outline glow layer.
     */
    function addCountryLayers(geojson) {
        const colorExpression = buildColorExpression(geojson);

        map.addSource('countries', {
            type: 'geojson',
            data: geojson,
            promoteId: 'id',
            tolerance: 1.2,
            buffer: 0
        });

        map.addLayer({
            id: LAYERS.COUNTRY_FILL,
            type: 'fill',
            source: 'countries',
            paint: {
                'fill-color': colorExpression,
                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], 0.9,
                    ['boolean', ['feature-state', 'hover'], false], 0.75,
                    0.6
                ],
            },
            maxzoom: 4,
        });

        // Glow outline layer — thicker, colored line under hover/selected countries
        map.addLayer({
            id: LAYERS.COUNTRY_OUTLINE,
            type: 'line',
            source: 'countries',
            paint: {
                'line-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], '#60a5fa',
                    ['boolean', ['feature-state', 'hover'], false], '#8b5cf6',
                    'transparent'
                ],
                'line-width': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], 4,
                    ['boolean', ['feature-state', 'hover'], false], 3,
                    0
                ],
                'line-blur': 3,
                'line-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], 0.8,
                    ['boolean', ['feature-state', 'hover'], false], 0.6,
                    0
                ],
            },
            maxzoom: 4,
        });

        map.addLayer({
            id: LAYERS.COUNTRY_BORDER,
            type: 'line',
            source: 'countries',
            paint: {
                'line-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], '#ffffff',
                    'rgba(255, 255, 255, 0.25)'
                ],
                'line-width': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], 2.5,
                    ['boolean', ['feature-state', 'hover'], false], 1.5,
                    0.6
                ],
            },
            maxzoom: 4,
        });
    }

    function buildColorExpression(geojson) {
        const matchExpr = ['match', ['get', 'id']];
        const defaultColor = '#e2e8f0';

        if (geojson.features) {
            for (const feature of geojson.features) {
                const id = feature.properties?.id;
                const color = feature.properties?.color;
                if (id != null && color) {
                    matchExpr.push(id, color);
                }
            }
        }

        matchExpr.push(defaultColor);
        return matchExpr;
    }

    function addRiversLayer(geojson) {
        map.addSource('rivers', { type: 'geojson', data: geojson, tolerance: 0.8 });
        map.addLayer({
            id: LAYERS.RIVERS,
            type: 'line',
            source: 'rivers',
            paint: {
                'line-color': '#3a7abd',
                'line-width': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 0.5,
                    5, 1.5,
                    10, 3
                ],
                'line-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 0.3,
                    3, 0.6,
                    6, 0.8
                ],
            },
            minzoom: 1.5,
        });

        // River labels
        map.addLayer({
            id: LAYERS.RIVERS + '-label',
            type: 'symbol',
            source: 'rivers',
            layout: {
                'symbol-placement': 'line',
                'text-field': ['get', 'name'],
                'text-size': 11,
                'text-optional': true,
                'text-max-angle': 45,
            },
            paint: {
                'text-color': '#8ebcf5',
                'text-halo-color': 'rgba(10, 20, 30, 0.8)',
                'text-halo-width': 1.5,
            },
            minzoom: 4,
        });
    }

    function addLakesLayer(geojson) {
        map.addSource('lakes', { type: 'geojson', data: geojson, tolerance: 0.8 });
        map.addLayer({
            id: LAYERS.LAKES,
            type: 'fill',
            source: 'lakes',
            paint: {
                'fill-color': '#1a3a5c',
                'fill-opacity': 0.7,
            },
            minzoom: 2,
        });

        // Lake labels
        map.addLayer({
            id: LAYERS.LAKES + '-label',
            type: 'symbol',
            source: 'lakes',
            layout: {
                'text-field': ['get', 'name'],
                'text-size': 10,
                'text-optional': true,
            },
            paint: {
                'text-color': '#8ebcf5',
                'text-halo-color': 'rgba(10, 20, 30, 0.8)',
                'text-halo-width': 1.5,
            },
            minzoom: 3,
        });
    }

    function addMountainsLayer(geojson) {
        map.addSource('mountains', { type: 'geojson', data: geojson });

        // Mountain peak marker
        map.addLayer({
            id: LAYERS.MOUNTAINS,
            type: 'symbol',
            source: 'mountains',
            layout: {
                'text-field': '▲',
                'text-size': [
                    'interpolate', ['linear'], ['zoom'],
                    3, 8,
                    8, 14
                ],
                'text-allow-overlap': false,
            },
            paint: {
                'text-color': '#a0785a',
                'text-opacity': 0.8,
                'text-halo-color': 'rgba(0,0,0,0.5)',
                'text-halo-width': 1,
            },
            minzoom: 4,
        });

        // Mountain name + elevation labels
        map.addLayer({
            id: LAYERS.MOUNTAINS + '-label',
            type: 'symbol',
            source: 'mountains',
            layout: {
                'text-field': [
                    'case',
                    ['has', 'elevation'],
                    ['concat', ['get', 'name'], '\n', ['to-string', ['get', 'elevation']], 'm'],
                    ['get', 'name']
                ],
                'text-size': [
                    'interpolate', ['linear'], ['zoom'],
                    4, 9,
                    8, 12
                ],
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-optional': true,
                'text-max-width': 8,
            },
            paint: {
                'text-color': '#c9a87c',
                'text-halo-color': 'rgba(10, 10, 15, 0.85)',
                'text-halo-width': 1.5,
                'text-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    4, 0.6,
                    7, 1
                ],
            },
            minzoom: 5,
        });
    }

    function addCitiesLayer(geojson) {
        map.addSource('cities', { type: 'geojson', data: geojson });

        // Population-based radius: larger cities = bigger dots
        const popRadius = [
            'interpolate', ['linear'], ['zoom'],
            2, [
                'interpolate', ['linear'],
                ['coalesce', ['get', 'pop_max'], 0],
                0, 2,
                500000, 3,
                5000000, 5,
            ],
            6, [
                'interpolate', ['linear'],
                ['coalesce', ['get', 'pop_max'], 0],
                0, 3,
                500000, 4.5,
                5000000, 7,
            ],
            12, [
                'interpolate', ['linear'],
                ['coalesce', ['get', 'pop_max'], 0],
                0, 4,
                500000, 6,
                5000000, 10,
            ],
        ];

        // Outer ring — subtle glow / ambient halo
        map.addLayer({
            id: LAYERS.CITIES,
            type: 'circle',
            source: 'cities',
            paint: {
                'circle-radius': ['+', popRadius, 3],
                'circle-color': [
                    'case',
                    ['get', 'is_capital'], 'rgba(255, 215, 0, 0.15)',
                    'rgba(200, 210, 240, 0.12)',
                ],
                'circle-stroke-width': 0,
                'circle-blur': 1,
                'circle-pitch-alignment': 'map',
            },
            minzoom: 2,
        });

        // Main dot — crisp, solid, population-scaled
        map.addLayer({
            id: LAYERS.CITIES + '-core',
            type: 'circle',
            source: 'cities',
            paint: {
                'circle-radius': popRadius,
                'circle-color': [
                    'case',
                    ['get', 'is_capital'], '#fbbf24',
                    '#cbd5e1',
                ],
                'circle-stroke-width': [
                    'interpolate', ['linear'], ['zoom'],
                    2, 0.8,
                    8, 1.5,
                ],
                'circle-stroke-color': [
                    'case',
                    ['get', 'is_capital'], 'rgba(120, 80, 0, 0.6)',
                    'rgba(15, 23, 42, 0.5)',
                ],
                'circle-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    2, 0.85,
                    6, 1,
                ],
                'circle-pitch-alignment': 'map',
            },
            minzoom: 2,
        });

        // Labels
        map.addLayer({
            id: LAYERS.CITIES_LABEL,
            type: 'symbol',
            source: 'cities',
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
                'text-size': [
                    'interpolate', ['linear'], ['zoom'],
                    2, 9,
                    6, 11,
                    10, 13,
                ],
                'text-offset': [0, 1.3],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-optional': true,
                'text-max-width': 8,
                'text-letter-spacing': 0.02,
            },
            paint: {
                'text-color': [
                    'case',
                    ['get', 'is_capital'], '#fde68a',
                    '#94a3b8',
                ],
                'text-halo-color': 'rgba(5, 10, 20, 0.9)',
                'text-halo-width': 1.8,
                'text-halo-blur': 0.5,
                'text-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    2, 0.7,
                    5, 1,
                ],
            },
            minzoom: 2,
        });
    }

    function addRegionsLayer(geojson) {
        const colorExpression = buildRegionColorExpression();

        map.addSource('regions', {
            type: 'geojson',
            data: geojson,
            promoteId: 'id',
            tolerance: 0.8
        });

        map.addLayer({
            id: LAYERS.REGIONS_FILL,
            type: 'fill',
            source: 'regions',
            paint: {
                'fill-color': [
                    'case',
                    ['==', ['get', 'country_id'], null], '#2a2a3a', // unclaimed territories
                    colorExpression,
                ],
                'fill-opacity': [
                    'case',
                    ['==', ['get', 'country_id'], null], 0.3, // faded unclaimed
                    ['boolean', ['feature-state', 'selected'], false], 0.85,
                    ['boolean', ['feature-state', 'hover'], false], 0.7,
                    0.55
                ],
            },
            minzoom: 3.5,
        });

        map.addLayer({
            id: LAYERS.REGIONS_BORDER,
            type: 'line',
            source: 'regions',
            paint: {
                'line-color': [
                    'case',
                    ['==', ['get', 'country_id'], null], 'rgba(255, 255, 255, 0.15)',
                    ['boolean', ['feature-state', 'selected'], false], '#6ea8fe',
                    'rgba(255, 255, 255, 0.35)'
                ],
                'line-width': [
                    'case',
                    ['==', ['get', 'country_id'], null], 0.5,
                    ['boolean', ['feature-state', 'selected'], false], 2.5,
                    ['boolean', ['feature-state', 'hover'], false], 1.5,
                    0.8
                ],
            },
            minzoom: 3.5,
        });
    }

    function buildRegionColorExpression() {
        const matchExpr = ['match', ['get', 'country_id']];
        const defaultColor = '#e2e8f0';

        if (countriesData && countriesData.features) {
            for (const feature of countriesData.features) {
                const id = feature.properties?.id;
                const color = feature.properties?.color;
                if (id != null && color) {
                    matchExpr.push(id, color);
                }
            }
        }

        matchExpr.push(defaultColor);
        return matchExpr;
    }

    function addCapitalsLayer(geojson) {
        map.addSource('capitals', { type: 'geojson', data: geojson });

        // Outer halo for capitals — subtle prominence ring
        map.addLayer({
            id: LAYERS.CAPITALS + '-halo',
            type: 'circle',
            source: 'capitals',
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    0, ['case', ['get', 'is_country_capital'], 7, 5],
                    5, ['case', ['get', 'is_country_capital'], 11, 7],
                    10, ['case', ['get', 'is_country_capital'], 15, 9],
                ],
                'circle-color': [
                    'case',
                    ['get', 'is_country_capital'], 'rgba(239, 68, 68, 0.12)',
                    'rgba(248, 250, 252, 0.08)',
                ],
                'circle-blur': 1,
                'circle-stroke-width': 0,
            },
            minzoom: 1,
        });

        // Main capital dot — clean, no blur
        map.addLayer({
            id: LAYERS.CAPITALS,
            type: 'circle',
            source: 'capitals',
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    0, ['case', ['get', 'is_country_capital'], 3.5, 2],
                    5, ['case', ['get', 'is_country_capital'], 5.5, 3.5],
                    10, ['case', ['get', 'is_country_capital'], 8, 5],
                ],
                'circle-color': [
                    'case',
                    ['get', 'is_country_capital'], '#ef4444',
                    '#f1f5f9',
                ],
                'circle-stroke-width': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 1,
                    8, 2,
                ],
                'circle-stroke-color': [
                    'case',
                    ['get', 'is_country_capital'], 'rgba(127, 29, 29, 0.7)',
                    'rgba(15, 23, 42, 0.5)',
                ],
                'circle-opacity': 1,
            },
            minzoom: 1,
        });

        map.addLayer({
            id: LAYERS.CAPITALS_LABEL,
            type: 'symbol',
            source: 'capitals',
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
                'text-size': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 10,
                    6, 13,
                    10, 16,
                ],
                'text-offset': [0, 1.3],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-optional': true,
                'text-letter-spacing': 0.03,
            },
            paint: {
                'text-color': [
                    'case',
                    ['get', 'is_country_capital'], '#fecaca',
                    '#e2e8f0',
                ],
                'text-halo-color': 'rgba(5, 10, 20, 0.9)',
                'text-halo-width': 2,
                'text-halo-blur': 0.3,
            },
            minzoom: 1,
        });
    }

    function setupInteractions() {
        const handleHover = (e, sourceName) => {
            if (e.features.length === 0) return;
            map.getCanvas().style.cursor = 'pointer';

            const countryId = sourceName === 'countries'
                ? e.features[0].id
                : e.features[0].properties.country_id;

            if (!countryId) return;

            if (hoveredCountryId !== null && hoveredCountryId !== countryId) {
                clearHoverState();
            }

            hoveredCountryId = countryId;
            setCountryHoverState(countryId, true);

            const feature = countriesData?.features?.find(f => f.id === countryId || f.properties?.id === countryId);
            if (!feature) return;

            const props = feature.properties;
            const flagHtml = props.flag_url
                ? `<img src="${props.flag_url}" alt="" class="country-popup-flag">`
                : `<span>${props.flag_emoji || '🏳️'}</span>`;
            const popupContent = `
                <div class="country-popup">
                    <div class="country-popup-name">
                        ${flagHtml}
                        <span>${props.name}</span>
                    </div>
                    <div class="country-popup-stats">
                        <div class="country-popup-stat"><span>Population</span><span>${CMapsUtils.formatPopShort(props.population)}</span></div>
                        <div class="country-popup-stat"><span>Area</span><span>${CMapsUtils.formatArea(props.area_km2)}</span></div>
                        ${props.capital ? `<div class="country-popup-stat"><span>Capital</span><span>${props.capital}</span></div>` : ''}
                        ${props.gdp_md ? `<div class="country-popup-stat"><span>GDP</span><span>$${CMapsUtils.formatPopShort(props.gdp_md * 1e6)}</span></div>` : ''}
                    </div>
                    ${sourceName === 'regions' && e.features[0].properties.name ? `<div class="country-popup-hint">Region: ${e.features[0].properties.name}</div>` : ''}
                    <div class="country-popup-hint">Click for details</div>
                </div>
            `;
            popup.setLngLat(e.lngLat).setHTML(popupContent).addTo(map);
        };

        map.on('mousemove', LAYERS.COUNTRY_FILL, (e) => handleHover(e, 'countries'));
        map.on('mousemove', LAYERS.REGIONS_FILL, (e) => handleHover(e, 'regions'));

        const handleMouseLeave = () => {
            map.getCanvas().style.cursor = '';
            clearHoverState();
            popup.remove();
        };

        map.on('mouseleave', LAYERS.COUNTRY_FILL, handleMouseLeave);
        map.on('mouseleave', LAYERS.REGIONS_FILL, handleMouseLeave);

        // ── City / Capital hover popups ──
        const cityPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });

        const handleCityHover = (e, layerType) => {
            if (!e.features.length) return;
            map.getCanvas().style.cursor = 'pointer';
            const p = e.features[0].properties;
            const pop = p.pop_max || p.population || 0;
            const tag = p.is_capital === true || p.is_capital === 'true'
                ? (layerType === 'capital' ? '★ Capital' : '★ Capital City')
                : 'City';
            const html = `
                <div class="country-popup">
                    <div class="country-popup-name"><span>${tag}</span></div>
                    <div style="font-size:13px;font-weight:600;margin:2px 0 4px">${p.name}</div>
                    <div class="country-popup-stats">
                        ${pop > 0 ? `<div class="country-popup-stat"><span>Population</span><span>${CMapsUtils.formatPopShort(pop)}</span></div>` : ''}
                        ${p.country || p.country_name ? `<div class="country-popup-stat"><span>Country</span><span>${p.country || p.country_name}</span></div>` : ''}
                    </div>
                    <div class="country-popup-hint">Click to fly here</div>
                </div>
            `;
            cityPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
        };

        const handleCityLeave = () => {
            map.getCanvas().style.cursor = '';
            cityPopup.remove();
        };

        // Cities layer hover/click
        map.on('mousemove', LAYERS.CITIES + '-core', (e) => handleCityHover(e, 'city'));
        map.on('mouseleave', LAYERS.CITIES + '-core', handleCityLeave);
        map.on('click', LAYERS.CITIES + '-core', (e) => {
            if (!e.features.length) return;
            const coords = e.features[0].geometry.coordinates;
            flyTo(coords[0], coords[1], Math.max(map.getZoom() + 2, 7));
        });

        // Capitals layer hover/click
        map.on('mousemove', LAYERS.CAPITALS, (e) => handleCityHover(e, 'capital'));
        map.on('mouseleave', LAYERS.CAPITALS, handleCityLeave);
        map.on('click', LAYERS.CAPITALS, (e) => {
            if (!e.features.length) return;
            const coords = e.features[0].geometry.coordinates;
            flyTo(coords[0], coords[1], Math.max(map.getZoom() + 2, 7));
        });

        const handleClick = (e, sourceName) => {
            if (e.features.length === 0) return;
            
            // Handle Add Regions
            if (typeof CMapsEditor !== 'undefined' && CMapsEditor.getCurrentTool() === 'add-regions' && sourceName === 'regions') {
                 CMapsEditor.handleRegionClick(e.features[0]);
                 return;
            }

            const countryId = sourceName === 'countries'
                ? (e.features[0].id || e.features[0].properties.id)
                : e.features[0].properties.country_id;

            if (countryId) selectCountry(countryId);
        };

        map.on('click', LAYERS.COUNTRY_FILL, (e) => handleClick(e, 'countries'));
        map.on('click', LAYERS.REGIONS_FILL, (e) => handleClick(e, 'regions'));

        map.on('click', (e) => {
            const features = map.queryRenderedFeatures(e.point, { layers: [LAYERS.COUNTRY_FILL, LAYERS.REGIONS_FILL] });
            if (features.length === 0) {
                deselectCountry();
            }
        });

        // Context menu (right-click) — dispatches custom event for context-menu module
        map.on('contextmenu', (e) => {
            const features = map.queryRenderedFeatures(e.point, { layers: [LAYERS.COUNTRY_FILL, LAYERS.REGIONS_FILL] });
            const detail = {
                lngLat: e.lngLat,
                point: e.point,
                originalEvent: e.originalEvent,
                feature: features.length > 0 ? features[0] : null,
            };
            window.dispatchEvent(new CustomEvent('cmaps:contextmenu', { detail }));
        });

        map.on('zoomend', CMapsUtils.debounce(async () => {
            const zoom = map.getZoom();
            try {
                const [cities, capitals] = await Promise.all([
                    CMapsUtils.api(`/api/cities?zoom=${zoom}`).catch(() => null),
                    CMapsUtils.api(`/api/capitals?zoom=${zoom}`).catch(() => null)
                ]);

                if (cities) {
                    const cSource = map.getSource('cities');
                    if (cSource) cSource.setData(cities);
                }

                if (capitals) {
                    const capSource = map.getSource('capitals');
                    if (capSource) capSource.setData(capitals);
                }
            } catch (err) {
            }
        }, 300));
    }

    function setCountryHoverState(countryId, isHovered) {
        if (!countryId) return;
        map.setFeatureState({ source: 'countries', id: countryId }, { hover: isHovered });

        if (countryToRegions[countryId]) {
            countryToRegions[countryId].forEach(rId => {
                map.setFeatureState({ source: 'regions', id: rId }, { hover: isHovered });
            });
        }
    }

    function clearHoverState() {
        if (hoveredCountryId !== null) {
            setCountryHoverState(hoveredCountryId, false);
            hoveredCountryId = null;
        }
    }

    function setCountrySelectedState(countryId, isSelected) {
        if (!countryId) return;
        map.setFeatureState({ source: 'countries', id: countryId }, { selected: isSelected });

        if (countryToRegions[countryId]) {
            countryToRegions[countryId].forEach(rId => {
                map.setFeatureState({ source: 'regions', id: rId }, { selected: isSelected });
            });
        }
    }

    function selectCountry(id) {
        if (selectedCountryId !== null) {
            setCountrySelectedState(selectedCountryId, false);
        }

        selectedCountryId = id;
        setCountrySelectedState(id, true);

        const feature = countriesData?.features?.find(f => f.id === id || f.properties?.id === id);
        if (feature) {
            CMapsPanel.showCountry(feature);
        }

        document.getElementById('btn-split').disabled = false;
        document.getElementById('btn-delete').disabled = false;
    }

    function deselectCountry() {
        if (selectedCountryId !== null) {
            setCountrySelectedState(selectedCountryId, false);
            selectedCountryId = null;
        }
        CMapsPanel.hide();
        document.getElementById('btn-split').disabled = true;
        document.getElementById('btn-delete').disabled = true;
        document.getElementById('btn-merge').disabled = true;
    }

    async function refreshCountries() {
        try {
            countriesData = await CMapsUtils.api('/api/countries/geojson', { bypassCache: true });
            const source = map.getSource('countries');
            if (source) {
                source.setData(countriesData);
                const colorExpr = buildColorExpression(countriesData);
                map.setPaintProperty(LAYERS.COUNTRY_FILL, 'fill-color', colorExpr);

                const regionColorExpr = buildRegionColorExpression();
                map.setPaintProperty(LAYERS.REGIONS_FILL, 'fill-color', [
                    'case',
                    ['==', ['get', 'country_id'], null], '#2a2a3a',
                    regionColorExpr,
                ]);
            }
            const count = countriesData.features?.length || 0;
            document.getElementById('country-count').textContent = `${count} countries`;
        } catch (err) {
            console.error('Failed to refresh countries:', err);
        }
    }

    /**
     * Fly to a location with smooth animation and dynamic pitch.
     */
    function flyTo(lng, lat, zoom = 5, options = {}) {
        const targetPitch = zoom > 8 ? 55 : (zoom > 4 ? 45 : 35);
        map.flyTo({
            center: [lng, lat],
            zoom: zoom,
            pitch: options.pitch ?? targetPitch,
            bearing: options.bearing ?? map.getBearing(),
            duration: options.duration ?? 1800,
            essential: true,
            curve: 1.42,
            easing: (t) => {
                // Smooth ease-in-out cubic
                return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            },
        });
    }

    /**
     * Fit the map view to a bounding box with padding.
     */
    function fitBounds(bbox, options = {}) {
        map.fitBounds(bbox, {
            padding: options.padding ?? { top: 80, bottom: 80, left: 80, right: 480 },
            duration: options.duration ?? 1500,
            maxZoom: options.maxZoom ?? 8,
            pitch: options.pitch ?? 40,
            essential: true,
        });
    }

    /**
     * Fly to a country by fitting its bounding box.
     */
    function flyToCountry(countryId) {
        const feature = countriesData?.features?.find(f => f.id === countryId || f.properties?.id === countryId);
        if (!feature || !feature.geometry) return;

        try {
            const bbox = turf.bbox(feature);
            fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]]);
        } catch (e) {
            // Fallback to centroid
            const centroid = turf.centerOfMass(feature).geometry.coordinates;
            flyTo(centroid[0], centroid[1], 5);
        }
    }

    function toggleLayer(layerKey, visible) {
        const layerMap = {
            'countries': [LAYERS.COUNTRY_FILL, LAYERS.REGIONS_FILL],
            'borders': [LAYERS.COUNTRY_BORDER, LAYERS.COUNTRY_OUTLINE],
            'rivers': [LAYERS.RIVERS],
            'lakes': [LAYERS.LAKES],
            'mountains': [LAYERS.MOUNTAINS, LAYERS.MOUNTAINS + '-label'],
            'cities': [LAYERS.CITIES, LAYERS.CITIES + '-core', LAYERS.CITIES_LABEL],
            'regions': [LAYERS.REGIONS_BORDER],
            'capitals': [LAYERS.CAPITALS, LAYERS.CAPITALS + '-halo', LAYERS.CAPITALS_LABEL],
        };

        const layers = layerMap[layerKey] || [];
        for (const layerId of layers) {
            if (map.getLayer(layerId)) {
                map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
            }
        }
    }

    function updateBottomBar() {
        if (!map) return;
        const center = map.getCenter();
        const zoom = map.getZoom();
        document.getElementById('coordinates').textContent =
            `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
        document.getElementById('zoom-level').textContent =
            `Zoom: ${zoom.toFixed(1)}`;

        // Update scale bar if module exists
        if (typeof CMapsScaleBar !== 'undefined') {
            CMapsScaleBar.update(map);
        }
    }

    async function refreshRegions() {
        try {
            regionsData = await CMapsUtils.api('/api/regions/geojson', { bypassCache: true });
            countryToRegions = {};
            regionsData.features.forEach(f => {
                const cId = f.properties.country_id;
                if (cId) {
                    if (!countryToRegions[cId]) countryToRegions[cId] = [];
                    if (f.id === undefined) f.id = f.properties.id;
                    countryToRegions[cId].push(f.id);
                }
            });
            const source = map.getSource('regions');
            if (source) source.setData(regionsData);
        } catch (err) {
            console.error('Failed to refresh regions:', err);
        }
    }

    function getMap() { return map; }
    function getSelectedId() { return selectedCountryId; }
    function getCountriesData() { return countriesData; }
    function getRegionsData() { return regionsData; }

    return {
        init,
        getMap,
        getSelectedId,
        getCountriesData,
        getRegionsData,
        selectCountry,
        deselectCountry,
        refreshCountries,
        refreshRegions,
        flyTo,
        fitBounds,
        flyToCountry,
        toggleLayer,
        LAYERS,
    };
})();