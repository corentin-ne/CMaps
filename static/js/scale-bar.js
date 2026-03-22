/**
 * CMaps — Scale Bar Module
 * Dynamic real-world distance indicator that updates based on zoom level.
 */
const CMapsScaleBar = (() => {
    let scaleEl = null;
    let scaleLineEl = null;
    let scaleLabelEl = null;

    function init() {
        scaleEl = document.getElementById('scale-bar');
        scaleLineEl = document.getElementById('scale-bar-line');
        scaleLabelEl = document.getElementById('scale-bar-label');
    }

    /**
     * Update the scale bar based on current map state.
     */
    function update(map) {
        if (!scaleEl || !scaleLineEl || !scaleLabelEl || !map) return;

        const center = map.getCenter();
        const zoom = map.getZoom();

        // Calculate meters per pixel at current zoom and latitude
        const metersPerPixel = getMetersPerPixel(center.lat, zoom);

        // Find a nice round distance for the bar
        const barWidthPx = 120; // Target bar width in pixels
        const rawDistanceM = metersPerPixel * barWidthPx;

        const { value, unit, adjustedPx } = getNiceDistance(rawDistanceM, barWidthPx, metersPerPixel);

        scaleLineEl.style.width = `${adjustedPx}px`;
        scaleLabelEl.textContent = `${value} ${unit}`;
    }

    /**
     * Calculate meters per pixel at a given latitude and zoom level.
     */
    function getMetersPerPixel(lat, zoom) {
        const EARTH_CIRCUMFERENCE = 40075017; // meters
        return (EARTH_CIRCUMFERENCE * Math.cos(lat * Math.PI / 180)) / (256 * Math.pow(2, zoom));
    }

    /**
     * Get a nice round distance value and the corresponding pixel width.
     */
    function getNiceDistance(rawDistanceM, targetPx, metersPerPixel) {
        // Nice round values in meters
        const niceValues = [
            1, 2, 5, 10, 20, 50, 100, 200, 500,
            1000, 2000, 5000, 10000, 20000, 50000,
            100000, 200000, 500000, 1000000, 2000000, 5000000
        ];

        let bestValue = niceValues[0];
        let bestDiff = Infinity;

        for (const v of niceValues) {
            const diff = Math.abs(v - rawDistanceM);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestValue = v;
            }
        }

        const adjustedPx = bestValue / metersPerPixel;
        let value, unit;

        if (bestValue >= 1000) {
            value = bestValue / 1000;
            unit = 'km';
        } else {
            value = bestValue;
            unit = 'm';
        }

        return { value, unit, adjustedPx: Math.round(adjustedPx) };
    }

    return { init, update };
})();
