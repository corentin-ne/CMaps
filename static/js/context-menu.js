/**
 * CMaps — Context Menu Module
 * Minimalistic right-click menu on the 3D map for quick actions.
 */
const CMapsContextMenu = (() => {
    let menuEl = null;
    let currentFeature = null;
    let currentLngLat = null;

    function init() {
        menuEl = document.getElementById('context-menu');
        if (!menuEl) return;

        // Listen for map context menu events from globe module
        window.addEventListener('cmaps:contextmenu', (e) => {
            show(e.detail);
        });

        // Close on any click
        document.addEventListener('click', () => hide());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hide();
        });

        // Bind menu item actions
        menuEl.querySelectorAll('[data-action]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                handleAction(action);
                hide();
            });
        });
    }

    function show(detail) {
        if (!menuEl) return;

        currentFeature = detail.feature;
        currentLngLat = detail.lngLat;

        // Prevent default browser context menu
        if (detail.originalEvent) {
            detail.originalEvent.preventDefault();
        }

        // Enable/disable items based on whether a feature was clicked
        const featureItems = menuEl.querySelectorAll('[data-requires-feature]');
        featureItems.forEach(item => {
            item.classList.toggle('disabled', !currentFeature);
        });

        // Region-specific items: only show when the feature comes from a region layer
        // Region features have country_id property and come from the regions-fill layer
        const isRegionFeature = currentFeature &&
            (currentFeature.layer?.id?.includes('region') || currentFeature.properties?.country_id != null);
        menuEl.querySelectorAll('[data-action="split-river"], [data-action="rename-region"]').forEach(item => {
            item.style.display = isRegionFeature ? '' : 'none';
        });

        // Show/hide add-regions mode items
        const isAddMode = typeof CMapsEditor !== 'undefined' && CMapsEditor.getCurrentTool() === 'add-regions';
        menuEl.querySelectorAll('.ctx-add-mode').forEach(item => {
            item.style.display = isAddMode && currentFeature ? '' : 'none';
        });

        // Update "Add All Parts" label with region base name
        if (isAddMode && currentFeature) {
            const regionName = currentFeature.properties?.name || '';
            const baseName = regionName.replace(/\s*\([^)]*\)\s*$/, '').trim();
            const addAllLabel = menuEl.querySelector('[data-action="add-all-parts"] span');
            if (addAllLabel) addAllLabel.textContent = `Add All Parts of ${baseName}`;
        }

        // Position the menu at cursor
        const x = detail.originalEvent?.clientX || detail.point?.x || 0;
        const y = detail.originalEvent?.clientY || detail.point?.y || 0;

        // Keep menu within viewport
        const menuW = 220;
        const menuH = 320;
        const finalX = Math.min(x, window.innerWidth - menuW - 10);
        const finalY = Math.min(y, window.innerHeight - menuH - 10);

        menuEl.style.left = `${finalX}px`;
        menuEl.style.top = `${finalY}px`;
        menuEl.classList.remove('hidden');
        menuEl.classList.add('visible');

        // Update feature-specific info
        if (currentFeature) {
            const name = currentFeature.properties?.name || 'Unknown';
            const featureLabel = menuEl.querySelector('.ctx-feature-name');
            if (featureLabel) featureLabel.textContent = name;
        }
    }

    function hide() {
        if (!menuEl) return;
        menuEl.classList.add('hidden');
        menuEl.classList.remove('visible');
        currentFeature = null;
    }

    function handleAction(action) {
        switch (action) {
            case 'edit-data': {
                if (!currentFeature) return;
                const id = currentFeature.id || currentFeature.properties?.country_id || currentFeature.properties?.id;
                if (id) CMapsGlobe.selectCountry(id);
                break;
            }
            case 'split': {
                if (!currentFeature) return;
                const id = currentFeature.id || currentFeature.properties?.country_id;
                if (id) {
                    const countriesData = CMapsGlobe.getCountriesData();
                    const feature = countriesData?.features?.find(f => f.id === id || f.properties?.id === id);
                    if (feature) {
                        CMapsPanel.showCountry(feature);
                        CMapsEditor.startSplitMode(feature);
                    }
                }
                break;
            }
            case 'independence': {
                if (!currentFeature) return;
                // If right-clicked on a region, detach it
                const regionId = currentFeature.properties?.id;
                const countryId = currentFeature.properties?.country_id;
                if (regionId && countryId) {
                    makeIndependent(regionId);
                }
                break;
            }
            case 'change-color': {
                if (!currentFeature) return;
                const id = currentFeature.id || currentFeature.properties?.country_id || currentFeature.properties?.id;
                if (id) {
                    const newColor = CMapsUtils.randomColor();
                    CMapsUtils.api(`/api/countries/${id}`, {
                        method: 'PUT',
                        body: { color: newColor }
                    }).then(() => {
                        CMapsGlobe.refreshCountries();
                        CMapsUtils.toast('Color updated', 'success');
                    }).catch(err => {
                        CMapsUtils.toast(`Failed: ${err.message}`, 'error');
                    });
                }
                break;
            }
            case 'fly-to': {
                if (currentLngLat) {
                    CMapsGlobe.flyTo(currentLngLat.lng, currentLngLat.lat, 6);
                }
                break;
            }
            case 'delete': {
                if (!currentFeature) return;
                const id = currentFeature.id || currentFeature.properties?.country_id || currentFeature.properties?.id;
                const name = currentFeature.properties?.name || 'this entity';
                if (id) {
                    CMapsPanel.openDeleteModal(id, name);
                }
                break;
            }
            case 'copy-coords': {
                if (currentLngLat) {
                    const coords = `${currentLngLat.lat.toFixed(6)}, ${currentLngLat.lng.toFixed(6)}`;
                    navigator.clipboard.writeText(coords).then(() => {
                        CMapsUtils.toast(`Copied: ${coords}`, 'info');
                    });
                }
                break;
            }
            case 'add-part': {
                if (!currentFeature) return;
                CMapsEditor.handleRegionClick(currentFeature, false);
                break;
            }
            case 'add-all-parts': {
                if (!currentFeature) return;
                CMapsEditor.handleRegionClick(currentFeature, true);
                break;
            }
            case 'split-river': {
                if (!currentFeature) return;
                const regionId = currentFeature.properties?.id;
                const regionName = currentFeature.properties?.name || 'Region';
                if (regionId) openRiverSplitModal(regionId, regionName);
                break;
            }
            case 'rename-region': {
                if (!currentFeature) return;
                const rId = currentFeature.properties?.id;
                const rName = currentFeature.properties?.name || '';
                if (rId) openRenameRegionModal(rId, rName);
                break;
            }
        }
    }

    async function makeIndependent(regionId) {
        try {
            CMapsUtils.setStatus('Declaring independence...');
            const result = await CMapsUtils.api(`/api/countries/from-region/${regionId}`, {
                method: 'POST',
            });
            CMapsHistory.push('create', { after: result });
            await CMapsGlobe.refreshCountries();
            CMapsUtils.toast(`"${result.properties?.name}" is now independent!`, 'success');
            CMapsUtils.setStatus('Ready');
        } catch (err) {
            CMapsUtils.toast(`Independence failed: ${err.message}`, 'error');
            CMapsUtils.setStatus('Ready');
        }
    }

    // ═══ River Split ═══
    let _splitRegionId = null;
    let _selectedRiver = null;

    async function openRiverSplitModal(regionId, regionName) {
        _splitRegionId = regionId;
        _selectedRiver = null;

        const modal = document.getElementById('river-split-modal');
        modal.querySelector('.split-region-name').textContent = regionName;
        modal.classList.remove('hidden');

        const list = document.getElementById('river-list');
        list.innerHTML = '<div class="empty-state">Loading nearby rivers...</div>';
        document.getElementById('split-names-group').style.display = 'none';
        document.getElementById('btn-confirm-split-river').disabled = true;

        // Pre-fill names
        document.getElementById('split-name-1').value = regionName + ' (North)';
        document.getElementById('split-name-2').value = regionName + ' (South)';

        try {
            const rivers = await CMapsUtils.api(`/api/regions/rivers-near/${regionId}`);
            if (rivers.length === 0) {
                list.innerHTML = '<div class="empty-state">No rivers found near this region</div>';
                return;
            }
            list.innerHTML = rivers.map(r => `
                <div class="river-item${r.intersects ? '' : ' river-nearby'}" data-river="${r.name}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2c-3 7-7 10-7 14a7 7 0 0 0 14 0c0-4-4-7-7-14z"/></svg>
                    <span class="river-item-name">${r.name}</span>
                    ${r.intersects ? '<span class="river-badge">crosses region</span>' : '<span class="river-badge nearby">nearby</span>'}
                </div>
            `).join('');

            // Bind river selection
            list.querySelectorAll('.river-item').forEach(item => {
                item.addEventListener('click', () => {
                    list.querySelectorAll('.river-item').forEach(i => i.classList.remove('selected'));
                    item.classList.add('selected');
                    _selectedRiver = item.dataset.river;
                    document.getElementById('split-names-group').style.display = '';
                    document.getElementById('btn-confirm-split-river').disabled = false;
                });
            });
        } catch (err) {
            list.innerHTML = `<div class="empty-state">Failed to load rivers: ${err.message}</div>`;
        }

        // Bind confirm button (only once)
        const btn = document.getElementById('btn-confirm-split-river');
        btn.onclick = confirmRiverSplit;
    }

    async function confirmRiverSplit() {
        if (!_splitRegionId || !_selectedRiver) return;

        const name1 = document.getElementById('split-name-1').value.trim();
        const name2 = document.getElementById('split-name-2').value.trim();

        try {
            CMapsUtils.setStatus('Splitting region...');
            const result = await CMapsUtils.api(`/api/regions/${_splitRegionId}/split-by-river`, {
                method: 'POST',
                body: {
                    river_name: _selectedRiver,
                    new_names: [name1 || 'Part 1', name2 || 'Part 2'],
                },
            });

            // Close modal
            const modal = document.getElementById('river-split-modal');
            modal.classList.add('hidden');

            await CMapsGlobe.refreshRegions();
            await CMapsGlobe.refreshCountries();
            CMapsUtils.toast(`Split into ${result.parts} parts along ${_selectedRiver}!`, 'success');
            CMapsUtils.setStatus('Ready');
        } catch (err) {
            CMapsUtils.toast(`Split failed: ${err.message}`, 'error');
            CMapsUtils.setStatus('Ready');
        }
    }

    // ═══ Rename Region ═══
    let _renameRegionId = null;

    function openRenameRegionModal(regionId, currentName) {
        _renameRegionId = regionId;
        const modal = document.getElementById('rename-region-modal');
        const input = document.getElementById('rename-region-input');
        input.value = currentName;
        modal.classList.remove('hidden');

        // Focus and select text
        setTimeout(() => { input.focus(); input.select(); }, 100);

        const btn = document.getElementById('btn-confirm-rename-region');
        btn.onclick = confirmRenameRegion;

        // Enter key to confirm
        input.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirmRenameRegion(); }
        };
    }

    async function confirmRenameRegion() {
        if (!_renameRegionId) return;
        const newName = document.getElementById('rename-region-input').value.trim();
        if (!newName) {
            CMapsUtils.toast('Enter a name', 'error');
            return;
        }

        try {
            await CMapsUtils.api(`/api/regions/${_renameRegionId}`, {
                method: 'PUT',
                body: { name: newName },
            });

            const modal = document.getElementById('rename-region-modal');
            modal.classList.add('hidden');

            await CMapsGlobe.refreshRegions();
            CMapsUtils.toast(`Region renamed to "${newName}"`, 'success');
        } catch (err) {
            CMapsUtils.toast(`Rename failed: ${err.message}`, 'error');
        }
    }

    return { init, show, hide };
})();
