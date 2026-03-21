/**
 * CMaps — Main Application Controller
 * Initializes all modules and coordinates global interactions.
 */
const CMapsApp = (() => {
    let currentProjectId = null;

    async function init() {
        console.log('%c CMaps %c World Map Editor ',
            'background: #6ea8fe; color: #0a0a0f; font-weight: bold; padding: 4px 8px; border-radius: 4px 0 0 4px;',
            'background: #1a1a25; color: #e8e8f0; padding: 4px 8px; border-radius: 0 4px 4px 0;'
        );

        // Initialize the globe (this loads all data)
        await CMapsGlobe.init();

        // Initialize all modules
        CMapsPanel.init();
        CMapsSearch.init();
        CMapsEditor.init();
        CMapsHistory.init();

        // Setup global event handlers
        setupKeyboardShortcuts();
        setupTopBarActions();
        setupLayerToggles();

        CMapsUtils.toast('Welcome to CMaps! Click on any country to get started.', 'info', 4000);
    }

    /**
     * Keyboard shortcuts.
     */
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts when typing in input fields
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Ctrl/Cmd shortcuts
            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case 'z':
                        e.preventDefault();
                        if (e.shiftKey) {
                            CMapsHistory.redo();
                        } else {
                            CMapsHistory.undo();
                        }
                        break;
                    case 'y':
                        e.preventDefault();
                        CMapsHistory.redo();
                        break;
                    case 's':
                        e.preventDefault();
                        saveProject();
                        break;
                    case 'f':
                        e.preventDefault();
                        document.getElementById('search-input').focus();
                        break;
                }
                return;
            }

            // Single key shortcuts
            switch (e.key.toLowerCase()) {
                case 'v':
                    CMapsEditor.setTool('select');
                    break;
                case 'p':
                    CMapsEditor.setTool('polygon');
                    break;
                case 'l':
                    CMapsEditor.setTool('line');
                    break;
                case 'f':
                    CMapsEditor.setTool('freehand');
                    break;
                case 'e':
                    CMapsEditor.setTool('edit');
                    break;
                case 'escape':
                    CMapsGlobe.deselectCountry();
                    CMapsEditor.setTool('select');
                    CMapsEditor.clearMergeSelection();
                    CMapsPanel.closeModal();
                    break;
                case 'delete':
                case 'backspace':
                    // Delete selected country
                    const feature = CMapsPanel.getCurrentFeature();
                    if (feature) {
                        const id = feature.properties?.id || feature.id;
                        const name = feature.properties?.name || 'this country';
                        if (confirm(`Delete "${name}"?`)) {
                            CMapsUtils.api(`/api/countries/${id}`, { method: 'DELETE' }).then(() => {
                                CMapsHistory.push('delete', { before: feature });
                                CMapsGlobe.deselectCountry();
                                CMapsGlobe.refreshCountries();
                                CMapsUtils.toast(`"${name}" deleted`, 'success');
                            });
                        }
                    }
                    break;
            }
        });
    }

    /**
     * Top bar action buttons.
     */
    function setupTopBarActions() {
        // Undo / Redo
        document.getElementById('btn-undo').addEventListener('click', () => CMapsHistory.undo());
        document.getElementById('btn-redo').addEventListener('click', () => CMapsHistory.redo());

        // Save
        document.getElementById('btn-save').addEventListener('click', saveProject);

        // Load
        document.getElementById('btn-load').addEventListener('click', loadProjectDialog);

        // Export
        document.getElementById('btn-export').addEventListener('click', exportGeoJSON);

        // Import
        document.getElementById('btn-import').addEventListener('click', () => {
            document.getElementById('import-file-input').click();
        });
        document.getElementById('import-file-input').addEventListener('change', importGeoJSON);
    }

    /**
     * Layer toggle checkboxes.
     */
    function setupLayerToggles() {
        document.querySelectorAll('.layer-toggle input[data-layer]').forEach(cb => {
            cb.addEventListener('change', () => {
                CMapsGlobe.toggleLayer(cb.dataset.layer, cb.checked);
            });
        });
    }

    // ═══ Save/Load/Export/Import ═══

    async function saveProject() {
        const name = document.getElementById('project-name').value || 'Untitled Project';

        try {
            CMapsUtils.setStatus('Saving project...');

            if (currentProjectId) {
                // Update existing project
                await CMapsUtils.api(`/api/projects/${currentProjectId}/save`, { method: 'POST' });
            } else {
                // Create new project
                const result = await CMapsUtils.api('/api/projects', {
                    method: 'POST',
                    body: { name: name },
                });
                currentProjectId = result.id;
            }

            CMapsUtils.toast('Project saved!', 'success');
            CMapsUtils.setStatus('Ready');
        } catch (err) {
            CMapsUtils.toast(`Save failed: ${err.message}`, 'error');
        }
    }

    async function loadProjectDialog() {
        try {
            const projects = await CMapsUtils.api('/api/projects');
            const list = document.getElementById('projects-list');

            if (!projects || projects.length === 0) {
                list.innerHTML = '<div class="empty-state">No saved projects yet</div>';
            } else {
                list.innerHTML = projects.map(p => `
                    <div class="project-item" data-id="${p.id}">
                        <div>
                            <div class="project-name">${p.name}</div>
                            <div class="project-date">${new Date(p.updated_at || p.created_at).toLocaleDateString()}</div>
                        </div>
                        <div class="project-actions">
                            <button class="btn btn-ghost btn-load-project" data-id="${p.id}" title="Load">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22,12 16,12 14,15 10,15 8,12 2,12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
                            </button>
                            <button class="btn btn-ghost btn-delete-project" data-id="${p.id}" title="Delete">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                        </div>
                    </div>
                `).join('');

                // Load buttons
                list.querySelectorAll('.btn-load-project').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const id = parseInt(btn.dataset.id);
                        await loadProject(id);
                    });
                });

                // Delete buttons
                list.querySelectorAll('.btn-delete-project').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const id = parseInt(btn.dataset.id);
                        if (confirm('Delete this project?')) {
                            await CMapsUtils.api(`/api/projects/${id}`, { method: 'DELETE' });
                            CMapsUtils.toast('Project deleted', 'success');
                            loadProjectDialog(); // Refresh list
                        }
                    });
                });
            }

            CMapsPanel.openModal('modal-projects');
        } catch (err) {
            CMapsUtils.toast('Failed to load projects', 'error');
        }
    }

    async function loadProject(id) {
        try {
            CMapsUtils.setStatus('Loading project...');
            const project = await CMapsUtils.api(`/api/projects/${id}`);

            // Load the snapshot
            await CMapsUtils.api(`/api/projects/${id}/load`, { method: 'POST' });

            currentProjectId = id;
            document.getElementById('project-name').value = project.name;

            CMapsGlobe.deselectCountry();
            await CMapsGlobe.refreshCountries();
            CMapsPanel.closeModal();

            CMapsUtils.toast(`Loaded "${project.name}"`, 'success');
            CMapsUtils.setStatus('Ready');
        } catch (err) {
            CMapsUtils.toast(`Load failed: ${err.message}`, 'error');
        }
    }

    async function exportGeoJSON() {
        try {
            const response = await fetch('/api/projects/export/current');
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'cmaps_export.geojson';
            a.click();
            URL.revokeObjectURL(url);
            CMapsUtils.toast('GeoJSON exported!', 'success');
        } catch (err) {
            CMapsUtils.toast('Export failed', 'error');
        }
    }

    function importGeoJSON(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const geojson = JSON.parse(event.target.result);
                if (!geojson.features || !Array.isArray(geojson.features)) {
                    CMapsUtils.toast('Invalid GeoJSON file', 'error');
                    return;
                }

                CMapsUtils.setStatus('Importing countries...');
                let imported = 0;

                for (const feature of geojson.features) {
                    const props = feature.properties || {};
                    try {
                        await CMapsUtils.api('/api/countries', {
                            method: 'POST',
                            body: {
                                name: props.name || props.NAME || `Imported ${imported + 1}`,
                                geometry: feature.geometry,
                                population: props.population || props.POP_EST || 0,
                                capital: props.capital || props.CAPITAL || null,
                                flag_emoji: props.flag_emoji || '🏳️',
                                color: props.color || CMapsUtils.randomColor(),
                            },
                        });
                        imported++;
                    } catch (err) {
                        console.warn('Failed to import feature:', err);
                    }
                }

                await CMapsGlobe.refreshCountries();
                CMapsUtils.toast(`Imported ${imported} countries!`, 'success');
                CMapsUtils.setStatus('Ready');
            } catch (err) {
                CMapsUtils.toast('Failed to parse GeoJSON file', 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = ''; // Reset
    }

    return { init };
})();

// ═══ Bootstrap ═══
document.addEventListener('DOMContentLoaded', () => {
    CMapsApp.init().catch(err => {
        console.error('CMaps init failed:', err);
        CMapsUtils.toast('Failed to initialize. Is the server running?', 'error', 5000);
    });
});
