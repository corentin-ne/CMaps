/**
 * CMaps — Panels Module
 * Right info panel + modal management. Shows country details, editable fields,
 * and action buttons. Includes delete modal with cascade/unclaim choice.
 */
const CMapsPanel = (() => {
    let currentFeature = null;
    let isEditing = false;

    function init() {
        // Close panel button
        document.getElementById('btn-close-panel')?.addEventListener('click', hide);

        // Save button
        document.getElementById('btn-save')?.addEventListener('click', saveCurrentCountry);

        // Edit border button
        document.getElementById('btn-edit-border')?.addEventListener('click', () => {
            if (currentFeature) CMapsEditor.startEditMode(currentFeature);
        });

        // Split button (panel)
        document.getElementById('btn-split-panel')?.addEventListener('click', () => {
            if (currentFeature) CMapsEditor.startSplitMode(currentFeature);
        });

        // Delete button
        document.getElementById('btn-delete-panel')?.addEventListener('click', () => {
            if (currentFeature) {
                const id = currentFeature.id || currentFeature.properties?.id;
                const name = currentFeature.properties?.name || 'this country';
                openDeleteModal(id, name);
            }
        });

        // Color picker sync
        document.getElementById('color-picker')?.addEventListener('input', (e) => {
            document.getElementById('color-hex').textContent = e.target.value;
        });

        // Flag upload button
        document.getElementById('btn-flag-upload')?.addEventListener('click', () => {
            document.getElementById('flag-upload-input')?.click();
        });

        // Flag file input
        document.getElementById('flag-upload-input')?.addEventListener('change', handleFlagUpload);

        // Close modal buttons
        document.querySelectorAll('.modal-close-btn').forEach(btn => {
            btn.addEventListener('click', () => closeModal(btn.closest('.modal-overlay')));
        });
    }

    /**
     * Display a country in the right info panel.
     */
    function showCountry(feature) {
        currentFeature = feature;
        const p = feature.properties;
        const panel = document.getElementById('info-panel');
        panel.classList.remove('hidden');

        // Flag display — use uploaded image if available, else try iso_code PNG, else emoji
        const flagEl = document.getElementById('country-flag');
        const flagUrl = _resolveFlagUrl(p);
        if (flagUrl) {
            const emoji = (p.flag_emoji || '🏳️').replace(/'/g, "\\'");
            flagEl.innerHTML = `<img src="${flagUrl}" alt="Flag" class="flag-image" onerror="this.parentElement.textContent='${emoji}'" />`;
        } else {
            flagEl.textContent = p.flag_emoji || '🏳️';
        }

        // Name
        document.getElementById('country-name').value = p.name || '';

        // Stats
        document.getElementById('stat-pop').textContent = CMapsUtils.formatNumber(p.population);
        document.getElementById('stat-area').textContent = CMapsUtils.formatArea(p.area_km2);
        document.getElementById('stat-capital').textContent = p.capital || '—';
        document.getElementById('stat-continent').textContent = p.continent || '—';

        // Extended stats
        const gdpEl = document.getElementById('stat-gdp');
        if (gdpEl) gdpEl.textContent = CMapsUtils.formatGDP(p.gdp_md);
        const hdiEl = document.getElementById('stat-hdi');
        if (hdiEl) hdiEl.textContent = p.hdi_index != null ? p.hdi_index.toFixed(3) : '—';
        const litEl = document.getElementById('stat-literacy');
        if (litEl) litEl.textContent = p.literacy_rate != null ? `${p.literacy_rate.toFixed(1)}%` : '—';

        // Color
        document.getElementById('color-picker').value = p.color || '#7c9eb2';
        document.getElementById('color-hex').textContent = p.color || '#7c9eb2';

        // Flag emoji
        document.getElementById('flag-input').value = p.flag_emoji || '🏳️';

        // Flag preview in the flag section
        _updateFlagPreview(p);

        // Load cities/capitals for this country
        loadCountryCities(p.id);

        // Load region and city count stats
        loadCountryStats(p.id);
    }

    /**
     * Resolve the best available flag URL for a country.
     */
    function _resolveFlagUrl(props) {
        if (props.flag_url) return props.flag_url;
        // Try to resolve from iso_code (2-letter) to the local PNG
        // Skip synthetic X-prefix codes — no flag file exists for those
        const iso = (props.iso_code || '').toLowerCase();
        if (iso && iso.length === 2 && iso !== '-99' && !iso.startsWith('x')) {
            return `/static/data/flags/${iso}.png`;
        }
        return null;
    }

    /**
     * Update the flag preview thumbnail in the flag management section.
     */
    function _updateFlagPreview(props) {
        const container = document.getElementById('flag-preview-container');
        if (!container) return;

        const flagUrl = _resolveFlagUrl(props);
        if (flagUrl) {
            container.innerHTML = `
                <img src="${flagUrl}" alt="Flag preview" class="flag-preview-img"
                     onerror="this.parentElement.innerHTML='<span class=\\'flag-preview-emoji\\'>${props.flag_emoji || '🏳️'}</span>'" />
            `;
        } else {
            container.innerHTML = `<span class="flag-preview-emoji">${props.flag_emoji || '🏳️'}</span>`;
        }
    }

    function hide() {
        const panel = document.getElementById('info-panel');
        panel.classList.add('hidden');
        currentFeature = null;
        CMapsGlobe.deselectCountry();
    }

    async function saveCurrentCountry() {
        if (!currentFeature) return;
        const id = currentFeature.id || currentFeature.properties?.id;

        const before = { ...currentFeature };

        const updates = {
            name: document.getElementById('country-name').value,
            color: document.getElementById('color-picker').value,
            flag_emoji: document.getElementById('flag-input').value,
        };

        try {
            CMapsUtils.setStatus('Saving...');
            const result = await CMapsUtils.api(`/api/countries/${id}`, {
                method: 'PUT',
                body: updates,
            });

            CMapsHistory.push('update', { before, after: result });
            await CMapsGlobe.refreshCountries();
            CMapsUtils.toast('Country saved!', 'success');
            CMapsUtils.setStatus('Ready');
        } catch (err) {
            CMapsUtils.toast(`Save failed: ${err.message}`, 'error');
            CMapsUtils.setStatus('Ready');
        }
    }

    async function loadCountryCities(countryId) {
        const container = document.getElementById('cities-list');
        if (!container) return;

        try {
            const data = await CMapsUtils.api(`/api/capitals/by-country/${countryId}`);
            const cities = data.features || [];

            if (cities.length === 0) {
                container.innerHTML = '<div class="empty-state">No cities found</div>';
                return;
            }

            container.innerHTML = cities.map(c => {
                const p = c.properties;
                return `
                    <div class="city-item">
                        <span>${p.is_country_capital ? '★' : '•'} ${p.name}</span>
                        <span>${CMapsUtils.formatPopShort(p.population)}</span>
                    </div>
                `;
            }).join('');
        } catch (err) {
            container.innerHTML = '<div class="empty-state">Failed to load</div>';
        }
    }

    async function loadCountryStats(countryId) {
        // Region count
        const regEl = document.getElementById('stat-regions');
        const cityEl = document.getElementById('stat-cities');

        try {
            const [regions, capitals] = await Promise.all([
                CMapsUtils.api(`/api/regions/by-country/${countryId}`).catch(() => ({ features: [] })),
                CMapsUtils.api(`/api/capitals/by-country/${countryId}`).catch(() => ({ features: [] })),
            ]);

            const regionCount = regions.features?.length || 0;
            const cityCount = capitals.features?.length || 0;

            if (regEl) regEl.textContent = regionCount > 0 ? regionCount : '—';
            if (cityEl) cityEl.textContent = cityCount > 0 ? cityCount : '—';
        } catch (err) {
            if (regEl) regEl.textContent = '—';
            if (cityEl) cityEl.textContent = '—';
        }
    }

    /**
     * Open the delete confirmation modal with cascade/unclaim choice.
     */
    function openDeleteModal(countryId, countryName) {
        const modal = document.getElementById('delete-modal');
        if (!modal) {
            // Fallback to simple confirm
            if (confirm(`Delete "${countryName}"? This cannot be undone.`)) {
                deleteCountry(countryId, 'cascade');
            }
            return;
        }

        modal.querySelector('.delete-country-name').textContent = countryName;
        modal.dataset.countryId = countryId;
        modal.classList.remove('hidden');

        // Bind action buttons
        modal.querySelector('[data-delete-mode="cascade"]')?.addEventListener('click', () => {
            deleteCountry(countryId, 'cascade');
            closeModal(modal);
        }, { once: true });

        modal.querySelector('[data-delete-mode="unclaim"]')?.addEventListener('click', () => {
            deleteCountry(countryId, 'unclaim');
            closeModal(modal);
        }, { once: true });
    }

    async function deleteCountry(countryId, mode) {
        try {
            const feature = currentFeature;
            CMapsUtils.setStatus('Deleting...');
            await CMapsUtils.api(`/api/countries/${countryId}?mode=${mode}`, {
                method: 'DELETE',
            });
            CMapsHistory.push('delete', { before: feature });
            hide();
            await CMapsGlobe.refreshCountries();
            CMapsUtils.toast('Country deleted', 'success');
            CMapsUtils.setStatus('Ready');
        } catch (err) {
            CMapsUtils.toast(`Delete failed: ${err.message}`, 'error');
            CMapsUtils.setStatus('Ready');
        }
    }

    async function handleFlagUpload(e) {
        const file = e.target.files[0];
        if (!file || !currentFeature) return;

        const id = currentFeature.id || currentFeature.properties?.id;
        const formData = new FormData();
        formData.append('file', file);

        try {
            CMapsUtils.setStatus('Uploading flag...');
            const res = await fetch(`/api/flags/${id}`, {
                method: 'POST',
                body: formData,
            });
            if (!res.ok) throw new Error('Upload failed');
            const result = await res.json();

            // Update flag_url on current feature props
            currentFeature.properties.flag_url = result.flag_url;

            // Update header flag display
            const flagEl = document.getElementById('country-flag');
            flagEl.innerHTML = `<img src="${result.flag_url}" alt="Flag" class="flag-image" />`;

            // Update flag preview in the management section
            _updateFlagPreview(currentFeature.properties);

            await CMapsGlobe.refreshCountries();
            CMapsUtils.toast('Flag uploaded!', 'success');
            CMapsUtils.setStatus('Ready');
        } catch (err) {
            CMapsUtils.toast(`Flag upload failed: ${err.message}`, 'error');
            CMapsUtils.setStatus('Ready');
        }
    }

    function openModal(selector) {
        const modal = document.querySelector(selector);
        if (modal) modal.classList.remove('hidden');
    }

    function closeModal(el) {
        if (typeof el === 'string') {
            el = document.querySelector(el);
        }
        if (el) el.classList.add('hidden');
    }

    function getCurrentFeature() { return currentFeature; }

    return { init, showCountry, hide, openModal, closeModal, getCurrentFeature, openDeleteModal };
})();
