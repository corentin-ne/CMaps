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

    return { init, show, hide };
})();
