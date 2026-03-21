/**
 * CMaps — Panels Module
 * Manages the right info panel and modal dialogs.
 */
const CMapsPanel = (() => {
    let currentFeature = null;

    function init() {
        // Panel close button
        document.getElementById('panel-close').addEventListener('click', hide);

        // Save country changes
        document.getElementById('btn-save-country').addEventListener('click', saveCountryChanges);

        // Edit borders button
        document.getElementById('btn-edit-borders').addEventListener('click', () => {
            if (currentFeature) {
                CMapsEditor.startEditMode(currentFeature);
            }
        });

        // Split button (panel)
        document.getElementById('btn-split-country').addEventListener('click', () => {
            if (currentFeature) {
                CMapsEditor.startSplitMode(currentFeature);
            }
        });

        // Delete button (panel)
        document.getElementById('btn-delete-country').addEventListener('click', () => {
            if (currentFeature) deleteCountry(currentFeature);
        });

        // Color picker live update
        document.getElementById('country-color').addEventListener('input', (e) => {
            document.getElementById('color-hex').textContent = e.target.value;
        });

        // Population edit toggle
        const popStat = document.getElementById('stat-population');
        const popEdit = document.getElementById('edit-population');
        popStat.addEventListener('click', () => {
            popStat.classList.add('hidden');
            popEdit.classList.remove('hidden');
            popEdit.focus();
        });
        popEdit.addEventListener('blur', () => {
            popStat.classList.remove('hidden');
            popEdit.classList.add('hidden');
            popStat.textContent = CMapsUtils.formatNumber(popEdit.value);
        });

        // Capital edit toggle
        const capStat = document.getElementById('stat-capital');
        const capEdit = document.getElementById('edit-capital');
        capStat.addEventListener('click', () => {
            capStat.classList.add('hidden');
            capEdit.classList.remove('hidden');
            capEdit.focus();
        });
        capEdit.addEventListener('blur', () => {
            capStat.classList.remove('hidden');
            capEdit.classList.add('hidden');
            capStat.textContent = capEdit.value || '—';
        });

        // Modal close buttons
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', closeModal);
        });

        // Clicking overlay closes modal
        document.getElementById('modal-overlay').addEventListener('click', (e) => {
            if (e.target.id === 'modal-overlay') closeModal();
        });
    }

    /**
     * Show country info in the right panel.
     */
    function showCountry(feature) {
        currentFeature = feature;
        const panel = document.getElementById('info-panel');
        const props = feature.properties || {};

        // Fill in data
        document.getElementById('country-flag').textContent = props.flag_emoji || '🏳️';
        document.getElementById('country-name-input').value = props.name || 'Unknown';
        document.getElementById('stat-population').textContent = CMapsUtils.formatNumber(props.population);
        document.getElementById('edit-population').value = props.population || 0;
        document.getElementById('stat-area').textContent = CMapsUtils.formatArea(props.area_km2);
        document.getElementById('stat-capital').textContent = props.capital_name || '—';
        document.getElementById('edit-capital').value = props.capital_name || '';
        document.getElementById('stat-continent').textContent = props.continent || '—';
        document.getElementById('country-color').value = props.color || '#7c9eb2';
        document.getElementById('color-hex').textContent = props.color || '#7c9eb2';
        document.getElementById('country-flag-input').value = props.flag_emoji || '🏳️';

        // Show panel
        panel.classList.remove('hidden');

        // Load regions and cities
        loadSubdivisionsForCountry({ ...props, id: feature.id || feature.properties?.id });
    }

    /**
     * Load regions and cities that belong to the selected country.
     */
    async function loadSubdivisionsForCountry(props) {
        const list = document.getElementById('cities-list');
        list.innerHTML = '<div class="empty-state">Loading...</div>';

        try {
            const countryId = props.id || currentFeature?.id;
            const [regions, allCities] = await Promise.all([
                CMapsUtils.api(`/api/regions/by-country/${countryId}`).catch(() => ({ features: [] })),
                CMapsUtils.api(`/api/cities?zoom=12`).catch(() => ({ features: [] }))
            ]);

            const countryName = props.name;

            // Filter cities by country name
            const countryCities = allCities.features
                .filter(f => f.properties.country === countryName)
                .sort((a, b) => (b.properties.pop_max || 0) - (a.properties.pop_max || 0))
                .slice(0, 20);

            let html = '';

            // Regions
            if (regions.features && regions.features.length > 0) {
                html += `<div class="popup-subtitle" style="margin-bottom: 8px;">Regions (${regions.features.length})</div>`;
                html += regions.features.map(reg => {
                    const rp = reg.properties;
                    return `
                        <div class="item-row region-item" data-id="${rp.id}">
                            <div class="item-main">
                                <span class="item-name">${rp.name}</span>
                                <span class="item-sub">${rp.region_type || 'Region'}</span>
                            </div>
                        </div>
                    `;
                }).join('');
                html += `<div style="height: 16px;"></div>`;
            }

            // Cities
            html += `<div class="popup-subtitle" style="margin-bottom: 8px;">Cities (${countryCities.length})</div>`;
            if (countryCities.length > 0) {
                html += countryCities.map(city => {
                    const cp = city.properties;
                    return `
                        <div class="item-row city-item" data-lng="${cp.longitude}" data-lat="${cp.latitude}">
                            <div class="item-main">
                                <span class="item-name">
                                    ${cp.name} ${cp.is_capital ? ' <span style="color:var(--accent);">★</span>' : ''}
                                </span>
                                <span class="item-sub">${CMapsUtils.formatPopShort(cp.pop_max)}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                html += '<div class="empty-state">No cities found</div>';
            }

            list.innerHTML = html;

            // Click Handlers
            list.querySelectorAll('.city-item').forEach(item => {
                item.addEventListener('click', () => {
                    const lng = parseFloat(item.dataset.lng);
                    const lat = parseFloat(item.dataset.lat);
                    CMapsGlobe.flyTo(lng, lat, 8);
                });
            });

            list.querySelectorAll('.region-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const regionId = item.dataset.id;
                    try {
                        const regionFeature = await CMapsUtils.api(`/api/regions/${regionId}`);
                        if (regionFeature.geometry && regionFeature.geometry.type === "Polygon" || regionFeature.geometry.type === "MultiPolygon") {
                            // Calculate center to fly to (using turf or simplest bounds)
                            const center = turf.centerOfMass(regionFeature).geometry.coordinates;
                            CMapsGlobe.flyTo(center[0], center[1], 5);
                        }
                    } catch (e) {
                         console.error("Could not find region geometry", e);
                    }
                });
            });

        } catch (err) {
            list.innerHTML = '<div class="empty-state">Failed to load details</div>';
        }
    }

    /**
     * Hide the info panel.
     */
    function hide() {
        document.getElementById('info-panel').classList.add('hidden');
        currentFeature = null;
    }

    /**
     * Save country property changes via API.
     */
    async function saveCountryChanges() {
        if (!currentFeature) return;

        const id = currentFeature.properties?.id || currentFeature.id;
        const updates = {
            name: document.getElementById('country-name-input').value,
            population: parseInt(document.getElementById('edit-population').value) || 0,
            capital_name: document.getElementById('edit-capital').value || null,
            color: document.getElementById('country-color').value,
            flag_emoji: document.getElementById('country-flag-input').value || '🏳️',
        };

        try {
            CMapsUtils.setStatus('Saving changes...');
            const result = await CMapsUtils.api(`/api/countries/${id}`, {
                method: 'PUT',
                body: updates,
            });

            // Record for undo
            CMapsHistory.push('update', { before: currentFeature, after: result });

            await CMapsGlobe.refreshCountries();
            CMapsUtils.toast('Country updated', 'success');
            CMapsUtils.setStatus('Ready');

            // Update panel with fresh data
            showCountry(result);
        } catch (err) {
            CMapsUtils.toast(`Failed to save: ${err.message}`, 'error');
            CMapsUtils.setStatus('Error saving');
        }
    }

    /**
     * Delete a country.
     */
    async function deleteCountry(feature) {
        const id = feature.properties?.id || feature.id;
        const name = feature.properties?.name || 'this country';

        if (!confirm(`Delete "${name}"? This action can be undone.`)) return;

        try {
            CMapsUtils.setStatus('Deleting country...');
            await CMapsUtils.api(`/api/countries/${id}`, { method: 'DELETE' });

            CMapsHistory.push('delete', { before: feature });

            CMapsGlobe.deselectCountry();
            await CMapsGlobe.refreshCountries();
            CMapsUtils.toast(`"${name}" deleted`, 'success');
            CMapsUtils.setStatus('Ready');
        } catch (err) {
            CMapsUtils.toast(`Failed to delete: ${err.message}`, 'error');
        }
    }

    // ═══ Modal Management ═══

    function openModal(modalId) {
        const overlay = document.getElementById('modal-overlay');
        // Hide all modals first
        overlay.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
        // Show target
        document.getElementById(modalId).classList.remove('hidden');
        overlay.classList.remove('hidden');
    }

    function closeModal() {
        document.getElementById('modal-overlay').classList.add('hidden');
    }

    function getCurrentFeature() { return currentFeature; }

    return {
        init,
        showCountry,
        hide,
        openModal,
        closeModal,
        getCurrentFeature,
    };
})();
