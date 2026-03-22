/**
 * CMaps — Globe Particle Animations
 * Lightweight canvas overlay for shore waves, ocean currents, and wind streams.
 * All particles are projected via MapLibre's project/unproject so they rotate with the globe.
 */
const CMapsParticles = (() => {
    let _map = null;
    let _canvas = null;
    let _ctx = null;
    let _raf = null;
    let _enabled = { waves: true, currents: true, wind: true };
    let _particles = { waves: [], currents: [], wind: [] };
    let _lastTime = 0;
    let _coastPoints = [];
    let _coastReady = false;
    let _currentsSeeded = false;
    let _windSeeded = false;

    // ── Tuning constants ──
    const TARGET_FPS = 30;
    const FRAME_INTERVAL = 1000 / TARGET_FPS;
    const MAX_WAVE_PARTICLES   = 280;
    const MAX_CURRENT_PARTICLES = 160;
    const MAX_WIND_PARTICLES    = 120;

    // Ocean current "gyres" — stylized circular flow paths
    const GYRES = [
        { cx: -40,  cy:  30,  rx: 30, ry: 18, dir:  1, speed: 0.015 },
        { cx: -20,  cy: -20,  rx: 25, ry: 15, dir: -1, speed: 0.013 },
        { cx:  80,  cy: -25,  rx: 30, ry: 16, dir: -1, speed: 0.012 },
        { cx: 170,  cy:  30,  rx: 40, ry: 20, dir:  1, speed: 0.014 },
        { cx: -130, cy:  30,  rx: 35, ry: 18, dir:  1, speed: 0.013 },
        { cx: -100, cy: -25,  rx: 30, ry: 16, dir: -1, speed: 0.011 },
        { cx:  10,  cy: -55,  rx: 60, ry: 10, dir:  1, speed: 0.018 },
    ];

    // Wind belt definitions — latitude bands with prevailing direction
    const WIND_BELTS = [
        { latMin:  25, latMax:  55, dir: 1,  speed: 0.045, lngSpan: 360 },
        { latMin: -55, latMax: -25, dir: 1,  speed: 0.042, lngSpan: 360 },
        { latMin: -25, latMax:  25, dir: -1, speed: 0.032, lngSpan: 360 },
        { latMin:  55, latMax:  70, dir: -1, speed: 0.028, lngSpan: 360 },
        { latMin: -70, latMax: -55, dir: -1, speed: 0.030, lngSpan: 360 },
    ];

    // ══════════════════════════════════════
    //  INITIALIZATION
    // ══════════════════════════════════════

    function init(map) {
        _map = map;

        // Create canvas overlay — z-index 5 to sit above MapLibre's canvas
        _canvas = document.createElement('canvas');
        _canvas.id = 'particle-canvas';
        _canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;';
        const container = map.getContainer();
        container.appendChild(_canvas);
        _ctx = _canvas.getContext('2d');

        _resize();
        window.addEventListener('resize', _resize);
        _map.on('resize', _resize);

        // Seed ocean currents and wind immediately — they DON'T need coast data
        _seedCurrentsAndWind();

        // Sample coastline from country borders once map is idle (for shore waves)
        _map.on('idle', _trySampleCoast);

        // Start animation loop
        _raf = requestAnimationFrame(_loop);
        console.log('[CMapsParticles] Initialized — canvas appended, loop started');
    }

    function _resize() {
        if (!_map || !_canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const container = _map.getContainer();
        const w = container.clientWidth;
        const h = container.clientHeight;
        _canvas.width = w * dpr;
        _canvas.height = h * dpr;
        _canvas.style.width = w + 'px';
        _canvas.style.height = h + 'px';
        _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function destroy() {
        if (_raf) cancelAnimationFrame(_raf);
        if (_canvas && _canvas.parentNode) _canvas.parentNode.removeChild(_canvas);
        window.removeEventListener('resize', _resize);
        _particles = { waves: [], currents: [], wind: [] };
    }

    // ══════════════════════════════════════
    //  COASTLINE SAMPLING
    // ══════════════════════════════════════

    function _trySampleCoast() {
        if (_coastReady) return;
        const src = _map.getSource('countries');
        if (!src) return;

        const data = CMapsGlobe.getCountriesData();
        if (!data || !data.features || data.features.length === 0) return;

        const step = 1.0;
        const allBorderPts = [];

        for (const feature of data.features) {
            if (!feature.geometry) continue;
            _sampleGeometry(feature.geometry, step, allBorderPts);
        }

        if (allBorderPts.length === 0) {
            console.warn('[CMapsParticles] No border points from', data.features.length, 'features');
            return;
        }

        // Build spatial hash (0.4° grid)
        const grid = new Map();
        const cellSize = 0.4;
        for (const p of allBorderPts) {
            const key = `${Math.floor(p.lng / cellSize)},${Math.floor(p.lat / cellSize)}`;
            grid.set(key, (grid.get(key) || 0) + 1);
        }

        // Coastline heuristic: cell with empty neighbors faces ocean
        _coastPoints = [];
        const seen = new Set();

        for (const p of allBorderPts) {
            const cx = Math.floor(p.lng / cellSize);
            const cy = Math.floor(p.lat / cellSize);
            const dedupKey = `${cx},${cy}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);

            let emptyNeighbors = 0;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    if (!grid.has(`${cx + dx},${cy + dy}`)) emptyNeighbors++;
                }
            }

            if (emptyNeighbors >= 2) {
                _coastPoints.push(p);
            }
        }

        console.log('[CMapsParticles] Coast sampling:', allBorderPts.length, 'border →', _coastPoints.length, 'coast pts');

        _coastReady = _coastPoints.length > 20;
        if (_coastReady) {
            _map.off('idle', _trySampleCoast);
            _seedWaves();
            console.log('[CMapsParticles] Shore waves seeded:', MAX_WAVE_PARTICLES, 'particles');
        }
    }

    function _sampleGeometry(geom, step, out) {
        if (!geom) return;
        if (geom.type === 'Polygon') {
            for (const ring of geom.coordinates) _sampleRing(ring, step, out);
        } else if (geom.type === 'MultiPolygon') {
            for (const poly of geom.coordinates)
                for (const ring of poly) _sampleRing(ring, step, out);
        } else if (geom.type === 'GeometryCollection' && geom.geometries) {
            for (const g of geom.geometries) _sampleGeometry(g, step, out);
        }
    }

    function _sampleRing(ring, step, out) {
        if (!ring || ring.length < 2) return;
        for (let i = 0; i < ring.length - 1; i++) {
            const [lng0, lat0] = ring[i];
            const [lng1, lat1] = ring[i + 1];
            const dist = Math.hypot(lng1 - lng0, lat1 - lat0);
            const n = Math.max(1, Math.floor(dist / step));
            for (let j = 0; j < n; j++) {
                const t = j / n;
                out.push({
                    lng: lng0 + (lng1 - lng0) * t,
                    lat: lat0 + (lat1 - lat0) * t,
                });
            }
        }
    }

    // ══════════════════════════════════════
    //  PARTICLE CREATION
    // ══════════════════════════════════════

    /** Seed ocean currents and wind immediately — no coast data needed */
    function _seedCurrentsAndWind() {
        if (!_currentsSeeded) {
            for (let i = 0; i < MAX_CURRENT_PARTICLES; i++) {
                _particles.currents.push(_newCurrentParticle());
            }
            _currentsSeeded = true;
            console.log('[CMapsParticles] Seeded', MAX_CURRENT_PARTICLES, 'current particles');
        }
        if (!_windSeeded) {
            for (let i = 0; i < MAX_WIND_PARTICLES; i++) {
                _particles.wind.push(_newWindParticle());
            }
            _windSeeded = true;
            console.log('[CMapsParticles] Seeded', MAX_WIND_PARTICLES, 'wind particles');
        }
    }

    /** Seed shore wave particles (requires coast data) */
    function _seedWaves() {
        _particles.waves = [];
        for (let i = 0; i < MAX_WAVE_PARTICLES; i++) {
            _particles.waves.push(_newWaveParticle());
        }
    }

    function _newWaveParticle() {
        const cp = _coastPoints[Math.floor(Math.random() * _coastPoints.length)];
        const angle = Math.random() * Math.PI * 2;
        const dist = 0.3 + Math.random() * 1.2;
        return {
            lng: cp.lng + Math.cos(angle) * dist,
            lat: cp.lat + Math.sin(angle) * dist * 0.7,
            tlng: cp.lng,
            tlat: cp.lat,
            life: Math.random(),
            speed: 0.003 + Math.random() * 0.004,
            size: 1.0 + Math.random() * 1.5,
            alpha: 0.15 + Math.random() * 0.25,
        };
    }

    function _newCurrentParticle() {
        const gyre = GYRES[Math.floor(Math.random() * GYRES.length)];
        const angle = Math.random() * Math.PI * 2;
        return {
            gyre,
            angle,
            life: Math.random(),
            speed: gyre.speed * (0.7 + Math.random() * 0.6),
            size: 1.0 + Math.random() * 1.0,
            alpha: 0.08 + Math.random() * 0.14,
            trail: 3 + Math.floor(Math.random() * 4),
        };
    }

    function _newWindParticle() {
        const belt = WIND_BELTS[Math.floor(Math.random() * WIND_BELTS.length)];
        const lat = belt.latMin + Math.random() * (belt.latMax - belt.latMin);
        const lng = -180 + Math.random() * 360;
        return {
            lng, lat, belt,
            life: Math.random(),
            speed: belt.speed * (0.6 + Math.random() * 0.8),
            size: 0.6 + Math.random() * 0.8,
            alpha: 0.06 + Math.random() * 0.10,
            trail: 4 + Math.floor(Math.random() * 5),
        };
    }

    // ══════════════════════════════════════
    //  MAIN ANIMATION LOOP
    // ══════════════════════════════════════

    function _loop(timestamp) {
        _raf = requestAnimationFrame(_loop);

        const elapsed = timestamp - _lastTime;
        if (elapsed < FRAME_INTERVAL) return;

        const dt = Math.min(elapsed / 1000, 0.1);
        _lastTime = timestamp;

        if (!_map || !_ctx) return;

        // Cache camera center for far-side culling (once per frame)
        _updateCenter();

        // Check what we can draw — currents/wind are independent of coast
        const hasCurrents = _currentsSeeded && _enabled.currents;
        const hasWind     = _windSeeded && _enabled.wind;
        const hasWaves    = _coastReady && _enabled.waves;

        if (!hasCurrents && !hasWind && !hasWaves) return;

        const zoom = _map.getZoom();
        const w = _canvas.clientWidth;
        const h = _canvas.clientHeight;

        // Don't render particles above zoom ~7
        if (zoom > 7.5) {
            _ctx.clearRect(0, 0, w, h);
            return;
        }

        // Global fade based on zoom
        const zoomAlpha = zoom < 3 ? 1.0 : zoom < 7.5 ? (7.5 - zoom) / 4.5 : 0;

        _ctx.clearRect(0, 0, w, h);

        if (hasWaves)    _updateAndDrawWaves(dt, zoomAlpha, w, h);
        if (hasCurrents) _updateAndDrawCurrents(dt, zoomAlpha, w, h);
        if (hasWind)     _updateAndDrawWind(dt, zoomAlpha, w, h);
    }

    // ══════════════════════════════════════
    //  SHORE WAVES
    // ══════════════════════════════════════

    function _updateAndDrawWaves(dt, zoomAlpha, w, h) {
        const particles = _particles.waves;
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.life += p.speed * 8 * dt;

            if (p.life >= 1) {
                particles[i] = _newWaveParticle();
                particles[i].life = 0;
                continue;
            }

            const t = p.life;
            const lng = p.lng + (p.tlng - p.lng) * t;
            const lat = p.lat + (p.tlat - p.lat) * t;

            if (_isFarSide(lng, lat)) continue;
            const pt = _map.project([lng, lat]);
            if (_isOffscreen(pt, w, h)) continue;

            const fade = t < 0.15 ? t / 0.15 : t > 0.7 ? (1 - t) / 0.3 : 1;
            const alpha = p.alpha * fade * zoomAlpha;
            if (alpha < 0.01) continue;

            _ctx.globalAlpha = alpha;
            _ctx.fillStyle = '#7dd3fc';
            _ctx.beginPath();
            _ctx.arc(pt.x, pt.y, p.size, 0, Math.PI * 2);
            _ctx.fill();
        }
    }

    // ══════════════════════════════════════
    //  OCEAN CURRENTS
    // ══════════════════════════════════════

    function _updateAndDrawCurrents(dt, zoomAlpha, w, h) {
        const particles = _particles.currents;
        _ctx.lineWidth = 1.2;
        _ctx.lineCap = 'round';

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const g = p.gyre;

            p.angle += p.speed * g.dir * dt;
            p.life += dt * 0.06;

            if (p.life >= 1) {
                particles[i] = _newCurrentParticle();
                particles[i].life = 0;
                continue;
            }

            const lng = g.cx + Math.cos(p.angle) * g.rx;
            const lat = g.cy + Math.sin(p.angle) * g.ry;

            if (_isFarSide(lng, lat)) continue;
            const pt = _map.project([lng, lat]);
            if (_isOffscreen(pt, w, h)) continue;

            const fade = p.life < 0.1 ? p.life / 0.1 : p.life > 0.85 ? (1 - p.life) / 0.15 : 1;
            const alpha = p.alpha * fade * zoomAlpha;
            if (alpha < 0.01) continue;

            _ctx.strokeStyle = 'rgba(56, 189, 248,' + alpha + ')';
            _ctx.beginPath();

            const trailStep = 0.008 * g.dir;
            let first = true;
            for (let t = 0; t <= p.trail; t++) {
                const a = p.angle - trailStep * t;
                const tx = g.cx + Math.cos(a) * g.rx;
                const ty = g.cy + Math.sin(a) * g.ry;
                const tp = _map.project([tx, ty]);
                if (first) { _ctx.moveTo(tp.x, tp.y); first = false; }
                else _ctx.lineTo(tp.x, tp.y);
            }
            _ctx.stroke();

            _ctx.globalAlpha = alpha * 1.4;
            _ctx.fillStyle = '#bae6fd';
            _ctx.beginPath();
            _ctx.arc(pt.x, pt.y, p.size, 0, Math.PI * 2);
            _ctx.fill();
        }
    }

    // ══════════════════════════════════════
    //  WIND STREAMS
    // ══════════════════════════════════════

    function _updateAndDrawWind(dt, zoomAlpha, w, h) {
        const particles = _particles.wind;
        _ctx.lineWidth = 0.8;
        _ctx.lineCap = 'round';

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const b = p.belt;

            p.lng += p.speed * b.dir * dt * 60;
            p.lat += Math.sin(p.lng * 0.05 + p.life * 10) * 0.015;

            if (p.lng > 180) p.lng -= 360;
            if (p.lng < -180) p.lng += 360;
            p.lat = Math.max(b.latMin, Math.min(b.latMax, p.lat));

            p.life += dt * 0.04;
            if (p.life >= 1) {
                particles[i] = _newWindParticle();
                particles[i].life = 0;
                continue;
            }

            if (_isFarSide(p.lng, p.lat)) continue;
            const pt = _map.project([p.lng, p.lat]);
            if (_isOffscreen(pt, w, h)) continue;

            const fade = p.life < 0.08 ? p.life / 0.08 : p.life > 0.85 ? (1 - p.life) / 0.15 : 1;
            const alpha = p.alpha * fade * zoomAlpha;
            if (alpha < 0.01) continue;

            const trailLng = p.lng - b.dir * p.trail * 0.25;
            const pt2 = _map.project([trailLng, p.lat]);

            _ctx.strokeStyle = 'rgba(199, 210, 254,' + alpha + ')';
            _ctx.globalAlpha = 1;
            _ctx.beginPath();
            _ctx.moveTo(pt2.x, pt2.y);
            _ctx.lineTo(pt.x, pt.y);
            _ctx.stroke();

            _ctx.globalAlpha = alpha * 1.3;
            _ctx.fillStyle = '#e0e7ff';
            _ctx.beginPath();
            _ctx.arc(pt.x, pt.y, p.size * 0.7, 0, Math.PI * 2);
            _ctx.fill();
        }
    }

    // ══════════════════════════════════════
    //  UTILITIES
    // ══════════════════════════════════════

    // Globe far-side culling — hide particles on the back of the sphere
    const DEG2RAD = Math.PI / 180;
    let _sinCLat = 0, _cosCLat = 1, _cLngRad = 0;

    /** Cache camera center once per frame for far-side checks. */
    function _updateCenter() {
        const c = _map.getCenter();
        const lat = c.lat * DEG2RAD;
        _cLngRad = c.lng * DEG2RAD;
        _sinCLat = Math.sin(lat);
        _cosCLat = Math.cos(lat);
    }

    /** True if [lng, lat] is on the invisible back side of the globe. */
    function _isFarSide(lng, lat) {
        const pLat = lat * DEG2RAD;
        const dLng = lng * DEG2RAD - _cLngRad;
        // dot product of camera→point on unit sphere; < 0.05 = behind horizon
        return (_sinCLat * Math.sin(pLat) + _cosCLat * Math.cos(pLat) * Math.cos(dLng)) < 0.05;
    }

    function _isOffscreen(pt, w, h) {
        if (!pt || isNaN(pt.x) || isNaN(pt.y)) return true;
        return pt.x < -20 || pt.y < -20 || pt.x > w + 20 || pt.y > h + 20;
    }

    function toggle(key, visible) {
        if (key in _enabled) _enabled[key] = visible;
    }

    function isEnabled(key) {
        return !!_enabled[key];
    }

    return { init, destroy, toggle, isEnabled };
})();
