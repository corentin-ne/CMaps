/**
 * CMaps — History Module
 * Enhanced undo/redo with localStorage persistence and merge/split support.
 */
const CMapsHistory = (() => {
    const KEY = 'cmaps-history';
    const MAX_STACK = 50;
    let undoStack = [];
    let redoStack = [];

    function init() {
        // Restore from localStorage
        try {
            const saved = localStorage.getItem(KEY);
            if (saved) {
                const data = JSON.parse(saved);
                undoStack = data.undo || [];
                redoStack = data.redo || [];
            }
        } catch (e) {
            console.warn('Failed to restore history:', e);
        }

        updateButtons();
    }

    function save() {
        try {
            localStorage.setItem(KEY, JSON.stringify({
                undo: undoStack.slice(-MAX_STACK),
                redo: redoStack.slice(-MAX_STACK),
            }));
        } catch (e) {
            console.warn('Failed to save history:', e);
        }
    }

    /**
     * Push an action onto the undo stack.
     * @param {string} type - 'create', 'update', 'delete', 'merge', 'split', 'independence'
     * @param {object} data - { before, after, countryId, ... }
     */
    function push(type, data) {
        undoStack.push({
            type,
            data,
            timestamp: Date.now(),
        });

        // Trim stack
        if (undoStack.length > MAX_STACK) {
            undoStack = undoStack.slice(-MAX_STACK);
        }

        // Clear redo stack on new action
        redoStack = [];
        save();
        updateButtons();
    }

    async function undo() {
        if (undoStack.length === 0) {
            CMapsUtils.toast('Nothing to undo', 'info');
            return;
        }

        const action = undoStack.pop();
        redoStack.push(action);
        save();

        try {
            switch (action.type) {
                case 'create':
                    await undoCreate(action.data);
                    break;
                case 'update':
                    await undoUpdate(action.data);
                    break;
                case 'delete':
                    await undoDelete(action.data);
                    break;
                case 'merge':
                case 'split':
                case 'independence':
                    // Complex operations - reload map data
                    CMapsUtils.toast(`Complex undo — refreshing map data`, 'info');
                    await CMapsGlobe.refreshCountries();
                    break;
                default:
                    CMapsUtils.toast('Unknown action type', 'error');
            }
        } catch (err) {
            CMapsUtils.toast(`Undo failed: ${err.message}`, 'error');
            // Try to reload anyway
            try { await CMapsGlobe.refreshCountries(); } catch (_) {}
        }

        updateButtons();
        CMapsUtils.toast('Undone', 'success');
    }

    async function redo() {
        if (redoStack.length === 0) {
            CMapsUtils.toast('Nothing to redo', 'info');
            return;
        }

        const action = redoStack.pop();
        undoStack.push(action);
        save();

        try {
            switch (action.type) {
                case 'create':
                    await redoCreate(action.data);
                    break;
                case 'update':
                    await redoUpdate(action.data);
                    break;
                case 'delete':
                    await redoDelete(action.data);
                    break;
                case 'merge':
                case 'split':
                case 'independence':
                    CMapsUtils.toast(`Complex redo — refreshing map data`, 'info');
                    await CMapsGlobe.refreshCountries();
                    break;
                default:
                    CMapsUtils.toast('Unknown action type', 'error');
            }
        } catch (err) {
            CMapsUtils.toast(`Redo failed: ${err.message}`, 'error');
            try { await CMapsGlobe.refreshCountries(); } catch (_) {}
        }

        updateButtons();
        CMapsUtils.toast('Redone', 'success');
    }

    // --- Undo helpers ---

    async function undoCreate(data) {
        const id = data.after?.properties?.id || data.after?.id;
        if (id) {
            await CMapsUtils.api(`/api/countries/${id}`, { method: 'DELETE' });
            await CMapsGlobe.refreshCountries();
        }
    }

    async function undoUpdate(data) {
        const id = data.before?.properties?.id || data.before?.id;
        if (id && data.before) {
            const props = data.before.properties || data.before;
            await CMapsUtils.api(`/api/countries/${id}`, {
                method: 'PUT',
                body: {
                    name: props.name,
                    geometry: data.before.geometry,
                    population: props.population,
                    capital: props.capital,
                    flag_emoji: props.flag_emoji,
                    color: props.color,
                },
            });
            await CMapsGlobe.refreshCountries();
        }
    }

    async function undoDelete(data) {
        if (data.before) {
            const props = data.before.properties || data.before;
            await CMapsUtils.api('/api/countries', {
                method: 'POST',
                body: {
                    name: props.name,
                    geometry: data.before.geometry,
                    population: props.population,
                    capital: props.capital,
                    flag_emoji: props.flag_emoji,
                    color: props.color,
                    continent: props.continent,
                    subregion: props.subregion,
                },
            });
            await CMapsGlobe.refreshCountries();
        }
    }

    // --- Redo helpers ---

    async function redoCreate(data) {
        if (data.after) {
            const props = data.after.properties || data.after;
            await CMapsUtils.api('/api/countries', {
                method: 'POST',
                body: {
                    name: props.name,
                    geometry: data.after.geometry,
                    population: props.population,
                    capital: props.capital,
                    flag_emoji: props.flag_emoji,
                    color: props.color,
                    continent: props.continent,
                    subregion: props.subregion,
                },
            });
            await CMapsGlobe.refreshCountries();
        }
    }

    async function redoUpdate(data) {
        const id = data.after?.properties?.id || data.after?.id;
        if (id && data.after) {
            const props = data.after.properties || data.after;
            await CMapsUtils.api(`/api/countries/${id}`, {
                method: 'PUT',
                body: {
                    name: props.name,
                    geometry: data.after.geometry,
                    population: props.population,
                    capital: props.capital,
                    flag_emoji: props.flag_emoji,
                    color: props.color,
                },
            });
            await CMapsGlobe.refreshCountries();
        }
    }

    async function redoDelete(data) {
        const id = data.before?.properties?.id || data.before?.id;
        if (id) {
            await CMapsUtils.api(`/api/countries/${id}`, { method: 'DELETE' });
            await CMapsGlobe.refreshCountries();
        }
    }

    function updateButtons() {
        const undoBtn = document.getElementById('btn-undo');
        const redoBtn = document.getElementById('btn-redo');
        if (undoBtn) undoBtn.disabled = undoStack.length === 0;
        if (redoBtn) redoBtn.disabled = redoStack.length === 0;
    }

    function clear() {
        undoStack = [];
        redoStack = [];
        save();
        updateButtons();
    }

    return { init, push, undo, redo, clear };
})();
