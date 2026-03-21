/**
 * CMaps — History Module
 * Undo/redo system for all map edits.
 */
const CMapsHistory = (() => {
    const MAX_HISTORY = 50;
    let undoStack = [];
    let redoStack = [];

    function init() {
        updateButtons();
    }

    /**
     * Push an action onto the undo stack.
     * @param {string} action - 'create', 'update', 'delete', 'merge', 'split'
     * @param {object} data - { before?, after? }
     */
    function push(action, data) {
        undoStack.push({ action, data, timestamp: Date.now() });
        if (undoStack.length > MAX_HISTORY) {
            undoStack.shift();
        }
        // Clear redo stack on new action
        redoStack = [];
        updateButtons();
    }

    /**
     * Undo the last action.
     */
    async function undo() {
        if (undoStack.length === 0) return;

        const entry = undoStack.pop();
        redoStack.push(entry);

        try {
            CMapsUtils.setStatus('Undoing...');
            switch (entry.action) {
                case 'create':
                    // Undo create = delete the created country
                    if (entry.data.after) {
                        const id = entry.data.after.properties?.id || entry.data.after.id;
                        await CMapsUtils.api(`/api/countries/${id}`, { method: 'DELETE' });
                    }
                    break;

                case 'update':
                    // Undo update = restore previous state
                    if (entry.data.before) {
                        const id = entry.data.before.properties?.id || entry.data.before.id;
                        const props = entry.data.before.properties || {};
                        await CMapsUtils.api(`/api/countries/${id}`, {
                            method: 'PUT',
                            body: {
                                name: props.name,
                                population: props.population,
                                capital: props.capital,
                                color: props.color,
                                flag_emoji: props.flag_emoji,
                                geometry: entry.data.before.geometry,
                            },
                        });
                    }
                    break;

                case 'delete':
                    // Undo delete = recreate the country
                    if (entry.data.before) {
                        const props = entry.data.before.properties || {};
                        await CMapsUtils.api('/api/countries', {
                            method: 'POST',
                            body: {
                                name: props.name,
                                geometry: entry.data.before.geometry,
                                population: props.population || 0,
                                capital: props.capital,
                                flag_emoji: props.flag_emoji,
                                color: props.color,
                            },
                        });
                    }
                    break;

                case 'merge':
                case 'split':
                    // These are complex — for now, show a message
                    CMapsUtils.toast('Complex undo: reloading previous state from history', 'info');
                    break;
            }

            CMapsGlobe.deselectCountry();
            await CMapsGlobe.refreshCountries();
            CMapsUtils.toast('Undone', 'info');
            CMapsUtils.setStatus('Ready');
        } catch (err) {
            CMapsUtils.toast(`Undo failed: ${err.message}`, 'error');
            // Restore the entry on failure
            redoStack.pop();
            undoStack.push(entry);
        }

        updateButtons();
    }

    /**
     * Redo the last undone action.
     */
    async function redo() {
        if (redoStack.length === 0) return;

        const entry = redoStack.pop();
        undoStack.push(entry);

        try {
            CMapsUtils.setStatus('Redoing...');
            switch (entry.action) {
                case 'create':
                    if (entry.data.after) {
                        const props = entry.data.after.properties || {};
                        await CMapsUtils.api('/api/countries', {
                            method: 'POST',
                            body: {
                                name: props.name,
                                geometry: entry.data.after.geometry,
                                population: props.population || 0,
                                capital: props.capital,
                                flag_emoji: props.flag_emoji,
                                color: props.color,
                            },
                        });
                    }
                    break;

                case 'update':
                    if (entry.data.after) {
                        const id = entry.data.after.properties?.id || entry.data.after.id;
                        const props = entry.data.after.properties || {};
                        await CMapsUtils.api(`/api/countries/${id}`, {
                            method: 'PUT',
                            body: {
                                name: props.name,
                                population: props.population,
                                capital: props.capital,
                                color: props.color,
                                flag_emoji: props.flag_emoji,
                                geometry: entry.data.after.geometry,
                            },
                        });
                    }
                    break;

                case 'delete':
                    if (entry.data.before) {
                        const id = entry.data.before.properties?.id || entry.data.before.id;
                        await CMapsUtils.api(`/api/countries/${id}`, { method: 'DELETE' });
                    }
                    break;

                case 'merge':
                case 'split':
                    CMapsUtils.toast('Complex redo not available for this action', 'info');
                    break;
            }

            CMapsGlobe.deselectCountry();
            await CMapsGlobe.refreshCountries();
            CMapsUtils.toast('Redone', 'info');
            CMapsUtils.setStatus('Ready');
        } catch (err) {
            CMapsUtils.toast(`Redo failed: ${err.message}`, 'error');
            undoStack.pop();
            redoStack.push(entry);
        }

        updateButtons();
    }

    /**
     * Update undo/redo button states.
     */
    function updateButtons() {
        document.getElementById('btn-undo').disabled = undoStack.length === 0;
        document.getElementById('btn-redo').disabled = redoStack.length === 0;
    }

    return {
        init,
        push,
        undo,
        redo,
    };
})();
