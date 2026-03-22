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

    // Track current data scale per layer for scale-dependent switching
    let _currentScale = { rivers: null, lakes: null, urban: null };

    // ── Animation state ──
    let _animFrame = null;
    let _animLastTick = 0;
    const _ANIM_INTERVAL = 80; // ~12 fps for paint property updates
    let _idleTimer = null;
    let _autoRotate = false;
    let _userInteracting = false;

    const LAYERS = {
        COUNTRY_FILL: 'country-fill',
        COUNTRY_BORDER: 'country-border',
        COUNTRY_HIGHLIGHT: 'country-highlight',
        COUNTRY_OUTLINE: 'country-outline', // glow outline on hover
        COUNTRY_INTERACT: 'country-fill-interact', // invisible interaction layer
        COUNTRY_FILL_LOWPOLY: 'country-fill-lowpoly',
        COUNTRY_BORDER_LOWPOLY: 'country-border-lowpoly',
        RIVERS: 'rivers-line',
        LAKES: 'lakes-fill',
        MOUNTAINS: 'mountains-symbol',
        CITIES_DOT: 'cities-dot',
        CITIES_LABEL: 'cities-label',
        REGIONS_FILL: 'regions-fill',
        REGIONS_BORDER: 'regions-border',
        CAPITALS: 'capitals-symbol',
        CAPITALS_LABEL: 'capitals-label',
        MOUNTAIN_RANGES: 'mountain-ranges-fill',
        SKY: 'sky-atmosphere',
        UNCLAIMED_PATTERN: 'unclaimed-pattern',
        // New layers
        URBAN_FILL: 'urban-areas-fill',
        REEFS_LINE: 'reefs-line',
        PARKS_FILL: 'parks-fill',
    };

    // Zoom thresholds for data resolution switching
    const ZOOM_THRESHOLDS = {
        LOW: 3,     // Below: 110m data
        MED: 5,     // 3-5: 50m data
        HIGH: 5,    // Above: 10m data (regions)
    };

    /** Convert current zoom to scale string for API calls */
    function _zoomToScale(zoom) {
        if (zoom < ZOOM_THRESHOLDS.LOW) return '110';
        if (zoom < ZOOM_THRESHOLDS.MED) return '50';
        return '10';
    }

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
            center: [15, 25],
            zoom: 1.8,
            pitch: 0,
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

            // Load 110m low-poly data for the stylized zoomed-out globe view
            const lowPoly = await fetch('/static/data/ne_110m_admin_0_countries.geojson')
                .then(r => r.json()).catch(() => null);
            if (lowPoly) addLowPolyLayer(lowPoly);

            addCountryLayers(countriesData);

            // Initial zoom for scale-dependent loading
            const initZoom = map.getZoom();

            const [rivers, lakes, mountains, mountainRanges, regions, capitals, urbanAreas, reefs, parks] = await Promise.all([
                CMapsUtils.api(`/api/features/rivers?zoom=${initZoom}`).catch(() => ({ type: 'FeatureCollection', features: [] })),
                CMapsUtils.api(`/api/features/lakes?zoom=${initZoom}`).catch(() => ({ type: 'FeatureCollection', features: [] })),
                CMapsUtils.api('/api/features/mountains').catch(() => ({ type: 'FeatureCollection', features: [] })),
                CMapsUtils.api('/api/features/mountain-ranges').catch(() => ({ type: 'FeatureCollection', features: [] })),
                CMapsUtils.api('/api/regions/geojson').catch(() => ({ type: 'FeatureCollection', features: [] })),
                CMapsUtils.api('/api/capitals?zoom=20').catch(() => ({ type: 'FeatureCollection', features: [] })),
                CMapsUtils.api(`/api/features/urban-areas?zoom=${initZoom}`).catch(() => ({ type: 'FeatureCollection', features: [] })),
                CMapsUtils.api('/api/features/reefs').catch(() => ({ type: 'FeatureCollection', features: [] })),
                CMapsUtils.api('/api/features/parks').catch(() => ({ type: 'FeatureCollection', features: [] })),
            ]);

            _currentScale.rivers = _zoomToScale(initZoom);
            _currentScale.lakes = _zoomToScale(initZoom);
            _currentScale.urban = _zoomToScale(initZoom);

            addRiversLayer(rivers);
            addLakesLayer(lakes);
            addMountainRangesLayer(mountainRanges);
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

            // Cities — loaded directly from static GeoJSON file, zero backend processing
            addCitiesLayer();

            addCapitalsLayer(capitals);
            addUrbanAreasLayer(urbanAreas);
            addReefsLayer(reefs);
            addParksLayer(parks);

            // Start ambient map animations (capital pulse, ocean breathing, etc.)
            _startAnimations();

            // Particles disabled
            // CMapsParticles.init(map);

            // Set up scale-dependent data switching on zoom change
            _setupScaleSwitching();

            const count = countriesData.features?.length || 0;
            document.getElementById('country-count').textContent = `${count} countries`;
            CMapsUtils.setStatus('All layers loaded');

        } catch (error) {
            console.error('Failed to load layers:', error);
            CMapsUtils.toast('Failed to load map data. Check server connection.', 'error');
        }
    }

    /**
     * Scale-dependent data switching — reload river/lake/urban data
     * when crossing zoom thresholds (110m ↔ 50m ↔ 10m).
     */
    let _scaleUpdatePending = false;
    function _setupScaleSwitching() {
        map.on('zoomend', CMapsUtils.debounce(async () => {
            if (_scaleUpdatePending) return;
            const zoom = map.getZoom();
            const newScale = _zoomToScale(zoom);

            // Only reload if the scale tier changed
            const needsRivers = newScale !== _currentScale.rivers;
            const needsLakes = newScale !== _currentScale.lakes;
            const needsUrban = newScale !== _currentScale.urban;

            if (!needsRivers && !needsLakes && !needsUrban) return;

            _scaleUpdatePending = true;
            try {
                const fetches = [];

                if (needsRivers) {
                    fetches.push(
                        CMapsUtils.api(`/api/features/rivers?zoom=${zoom}`)
                            .then(data => {
                                const src = map.getSource('rivers');
                                if (src) src.setData(data);
                                _currentScale.rivers = newScale;
                            }).catch(() => {})
                    );
                }
                if (needsLakes) {
                    fetches.push(
                        CMapsUtils.api(`/api/features/lakes?zoom=${zoom}`)
                            .then(data => {
                                const src = map.getSource('lakes');
                                if (src) src.setData(data);
                                _currentScale.lakes = newScale;
                            }).catch(() => {})
                    );
                }
                if (needsUrban) {
                    fetches.push(
                        CMapsUtils.api(`/api/features/urban-areas?zoom=${zoom}`)
                            .then(data => {
                                const src = map.getSource('urban-areas');
                                if (src) src.setData(data);
                                _currentScale.urban = newScale;
                            }).catch(() => {})
                    );
                }

                await Promise.all(fetches);
            } finally {
                _scaleUpdatePending = false;
            }
        }, 300));
    }

    // ═══════════════════════════════════════════════════════
    //  AMBIENT ANIMATIONS: Capital pulse, ocean breathing, etc.
    // ═══════════════════════════════════════════════════════

    /** Kick off the master animation loop + idle rotation tracking. */
    function _startAnimations() {
        _animLastTick = 0;
        _animFrame = requestAnimationFrame(_animLoop);
        _setupIdleRotation();
    }

    /** Master RAF loop — throttled to ~12 fps for paint updates. */
    function _animLoop(timestamp) {
        _animFrame = requestAnimationFrame(_animLoop);

        if (timestamp - _animLastTick < _ANIM_INTERVAL) return;
        _animLastTick = timestamp;

        const t = timestamp / 1000; // elapsed seconds

        _updateCapitalPulse(t);
        _updateOceanBreathing(t);

        if (_autoRotate && !_userInteracting) {
            _tickAutoRotation();
        }
    }

    /** Breathing halo on capital cities — slow pulse on ring stroke. */
    function _updateCapitalPulse(t) {
        const haloId = LAYERS.CAPITALS + '-halo';
        if (!map.getLayer(haloId)) return;

        // ~7-second cycle for stroke opacity 0.15–0.55
        const pulse = 0.35 + 0.20 * Math.sin(t * 0.9);
        const strokeAlpha = `rgba(239, 68, 68, ${pulse.toFixed(3)})`;
        map.setPaintProperty(haloId, 'circle-stroke-color', strokeAlpha);
    }

    /** Very subtle ocean background colour cycling. */
    function _updateOceanBreathing(t) {
        // Oscillate the blue channel slightly: #0d1b2a ↔ #0e1d30
        const shift = 0.5 + 0.5 * Math.sin(t * 0.3); // ~21-second cycle
        const r = 13;
        const g = Math.round(27 + shift * 2);  // 27-29
        const b = Math.round(42 + shift * 6);  // 42-48
        map.setPaintProperty('background', 'background-color', `rgb(${r},${g},${b})`);
    }

    /** Track user interaction and start slow auto-rotation after idle. */
    function _setupIdleRotation() {
        const resetIdle = () => {
            _autoRotate = false;
            _userInteracting = true;
            clearTimeout(_idleTimer);
            _idleTimer = setTimeout(() => {
                _userInteracting = false;
                if (map.getZoom() < 4) _autoRotate = true;
            }, 45000); // 45 s idle
        };

        map.on('mousedown', resetIdle);
        map.on('touchstart', resetIdle);
        map.on('wheel', resetIdle);
        map.on('movestart', () => { if (!_autoRotate) _userInteracting = true; });
        map.on('moveend', () => { _userInteracting = false; });

        // Initial idle timer
        _idleTimer = setTimeout(() => {
            if (map.getZoom() < 4) _autoRotate = true;
        }, 45000);
    }

    /** Nudge globe eastward — ~0.14°/s ≈ full rotation in ~43 min. */
    function _tickAutoRotation() {
        const center = map.getCenter();
        map.setCenter([center.lng + 0.012, center.lat]);
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
            tolerance: 0.8,
            buffer: 128
        });

        map.addLayer({
            id: LAYERS.COUNTRY_FILL,
            type: 'fill',
            source: 'countries',
            paint: {
                'fill-color': colorExpression,
                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false],
                        ['interpolate', ['linear'], ['zoom'], 0, 0, 3, 0.4, 5, 0.9, 8, 0.45],
                    ['boolean', ['feature-state', 'hover'], false],
                        ['interpolate', ['linear'], ['zoom'], 0, 0, 3, 0.3, 5, 0.8, 8, 0.35],
                    ['interpolate', ['linear'], ['zoom'], 0, 0, 3, 0.2, 5, 0.65, 8, 0.2]
                ],
            },
            // No maxzoom — ensures small countries (Liechtenstein, Andorra, etc.) remain clickable
        });

        // Invisible interaction layer — guarantees country click/hover at all zoom levels
        map.addLayer({
            id: LAYERS.COUNTRY_INTERACT,
            type: 'fill',
            source: 'countries',
            paint: {
                'fill-color': '#000000',
                'fill-opacity': 0,
            },
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
                    ['boolean', ['feature-state', 'selected'], false],
                        ['interpolate', ['linear'], ['zoom'], 0, 0.8, 6, 0.6, 9, 0.2],
                    ['boolean', ['feature-state', 'hover'], false],
                        ['interpolate', ['linear'], ['zoom'], 0, 0.6, 6, 0.4, 9, 0.1],
                    0
                ],
            },
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
                'line-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 1,
                    6, 0.6,
                    9, 0.15
                ],
            },
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

    /**
     * Add a low-poly 110m country layer for the stylized zoomed-out globe.
     * Cross-fades with the detailed DB country layer around zoom 3-5.
     */
    function addLowPolyLayer(geojson) {
        const colorExpr = buildLowPolyColorExpression();

        map.addSource('countries-lowpoly', {
            type: 'geojson',
            data: geojson,
            tolerance: 1.5,
        });

        map.addLayer({
            id: LAYERS.COUNTRY_FILL_LOWPOLY,
            type: 'fill',
            source: 'countries-lowpoly',
            paint: {
                'fill-color': colorExpr,
                'fill-opacity': ['interpolate', ['linear'], ['zoom'],
                    0, 0.7, 2.5, 0.55, 3.5, 0.1, 4.2, 0
                ],
            },
            maxzoom: 4.5,
        });

        map.addLayer({
            id: LAYERS.COUNTRY_BORDER_LOWPOLY,
            type: 'line',
            source: 'countries-lowpoly',
            paint: {
                'line-color': 'rgba(255, 255, 255, 0.35)',
                'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 2.5, 0.8, 4, 0.3],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                    0, 0.9, 2.5, 0.6, 3.5, 0.15, 4.2, 0
                ],
            },
            maxzoom: 4.5,
        });
    }

    /**
     * Build color expression for the 110m low-poly layer using ADM0_A3 matching.
     */
    function buildLowPolyColorExpression() {
        const isoToColor = {};
        if (countriesData?.features) {
            for (const f of countriesData.features) {
                const p = f.properties;
                if (p?.iso_a3 && p.iso_a3 !== '-99' && p?.color) {
                    isoToColor[p.iso_a3] = p.color;
                }
            }
        }
        const matchExpr = ['match', ['get', 'ADM0_A3']];
        for (const [iso, color] of Object.entries(isoToColor)) {
            matchExpr.push(iso, color);
        }
        matchExpr.push('#e2e8f0');
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

    function addMountainRangesLayer(geojson) {
        if (!geojson.features || geojson.features.length === 0) return;

        map.addSource('mountain-ranges', { type: 'geojson', data: geojson, tolerance: 1.0 });

        // Semi-transparent fill with earthy brown tones
        map.addLayer({
            id: LAYERS.MOUNTAIN_RANGES,
            type: 'fill',
            source: 'mountain-ranges',
            paint: {
                'fill-color': [
                    'interpolate', ['linear'],
                    ['get', 'avg_elevation'],
                    800, 'rgba(139, 90, 43, 0.08)',
                    2000, 'rgba(160, 82, 45, 0.12)',
                    4000, 'rgba(139, 69, 19, 0.18)',
                    6000, 'rgba(120, 50, 10, 0.22)',
                ],
                'fill-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    1, 0.15,
                    3, 0.35,
                    6, 0.25,
                    10, 0.1,
                ],
            },
            minzoom: 1,
        });

        // Subtle outline
        map.addLayer({
            id: LAYERS.MOUNTAIN_RANGES + '-outline',
            type: 'line',
            source: 'mountain-ranges',
            paint: {
                'line-color': 'rgba(180, 120, 60, 0.3)',
                'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 5, 1.2, 10, 0.5],
                'line-dasharray': [4, 3],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.2, 3, 0.5, 8, 0.2],
            },
            minzoom: 1.5,
        });

        // Range name labels
        map.addLayer({
            id: LAYERS.MOUNTAIN_RANGES + '-label',
            type: 'symbol',
            source: 'mountain-ranges',
            layout: {
                'text-field': ['get', 'name'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 5, 13, 8, 11],
                'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
                'text-allow-overlap': false,
                'text-optional': true,
                'text-max-width': 10,
                'text-letter-spacing': 0.15,
                'text-transform': 'uppercase',
            },
            paint: {
                'text-color': '#c9a87c',
                'text-halo-color': 'rgba(10, 10, 15, 0.85)',
                'text-halo-width': 1.5,
                'text-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 4, 0.8, 8, 0.5],
            },
            minzoom: 2,
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

    function addCitiesLayer() {
        // ─────────────────────────────────────────────────────────────
        // CLEAN REIMPLEMENTATION — bypasses the API entirely.
        // Reads the static Natural Earth GeoJSON file directly so
        // MapLibre fetches, parses, and indexes it with zero backend
        // code in the path.  Progressive disclosure is handled
        // purely by circle-radius scaling + symbol collision, with
        // NO zoom-based filter expressions (which are invalid in
        // MapLibre and silently hide everything).
        // ─────────────────────────────────────────────────────────────
        map.addSource('cities', {
            type: 'geojson',
            data: '/static/data/ne_10m_populated_places_simple.geojson',
            cluster: false,
        });

        // City dot — radius scales by scalerank so important cities
        // are bigger and always visible at lower zooms.
        map.addLayer({
            id: LAYERS.CITIES_DOT,
            type: 'circle',
            source: 'cities',
            minzoom: 2,
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    2, ['interpolate', ['linear'], ['get', 'scalerank'], 0, 3, 4, 2, 8, 1, 10, 0.5],
                    6, ['interpolate', ['linear'], ['get', 'scalerank'], 0, 5, 4, 3.5, 8, 2.5, 10, 1.5],
                    10, ['interpolate', ['linear'], ['get', 'scalerank'], 0, 6, 4, 5, 8, 4, 10, 3],
                ],
                'circle-color': '#cbd5e1',
                'circle-stroke-width': 0.6,
                'circle-stroke-color': 'rgba(15, 23, 42, 0.5)',
                'circle-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    2, 0.7,
                    6, 0.9,
                ],
            },
        });

        // City label — symbol-sort-key by scalerank so the most
        // important cities win collision detection at low zooms.
        // text-allow-overlap: false ensures natural progressive reveal.
        map.addLayer({
            id: LAYERS.CITIES_LABEL,
            type: 'symbol',
            source: 'cities',
            minzoom: 3,
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
                'text-size': [
                    'interpolate', ['linear'], ['zoom'],
                    3, 9,
                    7, 11,
                    12, 14,
                ],
                'text-offset': [0, 1.0],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-optional': true,
                'text-max-width': 8,
                'symbol-sort-key': ['get', 'scalerank'],
            },
            paint: {
                'text-color': '#c8d6e5',
                'text-halo-color': 'rgba(5, 10, 20, 0.92)',
                'text-halo-width': 1.8,
                'text-halo-blur': 0.5,
            },
        });

        console.log('[CMaps] Cities layer added — source: static GeoJSON file');
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

        // ── Outer glow halo — pulsing ring (animated in _updateCapitalPulse) ──
        map.addLayer({
            id: LAYERS.CAPITALS + '-halo',
            type: 'circle',
            source: 'capitals',
            filter: ['==', ['get', 'is_country_capital'], true],
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 12,  3, 16,  6, 22,  10, 30,
                ],
                'circle-color': 'rgba(239, 68, 68, 0.0)',
                'circle-stroke-width': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 1.5, 6, 2.5, 10, 3,
                ],
                'circle-stroke-color': 'rgba(239, 68, 68, 0.35)',
                'circle-blur': 0.6,
            },
            minzoom: 1,
        });

        // ── Star marker for country capitals — unicode ★ symbol ──
        map.addLayer({
            id: LAYERS.CAPITALS + '-star',
            type: 'symbol',
            source: 'capitals',
            filter: ['==', ['get', 'is_country_capital'], true],
            layout: {
                'text-field': '★',
                'text-size': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 14,  3, 18,  6, 24,  10, 30,
                ],
                'text-allow-overlap': true,
                'text-ignore-placement': true,
                'text-padding': 0,
            },
            paint: {
                'text-color': '#ef4444',
                'text-halo-color': 'rgba(127, 29, 29, 0.9)',
                'text-halo-width': 1.5,
            },
            minzoom: 0,
        });

        // ── Main dot for non-country capitals (regional/admin capitals) ──
        map.addLayer({
            id: LAYERS.CAPITALS,
            type: 'circle',
            source: 'capitals',
            filter: ['!=', ['get', 'is_country_capital'], true],
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 2,  5, 3.5,  10, 5,
                ],
                'circle-color': '#f1f5f9',
                'circle-stroke-width': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 0.8,  8, 1.5,
                ],
                'circle-stroke-color': 'rgba(15, 23, 42, 0.5)',
                'circle-opacity': 1,
            },
            minzoom: 3,
        });

        // ── Country capital label — bold, uppercase, early visibility ──
        map.addLayer({
            id: LAYERS.CAPITALS_LABEL,
            type: 'symbol',
            source: 'capitals',
            filter: ['==', ['get', 'is_country_capital'], true],
            layout: {
                'text-field': ['upcase', ['get', 'name']],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 11,  4, 13,  8, 16,  12, 18,
                ],
                'text-offset': [0, 1.4],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-optional': true,
                'text-letter-spacing': 0.08,
            },
            paint: {
                'text-color': '#fca5a5',
                'text-halo-color': 'rgba(5, 10, 20, 0.95)',
                'text-halo-width': 2.5,
                'text-halo-blur': 0.3,
            },
            minzoom: 1,
        });

        // ── Non-country capital label (regional/admin) ──
        map.addLayer({
            id: LAYERS.CAPITALS_LABEL + '-minor',
            type: 'symbol',
            source: 'capitals',
            filter: ['!=', ['get', 'is_country_capital'], true],
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
                'text-size': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 9,  4, 11,  8, 13,  12, 15,
                ],
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-optional': true,
                'text-letter-spacing': 0.03,
            },
            paint: {
                'text-color': '#e2e8f0',
                'text-halo-color': 'rgba(5, 10, 20, 0.9)',
                'text-halo-width': 1.8,
                'text-halo-blur': 0.3,
            },
            minzoom: 3,
        });
    }

    // ═══════════════════════════════════════════════════════
    //  NEW LAYERS: Urban Areas, Reefs, Parks
    // ═══════════════════════════════════════════════════════

    function addUrbanAreasLayer(geojson) {
        map.addSource('urban-areas', { type: 'geojson', data: geojson, tolerance: 0.6 });
        map.addLayer({
            id: LAYERS.URBAN_FILL,
            type: 'fill',
            source: 'urban-areas',
            paint: {
                'fill-color': '#f59e0b',
                'fill-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    3, 0.05,
                    6, 0.15,
                    10, 0.25,
                ],
            },
            minzoom: 4,
        });
        map.addLayer({
            id: LAYERS.URBAN_FILL + '-outline',
            type: 'line',
            source: 'urban-areas',
            paint: {
                'line-color': 'rgba(245, 158, 11, 0.4)',
                'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.3, 10, 1],
            },
            minzoom: 5,
        });
    }

    function addReefsLayer(geojson) {
        if (!geojson.features || geojson.features.length === 0) return;
        map.addSource('reefs', { type: 'geojson', data: geojson, tolerance: 0.5 });
        map.addLayer({
            id: LAYERS.REEFS_LINE,
            type: 'line',
            source: 'reefs',
            paint: {
                'line-color': '#06b6d4',
                'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 8, 3],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.4, 6, 0.7, 10, 0.9],
            },
            minzoom: 3,
        });
        // Reef label
        map.addLayer({
            id: LAYERS.REEFS_LINE + '-label',
            type: 'symbol',
            source: 'reefs',
            layout: {
                'symbol-placement': 'line',
                'text-field': ['get', 'name'],
                'text-size': 10,
                'text-optional': true,
            },
            paint: {
                'text-color': '#67e8f9',
                'text-halo-color': 'rgba(0,0,0,0.7)',
                'text-halo-width': 1,
            },
            minzoom: 6,
        });
    }

    function addParksLayer(geojson) {
        if (!geojson.features || geojson.features.length === 0) return;
        map.addSource('parks', { type: 'geojson', data: geojson, tolerance: 0.6 });
        map.addLayer({
            id: LAYERS.PARKS_FILL,
            type: 'fill',
            source: 'parks',
            paint: {
                'fill-color': '#22c55e',
                'fill-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    4, 0.08,
                    7, 0.18,
                    10, 0.28,
                ],
            },
            minzoom: 4,
        });
        map.addLayer({
            id: LAYERS.PARKS_FILL + '-outline',
            type: 'line',
            source: 'parks',
            paint: {
                'line-color': 'rgba(34, 197, 94, 0.5)',
                'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.3, 10, 1.2],
                'line-dasharray': [3, 2],
            },
            minzoom: 5,
        });
        map.addLayer({
            id: LAYERS.PARKS_FILL + '-label',
            type: 'symbol',
            source: 'parks',
            layout: {
                'text-field': ['get', 'name'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 5, 9, 10, 12],
                'text-optional': true,
                'text-max-width': 8,
            },
            paint: {
                'text-color': '#86efac',
                'text-halo-color': 'rgba(0,0,0,0.8)',
                'text-halo-width': 1.2,
            },
            minzoom: 7,
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
            const isoCode = (props.iso_code || '').toLowerCase();
            // Only build a local path for real 2-letter ISO codes (skip synthetic X-prefix)
            const flagSrc = props.flag_url
                || (isoCode && isoCode.length === 2 && isoCode !== '-99' && !isoCode.startsWith('x')
                    ? `/static/data/flags/${isoCode}.png` : null);
            const emojiFallback = props.flag_emoji || '🏳️';
            const flagHtml = flagSrc
                ? `<img src="${flagSrc}" alt="" class="country-popup-flag" onerror="this.outerHTML='<span>'+decodeURIComponent('${encodeURIComponent(emojiFallback)}')+'</span>'">`
                : `<span>${emojiFallback}</span>`;
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

        map.on('mousemove', LAYERS.COUNTRY_INTERACT, (e) => handleHover(e, 'countries'));
        map.on('mousemove', LAYERS.REGIONS_FILL, (e) => handleHover(e, 'regions'));

        const handleMouseLeave = () => {
            map.getCanvas().style.cursor = '';
            clearHoverState();
            popup.remove();
        };

        map.on('mouseleave', LAYERS.COUNTRY_INTERACT, handleMouseLeave);
        map.on('mouseleave', LAYERS.REGIONS_FILL, handleMouseLeave);

        // ── City / Capital hover popups ──
        const cityPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });

        const handleCityHover = (e, layerType) => {
            if (!e.features.length) return;
            map.getCanvas().style.cursor = 'pointer';
            const p = e.features[0].properties;
            const pop = p.pop_max || p.population || 0;
            const isCapital = Number(p.adm0cap) === 1;
            const tag = isCapital
                ? (layerType === 'capital' ? '★ Capital' : '★ Capital City')
                : 'City';
            const country = p.adm0name || p.country || p.country_name || '';
            const html = `
                <div class="country-popup">
                    <div class="country-popup-name"><span>${tag}</span></div>
                    <div style="font-size:13px;font-weight:600;margin:2px 0 4px">${p.name || 'Unknown'}</div>
                    <div class="country-popup-stats">
                        ${pop > 0 ? `<div class="country-popup-stat"><span>Population</span><span>${CMapsUtils.formatPopShort(pop)}</span></div>` : ''}
                        ${country ? `<div class="country-popup-stat"><span>Country</span><span>${country}</span></div>` : ''}
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

        // Cities layer hover + click
        let _cityClickConsumed = false;

        map.on('mousemove', LAYERS.CITIES_DOT, (e) => handleCityHover(e, 'city'));
        map.on('mouseleave', LAYERS.CITIES_DOT, handleCityLeave);
        map.on('click', LAYERS.CITIES_DOT, (e) => {
            if (!e.features.length) return;
            _cityClickConsumed = true;
            const coords = e.features[0].geometry.coordinates;
            flyTo(coords[0], coords[1], Math.max(map.getZoom() + 2, 8));
            cityPopup.remove();
        });

        // Capitals layer hover + click (star layer for country capitals, circle for others)
        for (const capLayer of [LAYERS.CAPITALS, LAYERS.CAPITALS + '-star']) {
            map.on('mousemove', capLayer, (e) => handleCityHover(e, 'capital'));
            map.on('mouseleave', capLayer, handleCityLeave);
            map.on('click', capLayer, (e) => {
                if (!e.features.length) return;
                _cityClickConsumed = true;
                const coords = e.features[0].geometry.coordinates;
                flyTo(coords[0], coords[1], Math.max(map.getZoom() + 2, 8));
                cityPopup.remove();
            });
        }

        const handleClick = (e, sourceName) => {
            if (_cityClickConsumed) { _cityClickConsumed = false; return; }
            if (e.features.length === 0) return;
            
            // In add-regions mode: only allow region clicks, suppress all country selection
            if (typeof CMapsEditor !== 'undefined' && CMapsEditor.getCurrentTool() === 'add-regions') {
                if (sourceName === 'regions') {
                    CMapsEditor.handleRegionClick(e.features[0], e.originalEvent?.shiftKey);
                }
                // Suppress country selection — keep target country locked
                return;
            }

            const countryId = sourceName === 'countries'
                ? (e.features[0].id || e.features[0].properties.id)
                : e.features[0].properties.country_id;

            if (countryId) selectCountry(countryId);
        };

        map.on('click', LAYERS.COUNTRY_INTERACT, (e) => handleClick(e, 'countries'));
        map.on('click', LAYERS.REGIONS_FILL, (e) => handleClick(e, 'regions'));

        map.on('click', (e) => {
            // Don't deselect when a city/capital click was consumed
            if (_cityClickConsumed) { _cityClickConsumed = false; return; }
            // Don't deselect the locked target in add-regions mode
            if (typeof CMapsEditor !== 'undefined' && CMapsEditor.getCurrentTool() === 'add-regions') return;
            const features = map.queryRenderedFeatures(e.point, { layers: [LAYERS.COUNTRY_INTERACT, LAYERS.REGIONS_FILL] });
            if (features.length === 0) {
                deselectCountry();
            }
        });

        // Context menu (right-click) — dispatches custom event for context-menu module
        map.on('contextmenu', (e) => {
            const features = map.queryRenderedFeatures(e.point, { layers: [LAYERS.COUNTRY_INTERACT, LAYERS.REGIONS_FILL] });
            const detail = {
                lngLat: e.lngLat,
                point: e.point,
                originalEvent: e.originalEvent,
                feature: features.length > 0 ? features[0] : null,
            };
            window.dispatchEvent(new CustomEvent('cmaps:contextmenu', { detail }));
        });


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

    let _refreshPending = false;
    async function refreshCountries() {
        if (_refreshPending) return; // Deduplicate rapid calls
        _refreshPending = true;
        try {
            countriesData = await CMapsUtils.api('/api/countries/geojson', { bypassCache: true });
            const source = map.getSource('countries');
            if (source) {
                source.setData(countriesData);

                // Batch all paint updates into one rAF
                requestAnimationFrame(() => {
                    const colorExpr = buildColorExpression(countriesData);
                    map.setPaintProperty(LAYERS.COUNTRY_FILL, 'fill-color', colorExpr);

                    const regionColorExpr = buildRegionColorExpression();
                    map.setPaintProperty(LAYERS.REGIONS_FILL, 'fill-color', [
                        'case',
                        ['==', ['get', 'country_id'], null], '#2a2a3a',
                        regionColorExpr,
                    ]);

                    if (map.getLayer(LAYERS.COUNTRY_FILL_LOWPOLY)) {
                        const lpColorExpr = buildLowPolyColorExpression();
                        map.setPaintProperty(LAYERS.COUNTRY_FILL_LOWPOLY, 'fill-color', lpColorExpr);
                    }
                });
            }

            if (!_dom.countryCount) _cacheDOM();
            const count = countriesData.features?.length || 0;
            _dom.countryCount.textContent = `${count} countries`;
        } catch (err) {
            console.error('Failed to refresh countries:', err);
        } finally {
            _refreshPending = false;
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
            'countries': [LAYERS.COUNTRY_FILL, LAYERS.COUNTRY_FILL_LOWPOLY, LAYERS.COUNTRY_BORDER_LOWPOLY, LAYERS.COUNTRY_INTERACT, LAYERS.REGIONS_FILL],
            'borders': [LAYERS.COUNTRY_BORDER, LAYERS.COUNTRY_OUTLINE],
            'rivers': [LAYERS.RIVERS, LAYERS.RIVERS + '-label'],
            'lakes': [LAYERS.LAKES, LAYERS.LAKES + '-label'],
            'mountains': [LAYERS.MOUNTAINS, LAYERS.MOUNTAINS + '-label'],
            'mountain-ranges': [LAYERS.MOUNTAIN_RANGES, LAYERS.MOUNTAIN_RANGES + '-outline', LAYERS.MOUNTAIN_RANGES + '-label'],
            'cities': [LAYERS.CITIES_DOT, LAYERS.CITIES_LABEL],
            'regions': [LAYERS.REGIONS_BORDER],
            'capitals': [LAYERS.CAPITALS, LAYERS.CAPITALS + '-halo', LAYERS.CAPITALS + '-star', LAYERS.CAPITALS_LABEL, LAYERS.CAPITALS_LABEL + '-minor'],
            'urban-areas': [LAYERS.URBAN_FILL, LAYERS.URBAN_FILL + '-outline'],
            'reefs': [LAYERS.REEFS_LINE, LAYERS.REEFS_LINE + '-label'],
            'parks': [LAYERS.PARKS_FILL, LAYERS.PARKS_FILL + '-outline', LAYERS.PARKS_FILL + '-label'],
        };

        // Particle animation toggles (disabled)
        if (layerKey === 'shore-waves' || layerKey === 'ocean-currents' || layerKey === 'wind-streams') return;

        // Auto-rotate toggle
        if (layerKey === 'auto-rotate') {
            if (visible) {
                _autoRotate = map.getZoom() < 4;
            } else {
                _autoRotate = false;
            }
            return; // no GL layers to toggle
        }

        const layers = layerMap[layerKey] || [];
        for (const layerId of layers) {
            if (map.getLayer(layerId)) {
                map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
            }
        }
    }

    // ── Cached DOM refs for hot-path updates ──
    const _dom = {};
    function _cacheDOM() {
        _dom.coords = document.getElementById('coordinates');
        _dom.zoom = document.getElementById('zoom-level');
        _dom.countryCount = document.getElementById('country-count');
    }

    function updateBottomBar() {
        if (!map) return;
        if (!_dom.coords) _cacheDOM();
        const center = map.getCenter();
        const zoom = map.getZoom();
        _dom.coords.textContent = `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
        _dom.zoom.textContent = `Zoom: ${zoom.toFixed(1)}`;

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

    /**
     * Instantly update region ownership in local data and re-render.
     * No server round-trip — map updates in the same frame.
     */
    function updateRegionCountryId(regionIds, newCountryId) {
        if (!regionsData?.features) return;

        for (const rid of regionIds) {
            const feature = regionsData.features.find(f =>
                (f.id === rid) || (f.properties?.id === rid)
            );
            if (feature) {
                const oldCId = feature.properties.country_id;
                feature.properties.country_id = newCountryId;

                // Update countryToRegions index
                if (oldCId && countryToRegions[oldCId]) {
                    countryToRegions[oldCId] = countryToRegions[oldCId].filter(id => id !== rid);
                }
                if (!countryToRegions[newCountryId]) countryToRegions[newCountryId] = [];
                if (!countryToRegions[newCountryId].includes(rid)) {
                    countryToRegions[newCountryId].push(rid);
                }
            }
        }

        // Push updated data to the source — triggers immediate re-render
        const source = map.getSource('regions');
        if (source) source.setData(regionsData);
    }

    function getMap() { return map; }
    function getSelectedId() { return selectedCountryId; }
    function getCountriesData() { return countriesData; }
    function getRegionsData() { return regionsData; }

    /**
     * Find all sibling region parts sharing the same base name.
     * E.g., "Galway" matches "Galway", "Galway (Inishmore)", "Galway (NW Isle)".
     */
    function getRegionSiblings(regionName) {
        if (!regionsData) return [];
        const baseName = regionName.replace(/\s*\([^)]*\)\s*$/, '').trim();
        return regionsData.features.filter(f => {
            const n = f.properties?.name || '';
            return n === baseName || n.startsWith(baseName + ' (');
        });
    }

    return {
        init,
        getMap,
        getSelectedId,
        getCountriesData,
        getRegionsData,
        getRegionSiblings,
        updateRegionCountryId,
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