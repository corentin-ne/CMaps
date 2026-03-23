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

        // Save button — uses unique panel ID (not top-bar btn-save)
        document.getElementById('btn-save-country')?.addEventListener('click', saveCurrentCountry);

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

        // Close modal buttons — both .modal-close and .modal-close-btn
        document.querySelectorAll('.modal-close, .modal-close-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const overlay = btn.closest('.modal-overlay');
                if (overlay) {
                    closeModal(overlay);
                } else {
                    closeModal('modal-overlay');
                }
            });
        });

        // ── Mobile: swipe-down-to-dismiss on bottom sheet ──
        if (CMapsUtils.isTouchDevice()) {
            _initSwipeToDismiss();
        }
    }

    /** Set up swipe-down gesture on the panel drag handle for mobile */
    function _initSwipeToDismiss() {
        const panel = document.getElementById('info-panel');
        const handle = document.getElementById('panel-swipe-handle');
        if (!panel || !handle) return;

        let startY = 0;
        let currentY = 0;
        let dragging = false;

        handle.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
            currentY = startY;
            dragging = true;
            panel.style.transition = 'none';
        }, { passive: true });

        handle.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            currentY = e.touches[0].clientY;
            const dy = Math.max(0, currentY - startY);
            panel.style.transform = `translateY(${dy}px)`;
        }, { passive: true });

        handle.addEventListener('touchend', () => {
            if (!dragging) return;
            dragging = false;
            panel.style.transition = '';
            const dy = currentY - startY;
            if (dy > 80) {
                // Swiped far enough → dismiss
                hide();
                panel.style.transform = '';
            } else {
                // Snap back
                panel.style.transform = '';
            }
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

        // Load cities/capitals for this country + stats in one pass
        loadCountryCities(p.id);
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

        // On touch devices, closing the panel should NOT deselect the country.
        // Re-show the info FAB so the user can re-open details.
        if (CMapsUtils.isTouchDevice()) {
            const selectedId = CMapsGlobe.getSelectedId();
            if (selectedId) CMapsGlobe.showInfoFab(selectedId);
        } else {
            CMapsGlobe.deselectCountry();
        }
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

            // Update local feature with new data
            currentFeature = result;

            await CMapsGlobe.refreshCountries();
            CMapsUtils.toast('Changes saved successfully!', 'success');
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

            // Update city count stat from the same response (avoids duplicate fetch)
            const cityCountEl = document.getElementById('stat-cities');
            if (cityCountEl) cityCountEl.textContent = cities.length > 0 ? cities.length : '—';

            // Fetch region count separately (cheap, single query)
            CMapsUtils.api(`/api/regions/by-country/${countryId}`).then(r => {
                const regEl = document.getElementById('stat-regions');
                if (regEl) regEl.textContent = (r.features?.length || 0) > 0 ? r.features.length : '—';
            }).catch(() => {});

            container.innerHTML = cities.map(c => {
                const p = c.properties;
                const icon = p.is_country_capital ? '★' : (p.is_regional_capital ? '◆' : '•');
                const badge = p.is_country_capital
                    ? '<span class="city-badge capital">Capital</span>'
                    : (p.is_regional_capital ? '<span class="city-badge regional">Regional</span>' : '');
                return `
                    <div class="city-item" data-city-id="${p.id}">
                        <div class="city-info">
                            <span class="city-icon">${icon}</span>
                            <span class="city-name">${p.name}</span>
                            ${badge}
                        </div>
                        <div class="city-actions">
                            <span class="city-pop">${CMapsUtils.formatPopShort(p.population)}</span>
                            <div class="city-capital-menu">
                                <button class="btn-city-action" title="Set capital type" data-city-id="${p.id}">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                                </button>
                                <div class="city-dropdown hidden">
                                    <div class="city-dropdown-item" data-type="country">★ Country Capital</div>
                                    <div class="city-dropdown-item" data-type="regional">◆ Regional Capital</div>
                                    <div class="city-dropdown-item" data-type="none">• Regular City</div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            // Bind capital toggle menus
            container.querySelectorAll('.btn-city-action').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Close other open dropdowns
                    container.querySelectorAll('.city-dropdown').forEach(d => d.classList.add('hidden'));
                    const dropdown = btn.parentElement.querySelector('.city-dropdown');
                    dropdown.classList.toggle('hidden');
                });
            });

            container.querySelectorAll('.city-dropdown-item').forEach(item => {
                item.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const cityItem = item.closest('.city-item');
                    const cityId = cityItem.dataset.cityId;
                    const type = item.dataset.type;
                    try {
                        await CMapsUtils.api(`/api/capitals/${cityId}/toggle-capital`, {
                            method: 'PUT',
                            body: { type },
                        });
                        CMapsUtils.toast(`City updated to ${type === 'country' ? 'country capital' : type === 'regional' ? 'regional capital' : 'regular city'}`, 'success');
                        // Refresh cities list and capitals on map
                        loadCountryCities(countryId);
                        CMapsGlobe.refreshCountries();
                    } catch (err) {
                        CMapsUtils.toast(`Failed: ${err.message}`, 'error');
                    }
                });
            });

            // Close dropdowns when clicking outside
            document.addEventListener('click', () => {
                container.querySelectorAll('.city-dropdown').forEach(d => d.classList.add('hidden'));
            }, { once: true });

        } catch (err) {
            container.innerHTML = '<div class="empty-state">Failed to load</div>';
        }
    }

    // loadCountryStats removed — stats are now derived inline in loadCountryCities
    // to avoid a duplicate /api/capitals/by-country/ fetch

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
        // Accept bare ID strings or CSS selectors
        const modal = selector.startsWith('#') || selector.startsWith('.')
            ? document.querySelector(selector)
            : document.getElementById(selector);
        if (!modal) return;

        // If modal is inside the main overlay, show the overlay and hide siblings
        const mainOverlay = document.getElementById('modal-overlay');
        if (mainOverlay && mainOverlay.contains(modal)) {
            mainOverlay.classList.remove('hidden');
            // Hide all inner modals first, then show the target
            mainOverlay.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
            modal.classList.remove('hidden');
        } else {
            // Standalone overlay (e.g. delete-modal)
            modal.classList.remove('hidden');
        }
    }

    function closeModal(el) {
        if (typeof el === 'string') {
            el = el.startsWith('#') || el.startsWith('.')
                ? document.querySelector(el)
                : document.getElementById(el);
        }
        if (!el) return;

        // If it's the main overlay or contains .modal, hide the overlay
        if (el.classList.contains('modal-overlay')) {
            el.classList.add('hidden');
        } else {
            // Try to find and hide the parent overlay
            const overlay = el.closest('.modal-overlay');
            if (overlay) overlay.classList.add('hidden');
            el.classList.add('hidden');
        }
    }

    function getCurrentFeature() { return currentFeature; }

    return { init, showCountry, hide, openModal, closeModal, getCurrentFeature, openDeleteModal };
})();
