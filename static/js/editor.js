/**
 * CMaps — Editor Module
 * Click-to-transfer region system for reassigning regions between countries.
 */
const CMapsEditor = (() => {
    let currentTool = 'select';
    let mergeSelection = []; // Array of selected country features for merge
    let regionsReassigned = 0; // Counter for mode banner feedback

    function init() {
        // Tool button clicks
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => setTool(btn.dataset.tool));
        });

        // Toolbar action buttons
        const btnMerge = document.getElementById('btn-merge');
        if (btnMerge) btnMerge.addEventListener('click', openMergeDialog);
        
        const btnSplit = document.getElementById('btn-split'); // from toolbar
        if (btnSplit) btnSplit.addEventListener('click', () => {
             CMapsUtils.toast('Splitting is currently disabled. Assign regions individually instead.', 'info');
        });

        const btnSplitPanel = document.getElementById('btn-split-panel'); // from panel action
        if (btnSplitPanel) btnSplitPanel.addEventListener('click', () => {
             CMapsUtils.toast('Splitting is currently disabled. Assign regions individually instead.', 'info');
        });
        
        const btnDeleteToolbar = document.getElementById('btn-delete'); // toolbar action button
        if (btnDeleteToolbar) {
             btnDeleteToolbar.addEventListener('click', confirmDeleteCountry);
        }

        const btnDeletePanel = document.getElementById('btn-delete-panel'); // panel action button
        if (btnDeletePanel) {
             btnDeletePanel.addEventListener('click', confirmDeleteCountry);
        }

        const btnNewCountry = document.getElementById('btn-new-country');
        if (btnNewCountry) {
            btnNewCountry.addEventListener('click', () => {
                document.getElementById('new-country-color').value = CMapsUtils.randomColor();
                CMapsPanel.openModal('modal-new-country');
            });
        }

        const btnConfirmCreate = document.getElementById('btn-confirm-create');
        if (btnConfirmCreate) btnConfirmCreate.addEventListener('click', confirmCreateCountry);

        const btnConfirmMerge = document.getElementById('btn-confirm-merge');
        if (btnConfirmMerge) btnConfirmMerge.addEventListener('click', confirmMerge);
    }

    /**
     * Set the active editing/navigation tool.
     */
    function setTool(tool) {
        currentTool = tool;

        // Update UI
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });

        const banner = document.getElementById('mode-banner');

        if (tool === 'select') {
            CMapsUtils.setStatus('Ready');
            regionsReassigned = 0;
            if (banner) banner.classList.add('hidden');
        } else if (tool === 'add-regions') {
            const feature = CMapsPanel.getCurrentFeature();
            if (feature) {
                const name = feature.properties?.name || 'the selected country';
                CMapsUtils.setStatus(`Add Regions mode: Click regions to reassign them to ${name}. Press Escape to exit.`);
                regionsReassigned = 0;
                if (banner) {
                    banner.classList.remove('hidden');
                    const bannerName = banner.querySelector('.mode-banner-country');
                    const bannerCount = banner.querySelector('.mode-banner-count');
                    if (bannerName) bannerName.textContent = name;
                    if (bannerCount) bannerCount.textContent = '0 regions reassigned';
                }
            } else {
                CMapsUtils.toast('Select a country first, then enter Add Regions mode.', 'info');
                setTool('select');
            }
        }
    }

    /**
     * Handle clicking a region on the globe while tools are active.
     */
    async function handleRegionClick(regionFeature) {
        if (currentTool === 'add-regions') {
            const countryFeature = CMapsPanel.getCurrentFeature();
            if (!countryFeature) {
                CMapsUtils.toast('Select a parent country to reassign regions to', 'info');
                setTool('select');
                return;
            }

            const targetCountryId = countryFeature.properties?.id || countryFeature.id;
            const regionId = regionFeature.properties?.id || regionFeature.id;
            const regionName = regionFeature.properties?.name || 'Region';

            if (regionFeature.properties.country_id === targetCountryId) {
                // Already belongs to this country
                return;
            }

            try {
                CMapsUtils.setStatus(`Reassigning ${regionName}...`);
                await CMapsUtils.api('/api/regions/bulk-assign', {
                    method: 'POST',
                    body: {
                        region_ids: [regionId],
                        country_id: targetCountryId
                    }
                });

                // Refresh map data
                await Promise.all([
                    CMapsGlobe.refreshCountries(),
                    CMapsGlobe.refreshRegions(),
                ]);

                // Update counter
                regionsReassigned++;
                const banner = document.getElementById('mode-banner');
                if (banner) {
                    const bannerCount = banner.querySelector('.mode-banner-count');
                    if (bannerCount) bannerCount.textContent = `${regionsReassigned} region${regionsReassigned !== 1 ? 's' : ''} reassigned`;
                }

                CMapsUtils.toast(`${regionName} → ${countryFeature.properties?.name}`, 'success', 1500);
                CMapsUtils.setStatus(`Add Regions mode: ${regionsReassigned} reassigned. Keep clicking or press Escape.`);
                
            } catch (err) {
                CMapsUtils.toast(`Failed to reassign: ${err.message}`, 'error');
                CMapsUtils.setStatus('Ready');
            }
        }
    }

    /**
     * Confirm creating a new country from the dialog.
     */
    async function confirmCreateCountry() {
        const name = document.getElementById('new-country-name').value.trim();
        if (!name) {
            CMapsUtils.toast('Please enter a country name', 'error');
            return;
        }

        // Create a dummy polygon to pass geo validation. It will be replaced when regions are assigned.
        const dummyGeometry = {"type": "Polygon", "coordinates": [[[0, 0], [0, 0.0001], [0.0001, 0], [0, 0]]]};

        const data = {
            name: name,
            geometry: dummyGeometry,
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

            // Clear form
            document.getElementById('new-country-name').value = '';
            document.getElementById('new-country-capital').value = '';
            document.getElementById('new-country-population').value = '';
            document.getElementById('new-country-flag').value = '';

            CMapsUtils.toast(`"${name}" created!`, 'success');
            
            // Automatically select it and turn on 'add-regions'
            CMapsGlobe.selectCountry(result.properties.id);
            setTool('add-regions');

        } catch (err) {
            CMapsUtils.toast(`Failed to create: ${err.message}`, 'error');
        }
    }

    // ═══ Split ═══
    function startSplitMode(feature) {
         CMapsUtils.toast('Splitting is currently disabled. Detach regions using the context menu instead.', 'info');
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
        const btnMerge = document.getElementById('btn-merge');
        if (btnMerge) btnMerge.disabled = mergeSelection.length < 2;

        if (mergeSelection.length > 0) {
            CMapsUtils.setStatus(`${mergeSelection.length} countries selected for merge. Click 'Merge Countries' in the toolbar to proceed.`);
        } else {
            CMapsUtils.setStatus('Ready');
        }
    }

    function openMergeDialog() {
        if (mergeSelection.length < 2) {
            CMapsUtils.toast('Select at least 2 countries to merge (Shift+Click or Ctrl+Click map)', 'info');
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
            const btnMerge = document.getElementById('btn-merge');
            if (btnMerge) btnMerge.disabled = true;

            CMapsUtils.toast(`Countries merged into "${newName}"!`, 'success');
            CMapsUtils.setStatus('Ready');

        } catch (err) {
            CMapsUtils.toast(`Merge failed: ${err.message}`, 'error');
        }
    }

    // ═══ Edit Borders ═══
    function startEditMode(feature) {
        setTool('add-regions');
    }

    // ═══ Exit Mode ═══
    function exitMode() {
        setTool('select');
    }

    // ═══ Delete ═══
    function confirmDeleteCountry() {
         const feature = CMapsPanel.getCurrentFeature();
         if (feature) {
             const name = feature.properties?.name || 'this country';
             document.querySelector('.delete-country-name').textContent = name;
             // Unbind previous click events
             const btnCascade = document.querySelector('[data-delete-mode="cascade"]');
             const btnUnclaim = document.querySelector('[data-delete-mode="unclaim"]');
             
             btnCascade.onclick = () => deleteCountry(feature, 'cascade');
             btnUnclaim.onclick = () => deleteCountry(feature, 'unclaim');
             
             CMapsPanel.openModal('delete-modal');
         }
    }
    
    async function deleteCountry(feature, mode) {
        const id = feature.properties?.id || feature.id;
        try {
            CMapsUtils.setStatus('Deleting...');
            await CMapsUtils.api(`/api/countries/${id}?mode=${mode}`, { method: 'DELETE' });
            CMapsHistory.push('delete', { before: feature });
            CMapsGlobe.deselectCountry();
            await CMapsGlobe.refreshCountries();
            CMapsPanel.closeModal();
            CMapsUtils.toast('Country deleted', 'success');
            CMapsUtils.setStatus('Ready');
        } catch (err) {
            CMapsUtils.toast(`Delete failed: ${err.message}`, 'error');
        }
    }

    function getMergeSelection() { return mergeSelection; }
    function clearMergeSelection() {
        mergeSelection = [];
        const btnMerge = document.getElementById('btn-merge');
        if (btnMerge) btnMerge.disabled = true;
    }
    
    function getCurrentTool() {
        return currentTool;
    }

    return {
        init,
        setTool,
        startSplitMode,
        startEditMode,
        toggleMergeSelect,
        getMergeSelection,
        clearMergeSelection,
        getCurrentTool,
        handleRegionClick,
    };
})();
