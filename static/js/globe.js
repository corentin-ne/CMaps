/**
 * CMaps — Globe Module
 * Initializes MapLibre GL JS with globe projection and manages map layers.
 */
const CMapsGlobe = (() => {
    let map = null;
    let hoveredCountryId = null;
    let selectedCountryId = null;
    let countriesData = null;
    let popup = null;

    // Layer IDs
    const LAYERS = {
        COUNTRY_FILL: 'country-fill',
        COUNTRY_BORDER: 'country-border',
        COUNTRY_HIGHLIGHT: 'country-highlight',
        RIVERS: 'rivers-line',
        LAKES: 'lakes-fill',
        MOUNTAINS: 'mountains-symbol',
        CITIES: 'cities-symbol',
        CITIES_LABEL: 'cities-label',
        REGIONS_FILL: 'regions-fill',
        REGIONS_BORDER: 'regions-border',
        CAPITALS: 'capitals-symbol',
        CAPITALS_LABEL: 'capitals-label',
    };

    /**
     * Initialize the MapLibre GL globe.
     */
    async function init() {
        CMapsUtils.setStatus('Initializing globe...');

        map = new maplibregl.Map({
            container: 'map',
            style: {
                version: 8,
                name: 'CMaps Light',
                sources: {
                    'ocean': {
                        type: 'geojson',
                        data: { type: 'FeatureCollection', features: [] }
                    }
                },
                layers: [
                    {
                        id: 'background',
                        type: 'background',
                        paint: {
                            'background-color': '#f1f3f5'
                        }
                    }
                ],
                glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            },
            center: [15, 30],
            zoom: 1.8,
            minZoom: 0.5,
            maxZoom: 15,
            mapProjection: 'globe',
            attributionControl: false,
        });

        // Add attribution
        map.addControl(new maplibregl.AttributionControl({
            compact: true,
            customAttribution: '© Natural Earth | CMaps'
        }), 'bottom-left');

        // Navigation controls
        map.addControl(new maplibregl.NavigationControl({
            visualizePitch: true,
        }), 'bottom-right');

        popup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 12,
        });

        await new Promise((resolve) => map.on('load', resolve));

        // Load all data layers
        await loadLayers();

        // Set up interactions
        setupInteractions();

        // Update bottom bar
        updateBottomBar();
        map.on('move', CMapsUtils.throttle(updateBottomBar, 50));
        map.on('zoom', CMapsUtils.throttle(updateBottomBar, 50));

        // Hide loading overlay
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
        CMapsUtils.setStatus('Loading countries...');
        try {
            // Load countries
            countriesData = await CMapsUtils.api('/api/countries/geojson');
            addCountryLayers(countriesData);

            // Load natural features and new regions/capitals in parallel
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
            addRegionsLayer(regions);
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
     * Add country polygons + borders + hover highlight to map.
     */
    function addCountryLayers(geojson) {
        // Build a color expression from the data
        const colorExpression = buildColorExpression(geojson);

        map.addSource('countries', {
            type: 'geojson',
            data: geojson,
            promoteId: 'id',
        });

        // Country fills
        map.addLayer({
            id: LAYERS.COUNTRY_FILL,
            type: 'fill',
            source: 'countries',
            paint: {
                'fill-color': colorExpression,
                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], 0.85,
                    ['boolean', ['feature-state', 'hover'], false], 0.7,
                    0.55
                ],
            },
        });

        // Country borders
        map.addLayer({
            id: LAYERS.COUNTRY_BORDER,
            type: 'line',
            source: 'countries',
            paint: {
                'line-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], '#6ea8fe',
                    'rgba(255, 255, 255, 0.25)'
                ],
                'line-width': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], 2.5,
                    ['boolean', ['feature-state', 'hover'], false], 1.5,
                    0.6
                ],
            },
        });
    }

    /**
     * Build a match expression for country colors from geojson data.
     */
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
     * Add rivers layer.
     */
    function addRiversLayer(geojson) {
        map.addSource('rivers', { type: 'geojson', data: geojson });
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
    }

    /**
     * Add lakes layer.
     */
    function addLakesLayer(geojson) {
        map.addSource('lakes', { type: 'geojson', data: geojson });
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
    }

    /**
     * Add mountains/elevation symbols.
     */
    function addMountainsLayer(geojson) {
        map.addSource('mountains', { type: 'geojson', data: geojson });
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
    }

    /**
     * Add cities layer with zoom-dependent labels.
     */
    function addCitiesLayer(geojson) {
        map.addSource('cities', { type: 'geojson', data: geojson });

        // City dots
        map.addLayer({
            id: LAYERS.CITIES,
            type: 'circle',
            source: 'cities',
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 2,
                    5, 3,
                    10, 5,
                ],
                'circle-color': [
                    'case',
                    ['get', 'is_capital'], '#ffd700',
                    '#e8e8f0'
                ],
                'circle-stroke-width': 1,
                'circle-stroke-color': 'rgba(0,0,0,0.4)',
                'circle-opacity': 0.9,
            },
        });

        // City labels
        map.addLayer({
            id: LAYERS.CITIES_LABEL,
            type: 'symbol',
            source: 'cities',
            layout: {
                'text-field': ['get', 'name'],
                'text-size': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 9,
                    6, 11,
                    10, 13,
                ],
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-optional': true,
                'text-font': ['Open Sans Regular'],
            },
            paint: {
                'text-color': [
                    'case',
                    ['get', 'is_capital'], '#ffd700',
                    '#c8c8d8'
                ],
                'text-halo-color': 'rgba(10, 10, 15, 0.85)',
                'text-halo-width': 1.5,
            },
        });
    }

    /**
     * Add regions (admin-1) layer.
     */
    function addRegionsLayer(geojson) {
        map.addSource('regions', { type: 'geojson', data: geojson });

        // Region fills (very subtle)
        map.addLayer({
            id: LAYERS.REGIONS_FILL,
            type: 'fill',
            source: 'regions',
            paint: {
                'fill-color': ['get', 'color'],
                'fill-opacity': 0.15,
            },
            minzoom: 3,
        });

        // Region borders (dashed)
        map.addLayer({
            id: LAYERS.REGIONS_BORDER,
            type: 'line',
            source: 'regions',
            paint: {
                'line-color': 'rgba(255, 255, 255, 0.4)',
                'line-width': 0.8,
                'line-dasharray': [3, 3],
            },
            minzoom: 3,
        });
    }

    /**
     * Add capitals layer with custom styling based on hierarchy.
     */
    function addCapitalsLayer(geojson) {
        map.addSource('capitals', { type: 'geojson', data: geojson });

        // Markers for capitals
        map.addLayer({
            id: LAYERS.CAPITALS,
            type: 'circle',
            source: 'capitals',
            paint: {
                'circle-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0, ['case', ['get', 'is_country_capital'], 3, 2],
                    5, ['case', ['get', 'is_country_capital'], 5, 3],
                    10, ['case', ['get', 'is_country_capital'], 8, 4],
                    12, ['case', ['get', 'is_country_capital'], 10, 6]
                ],
                'circle-color': [
                    'case',
                    ['get', 'is_country_capital'], '#ef4444', // Red for country capitals
                    '#f8fafc' // White for regional
                ],
                'circle-stroke-width': [
                    'case',
                    ['get', 'is_country_capital'], 2,
                    1
                ],
                'circle-stroke-color': '#0f172a',
            },
        });

        // Capital labels
        map.addLayer({
            id: LAYERS.CAPITALS_LABEL,
            type: 'symbol',
            source: 'capitals',
            layout: {
                'text-field': ['get', 'name'],
                'text-size': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 10,
                    6, 13,
                    10, 16,
                ],
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-optional': true,
                'text-font': ['Open Sans Bold'],
            },
            paint: {
                'text-color': '#0f172a',
                'text-halo-color': '#ffffff',
                'text-halo-width': 2,
            },
        });
    }

    /**
     * Setup hover and click interactions.
     */
    function setupInteractions() {
        // Hover
        map.on('mousemove', LAYERS.COUNTRY_FILL, (e) => {
            if (e.features.length === 0) return;
            map.getCanvas().style.cursor = 'pointer';

            // Clear previous hover
            if (hoveredCountryId !== null) {
                map.setFeatureState({ source: 'countries', id: hoveredCountryId }, { hover: false });
            }

            hoveredCountryId = e.features[0].id;
            map.setFeatureState({ source: 'countries', id: hoveredCountryId }, { hover: true });

            // Show popup
            const props = e.features[0].properties;
            const popupContent = `
                <div class="country-popup">
                    <div class="country-popup-name">
                        <span>${props.flag_emoji || '🏳️'}</span>
                        <span>${props.name}</span>
                    </div>
                    <div class="country-popup-stats">
                        <div class="country-popup-stat"><span>Population</span><span>${CMapsUtils.formatPopShort(props.population)}</span></div>
                        <div class="country-popup-stat"><span>Area</span><span>${CMapsUtils.formatArea(props.area_km2)}</span></div>
                        ${props.capital ? `<div class="country-popup-stat"><span>Capital</span><span>${props.capital}</span></div>` : ''}
                    </div>
                    <div class="country-popup-hint">Click for details</div>
                </div>
            `;
            popup.setLngLat(e.lngLat).setHTML(popupContent).addTo(map);
        });

        map.on('mouseleave', LAYERS.COUNTRY_FILL, () => {
            map.getCanvas().style.cursor = '';
            if (hoveredCountryId !== null) {
                map.setFeatureState({ source: 'countries', id: hoveredCountryId }, { hover: false });
            }
            hoveredCountryId = null;
            popup.remove();
        });

        // Click
        map.on('click', LAYERS.COUNTRY_FILL, (e) => {
            if (e.features.length === 0) return;
            const feature = e.features[0];
            selectCountry(feature.id || feature.properties.id);
        });

        // Click on empty area → deselect
        map.on('click', (e) => {
            const features = map.queryRenderedFeatures(e.point, { layers: [LAYERS.COUNTRY_FILL] });
            if (features.length === 0) {
                deselectCountry();
            }
        });

        // Zoom change → update cities & capitals
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
                // Silent fail for dynamic point updates
            }
        }, 300));
    }

    /**
     * Select a country by ID.
     */
    function selectCountry(id) {
        // Deselect previous
        if (selectedCountryId !== null) {
            map.setFeatureState({ source: 'countries', id: selectedCountryId }, { selected: false });
        }

        selectedCountryId = id;
        map.setFeatureState({ source: 'countries', id: id }, { selected: true });

        // Find the feature
        const feature = countriesData?.features?.find(f => f.id === id || f.properties?.id === id);
        if (feature) {
            CMapsPanel.showCountry(feature);
        }

        // Enable edit buttons
        document.getElementById('btn-split').disabled = false;
        document.getElementById('btn-delete').disabled = false;
    }

    /**
     * Deselect current country.
     */
    function deselectCountry() {
        if (selectedCountryId !== null) {
            map.setFeatureState({ source: 'countries', id: selectedCountryId }, { selected: false });
            selectedCountryId = null;
        }
        CMapsPanel.hide();
        document.getElementById('btn-split').disabled = true;
        document.getElementById('btn-delete').disabled = true;
        document.getElementById('btn-merge').disabled = true;
    }

    /**
     * Refresh countries layer data from the server.
     */
    async function refreshCountries() {
        try {
            countriesData = await CMapsUtils.api('/api/countries/geojson');
            const source = map.getSource('countries');
            if (source) {
                source.setData(countriesData);
                // Rebuild the color expression
                const colorExpr = buildColorExpression(countriesData);
                map.setPaintProperty(LAYERS.COUNTRY_FILL, 'fill-color', colorExpr);
            }
            const count = countriesData.features?.length || 0;
            document.getElementById('country-count').textContent = `${count} countries`;
        } catch (err) {
            console.error('Failed to refresh countries:', err);
        }
    }

    /**
     * Fly to a location.
     */
    function flyTo(lng, lat, zoom = 5) {
        map.flyTo({
            center: [lng, lat],
            zoom: zoom,
            duration: 1500,
            essential: true,
        });
    }

    /**
     * Toggle a layer's visibility.
     */
    function toggleLayer(layerKey, visible) {
        const layerMap = {
            'countries': [LAYERS.COUNTRY_FILL],
            'borders': [LAYERS.COUNTRY_BORDER],
            'rivers': [LAYERS.RIVERS],
            'lakes': [LAYERS.LAKES],
            'mountains': [LAYERS.MOUNTAINS],
            'cities': [LAYERS.CITIES, LAYERS.CITIES_LABEL],
            'regions': [LAYERS.REGIONS_FILL, LAYERS.REGIONS_BORDER],
            'capitals': [LAYERS.CAPITALS, LAYERS.CAPITALS_LABEL],
        };

        const layers = layerMap[layerKey] || [];
        for (const layerId of layers) {
            if (map.getLayer(layerId)) {
                map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
            }
        }
    }

    /**
     * Update bottom bar with coordinates and zoom.
     */
    function updateBottomBar() {
        if (!map) return;
        const center = map.getCenter();
        const zoom = map.getZoom();
        document.getElementById('coordinates').textContent =
            `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
        document.getElementById('zoom-level').textContent =
            `Zoom: ${zoom.toFixed(1)}`;
    }

    /**
     * Get the raw map instance.
     */
    function getMap() { return map; }
    function getSelectedId() { return selectedCountryId; }
    function getCountriesData() { return countriesData; }

    return {
        init,
        getMap,
        getSelectedId,
        getCountriesData,
        selectCountry,
        deselectCountry,
        refreshCountries,
        flyTo,
        toggleLayer,
        LAYERS,
    };
})();
