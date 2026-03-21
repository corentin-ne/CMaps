/**
 * CMaps — Editor Module
 * Integrates Terra Draw for drawing and editing country borders.
 */
const CMapsEditor = (() => {
    let draw = null;
    let currentTool = 'select';
    let pendingGeometry = null;
    let splitSourceFeature = null;
    let mergeSelection = []; // Array of selected country features for merge

    function init() {
        // Tool button clicks
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => setTool(btn.dataset.tool));
        });

        // Toolbar action buttons
        document.getElementById('btn-merge').addEventListener('click', openMergeDialog);
        document.getElementById('btn-split').addEventListener('click', () => {
            const feature = CMapsPanel.getCurrentFeature();
            if (feature) startSplitMode(feature);
        });
        document.getElementById('btn-delete').addEventListener('click', () => {
            const feature = CMapsPanel.getCurrentFeature();
            if (feature) {
                const id = feature.properties?.id || feature.id;
                const name = feature.properties?.name || 'this country';
                if (confirm(`Delete "${name}"?`)) {
                    deleteCountry(id, feature);
                }
            }
        });

        // New country dialog
        document.getElementById('btn-confirm-create').addEventListener('click', confirmCreateCountry);

        // Split dialog
        document.getElementById('btn-confirm-split').addEventListener('click', confirmSplit);

        // Merge dialog
        document.getElementById('btn-confirm-merge').addEventListener('click', confirmMerge);

        // Init Terra Draw after map loads
        initTerraDraw();
    }

    /**
     * Initialize Terra Draw with the MapLibre adapter.
     */
    function initTerraDraw() {
        const map = CMapsGlobe.getMap();
        if (!map) {
            setTimeout(initTerraDraw, 500);
            return;
        }

        try {
            // Check if Terra Draw classes are available
            if (typeof TerraDraw === 'undefined' && typeof window.TerraDraw === 'undefined') {
                console.warn('Terra Draw not loaded, using fallback drawing');
                initFallbackDrawing();
                return;
            }

            const TD = window.TerraDraw || TerraDraw;
            const TDAdapter = window.TerraDrawMapLibreGLAdapter || TerraDrawMapLibreGLAdapter;

            draw = new TD.TerraDraw({
                adapter: new TDAdapter.TerraDrawMapLibreGLAdapter({ map, lib: maplibregl }),
                modes: [
                    new TD.TerraDrawPolygonMode({
                        styling: {
                            polygonFillColor: '#6ea8fe',
                            polygonFillOpacity: 0.3,
                            polygonOutlineColor: '#6ea8fe',
                            polygonOutlineWidth: 2,
                        },
                    }),
                    new TD.TerraDrawLineStringMode({
                        styling: {
                            lineStringColor: '#f87171',
                            lineStringWidth: 3,
                        },
                    }),
                    new TD.TerraDrawFreehandMode({
                        styling: {
                            polygonFillColor: '#6ea8fe',
                            polygonFillOpacity: 0.3,
                            polygonOutlineColor: '#6ea8fe',
                            polygonOutlineWidth: 2,
                        },
                    }),
                    new TD.TerraDrawSelectMode({
                        flags: {
                            polygon: {
                                feature: {
                                    draggable: true,
                                    rotateable: true,
                                    scaleable: true,
                                    coordinates: {
                                        midpoints: true,
                                        draggable: true,
                                        deletable: true,
                                    },
                                },
                            },
                            linestring: {
                                feature: {
                                    draggable: true,
                                    coordinates: {
                                        midpoints: true,
                                        draggable: true,
                                        deletable: true,
                                    },
                                },
                            },
                        },
                    }),
                    new TD.TerraDrawRenderMode({ modeName: 'default' }),
                ],
            });

            draw.start();
            draw.setMode('default');

            // Listen for drawing completion
            draw.on('finish', (id) => onDrawFinish(id));

        } catch (error) {
            console.warn('Terra Draw init failed, using fallback:', error);
            initFallbackDrawing();
        }
    }

    /**
     * Fallback drawing using GeoJSON and map click events.
     */
    function initFallbackDrawing() {
        const map = CMapsGlobe.getMap();

        // Add a source for drawn features
        if (!map.getSource('draw-source')) {
            map.addSource('draw-source', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });

            map.addLayer({
                id: 'draw-polygon-fill',
                type: 'fill',
                source: 'draw-source',
                filter: ['==', '$type', 'Polygon'],
                paint: {
                    'fill-color': '#6ea8fe',
                    'fill-opacity': 0.3,
                }
            });

            map.addLayer({
                id: 'draw-polygon-line',
                type: 'line',
                source: 'draw-source',
                filter: ['==', '$type', 'Polygon'],
                paint: {
                    'line-color': '#6ea8fe',
                    'line-width': 2,
                }
            });

            map.addLayer({
                id: 'draw-line',
                type: 'line',
                source: 'draw-source',
                filter: ['==', '$type', 'LineString'],
                paint: {
                    'line-color': '#f87171',
                    'line-width': 3,
                    'line-dasharray': [3, 2],
                }
            });

            map.addLayer({
                id: 'draw-points',
                type: 'circle',
                source: 'draw-source',
                filter: ['==', '$type', 'Point'],
                paint: {
                    'circle-radius': 5,
                    'circle-color': '#6ea8fe',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#fff',
                }
            });
        }

        // Store drawing state
        window._drawState = {
            active: false,
            mode: null, // 'polygon' or 'line'
            points: [],
        };

        map.on('click', (e) => {
            const state = window._drawState;
            if (!state.active) return;

            state.points.push([e.lngLat.lng, e.lngLat.lat]);
            updateDrawPreview();
        });

        map.on('dblclick', (e) => {
            const state = window._drawState;
            if (!state.active || state.points.length < 2) return;

            e.preventDefault();
            finishFallbackDraw();
        });

        map.on('contextmenu', (e) => {
            const state = window._drawState;
            if (!state.active) return;
            e.preventDefault();
            if (state.points.length >= 3) {
                finishFallbackDraw();
            } else {
                cancelDraw();
            }
        });
    }

    function updateDrawPreview() {
        const state = window._drawState;
        const map = CMapsGlobe.getMap();
        const source = map.getSource('draw-source');
        if (!source) return;

        const features = [];
        if (state.points.length >= 1) {
            // Show points
            for (const pt of state.points) {
                features.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: pt },
                    properties: {},
                });
            }

            if (state.points.length >= 2) {
                if (state.mode === 'line') {
                    features.push({
                        type: 'Feature',
                        geometry: { type: 'LineString', coordinates: state.points },
                        properties: {},
                    });
                } else if (state.mode === 'polygon' && state.points.length >= 3) {
                    const ring = [...state.points, state.points[0]];
                    features.push({
                        type: 'Feature',
                        geometry: { type: 'Polygon', coordinates: [ring] },
                        properties: {},
                    });
                }
            }
        }

        source.setData({ type: 'FeatureCollection', features });
    }

    function finishFallbackDraw() {
        const state = window._drawState;
        if (!state.active) return;

        let geometry;
        if (state.mode === 'polygon' && state.points.length >= 3) {
            const ring = [...state.points, state.points[0]];
            geometry = { type: 'Polygon', coordinates: [ring] };
        } else if (state.mode === 'line' && state.points.length >= 2) {
            geometry = { type: 'LineString', coordinates: state.points };
        }

        if (geometry) {
            pendingGeometry = geometry;
            if (state.mode === 'polygon') {
                // Open new country dialog
                document.getElementById('new-country-color').value = CMapsUtils.randomColor();
                CMapsPanel.openModal('modal-new-country');
            } else if (state.mode === 'line' && splitSourceFeature) {
                // Open split dialog
                const name = splitSourceFeature.properties?.name || 'Country';
                document.getElementById('split-name-1').value = `${name} (West)`;
                document.getElementById('split-name-2').value = `${name} (East)`;
                CMapsPanel.openModal('modal-split-country');
            }
        }

        // Reset drawing state
        state.active = false;
        state.points = [];
        CMapsUtils.setStatus('Ready');
        setTool('select');
    }

    function cancelDraw() {
        const state = window._drawState;
        state.active = false;
        state.points = [];
        const map = CMapsGlobe.getMap();
        const source = map.getSource('draw-source');
        if (source) source.setData({ type: 'FeatureCollection', features: [] });
        CMapsUtils.setStatus('Drawing cancelled');
        setTool('select');
    }

    /**
     * Set the active drawing tool.
     */
    function setTool(tool) {
        currentTool = tool;

        // Update UI
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });

        const map = CMapsGlobe.getMap();

        // Handle draw modes
        if (draw) {
            // Terra Draw is available
            switch (tool) {
                case 'select':
                    draw.setMode('default');
                    break;
                case 'polygon':
                    draw.setMode('polygon');
                    CMapsUtils.setStatus('Click to place points. Double-click to finish polygon.');
                    break;
                case 'line':
                    draw.setMode('linestring');
                    CMapsUtils.setStatus('Click to place points. Double-click to finish line.');
                    break;
                case 'freehand':
                    draw.setMode('freehand');
                    CMapsUtils.setStatus('Click and drag to draw freehand.');
                    break;
                case 'edit':
                    draw.setMode('select');
                    CMapsUtils.setStatus('Click a drawn feature to edit it.');
                    break;
            }
        } else if (window._drawState) {
            // Fallback drawing
            const state = window._drawState;
            switch (tool) {
                case 'select':
                    state.active = false;
                    state.points = [];
                    const source = map.getSource('draw-source');
                    if (source) source.setData({ type: 'FeatureCollection', features: [] });
                    CMapsUtils.setStatus('Ready');
                    break;
                case 'polygon':
                    state.active = true;
                    state.mode = 'polygon';
                    state.points = [];
                    CMapsUtils.setStatus('Click to place points. Double-click or right-click to finish polygon.');
                    break;
                case 'line':
                    state.active = true;
                    state.mode = 'line';
                    state.points = [];
                    CMapsUtils.setStatus('Click to place points. Double-click or right-click to finish line.');
                    break;
                case 'freehand':
                    state.active = true;
                    state.mode = 'polygon';
                    state.points = [];
                    CMapsUtils.setStatus('Click to place points. Double-click to finish.');
                    break;
            }
        }
    }

    /**
     * Called when Terra Draw finishes a shape.
     */
    function onDrawFinish(id) {
        if (!draw) return;

        const snapshot = draw.getSnapshot();
        const feature = snapshot.find(f => f.id === id);
        if (!feature) return;

        const geometry = feature.geometry;
        pendingGeometry = geometry;

        if (geometry.type === 'Polygon') {
            // Open create country dialog
            document.getElementById('new-country-color').value = CMapsUtils.randomColor();
            CMapsPanel.openModal('modal-new-country');
        } else if (geometry.type === 'LineString' && splitSourceFeature) {
            // Open split dialog
            const name = splitSourceFeature.properties?.name || 'Country';
            document.getElementById('split-name-1').value = `${name} (West)`;
            document.getElementById('split-name-2').value = `${name} (East)`;
            CMapsPanel.openModal('modal-split-country');
        }

        // Clear drawn features
        try { draw.removeFeatures([id]); } catch (e) { /* ignore */ }
    }

    /**
     * Confirm creating a new country from the dialog.
     */
    async function confirmCreateCountry() {
        if (!pendingGeometry) return;

        const name = document.getElementById('new-country-name').value.trim();
        if (!name) {
            CMapsUtils.toast('Please enter a country name', 'error');
            return;
        }

        const data = {
            name: name,
            geometry: pendingGeometry,
            population: parseInt(document.getElementById('new-country-population').value) || 0,
            capital: document.getElementById('new-country-capital').value || null,
            flag_emoji: document.getElementById('new-country-flag').value || '🏳️',
            color: document.getElementById('new-country-color').value,
        };

        try {
            CMapsUtils.setStatus('Creating country...');
            const result = await CMapsUtils.api('/api/countries', {
                method: 'POST',
                body: data,
            });

            CMapsHistory.push('create', { after: result });

            await CMapsGlobe.refreshCountries();
            CMapsPanel.closeModal();
            pendingGeometry = null;

            // Clear fallback drawing
            const source = CMapsGlobe.getMap().getSource('draw-source');
            if (source) source.setData({ type: 'FeatureCollection', features: [] });

            // Clear form
            document.getElementById('new-country-name').value = '';
            document.getElementById('new-country-capital').value = '';
            document.getElementById('new-country-population').value = '';
            document.getElementById('new-country-flag').value = '';

            CMapsUtils.toast(`"${name}" created!`, 'success');
            CMapsUtils.setStatus('Ready');
            setTool('select');

        } catch (err) {
            CMapsUtils.toast(`Failed to create: ${err.message}`, 'error');
        }
    }

    // ═══ Split ═══

    function startSplitMode(feature) {
        splitSourceFeature = feature;
        setTool('line');
        CMapsUtils.toast('Draw a line across the country to split it', 'info');
    }

    async function confirmSplit() {
        if (!splitSourceFeature || !pendingGeometry) return;

        const id = splitSourceFeature.properties?.id || splitSourceFeature.id;
        const names = [
            document.getElementById('split-name-1').value.trim(),
            document.getElementById('split-name-2').value.trim(),
        ].filter(n => n);

        try {
            CMapsUtils.setStatus('Splitting country...');
            const result = await CMapsUtils.api(`/api/countries/${id}/split`, {
                method: 'POST',
                body: {
                    line: pendingGeometry,
                    names: names,
                },
            });

            CMapsHistory.push('split', { before: splitSourceFeature, after: result.parts });

            CMapsGlobe.deselectCountry();
            await CMapsGlobe.refreshCountries();
            CMapsPanel.closeModal();
            pendingGeometry = null;
            splitSourceFeature = null;

            // Clear fallback drawing
            const source = CMapsGlobe.getMap().getSource('draw-source');
            if (source) source.setData({ type: 'FeatureCollection', features: [] });

            CMapsUtils.toast('Country split successfully!', 'success');
            CMapsUtils.setStatus('Ready');
            setTool('select');

        } catch (err) {
            CMapsUtils.toast(`Split failed: ${err.message}`, 'error');
        }
    }

    // ═══ Merge ═══

    function toggleMergeSelect(countryId, feature) {
        const idx = mergeSelection.findIndex(f => (f.properties?.id || f.id) === countryId);
        if (idx >= 0) {
            mergeSelection.splice(idx, 1);
        } else {
            mergeSelection.push(feature);
        }

        // Enable merge button when 2+ selected
        document.getElementById('btn-merge').disabled = mergeSelection.length < 2;

        if (mergeSelection.length > 0) {
            CMapsUtils.setStatus(`${mergeSelection.length} countries selected for merge`);
        }
    }

    function openMergeDialog() {
        if (mergeSelection.length < 2) {
            CMapsUtils.toast('Select at least 2 countries to merge (Ctrl+Click)', 'info');
            return;
        }

        // Populate dialog
        document.getElementById('merge-count').textContent = mergeSelection.length;
        const list = document.getElementById('merge-list');
        list.innerHTML = mergeSelection.map(f => {
            const props = f.properties || {};
            return `
                <div class="merge-item">
                    <span class="merge-item-color" style="background:${props.color || '#4a5568'}"></span>
                    <span>${props.flag_emoji || '🏳️'} ${props.name || 'Unknown'}</span>
                </div>
            `;
        }).join('');

        document.getElementById('merge-new-name').value = mergeSelection[0]?.properties?.name || '';
        CMapsPanel.openModal('modal-merge-countries');
    }

    async function confirmMerge() {
        if (mergeSelection.length < 2) return;

        const newName = document.getElementById('merge-new-name').value.trim();
        if (!newName) {
            CMapsUtils.toast('Please enter a name for the merged country', 'error');
            return;
        }

        const ids = mergeSelection.map(f => f.properties?.id || f.id);

        try {
            CMapsUtils.setStatus('Merging countries...');
            const result = await CMapsUtils.api('/api/countries/merge', {
                method: 'POST',
                body: {
                    country_ids: ids,
                    new_name: newName,
                },
            });

            CMapsHistory.push('merge', { before: mergeSelection, after: result });

            mergeSelection = [];
            CMapsGlobe.deselectCountry();
            await CMapsGlobe.refreshCountries();
            CMapsPanel.closeModal();
            document.getElementById('btn-merge').disabled = true;

            CMapsUtils.toast(`Countries merged into "${newName}"!`, 'success');
            CMapsUtils.setStatus('Ready');

        } catch (err) {
            CMapsUtils.toast(`Merge failed: ${err.message}`, 'error');
        }
    }

    // ═══ Edit Borders ═══

    function startEditMode(feature) {
        CMapsUtils.toast('Border editing: Use the drawing tools to modify borders', 'info');
        setTool('edit');
    }

    // ═══ Delete ═══

    async function deleteCountry(id, feature) {
        try {
            CMapsUtils.setStatus('Deleting...');
            await CMapsUtils.api(`/api/countries/${id}`, { method: 'DELETE' });
            CMapsHistory.push('delete', { before: feature });
            CMapsGlobe.deselectCountry();
            await CMapsGlobe.refreshCountries();
            CMapsUtils.toast('Country deleted', 'success');
            CMapsUtils.setStatus('Ready');
        } catch (err) {
            CMapsUtils.toast(`Delete failed: ${err.message}`, 'error');
        }
    }

    function getMergeSelection() { return mergeSelection; }
    function clearMergeSelection() {
        mergeSelection = [];
        document.getElementById('btn-merge').disabled = true;
    }

    return {
        init,
        setTool,
        startSplitMode,
        startEditMode,
        toggleMergeSelect,
        getMergeSelection,
        clearMergeSelection,
    };
})();
