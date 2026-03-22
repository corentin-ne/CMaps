# Cities Visibility Debug Log (CMaps)

This file summarizes all major attempts made to fix the issue where city dots were not visible on the globe.

---

## Initial Symptoms

- Cities were not visible at all.
- Capitals and other layers were partly working.
- Particle effects had their own issues at first.

---

## What Was Tried (Chronological)

## 1) Particle and z-index cleanup (early supporting fixes)

### Changes
- Fixed particle system initialization so non-coast effects (currents/wind) could start even before coast data was ready.
- Adjusted canvas/vignette stacking (`z-index`) so particles could be seen.

### Result
- Particle visibility improved.
- Did **not** solve missing cities.

---

## 2) First city architecture: multi-tier city layers by population

### Changes
- Replaced single city layer with multiple tiers (`mega`, `major`, `large`, `medium`, `small`, `tiny`).
- Added separate glow/dot/label layers per tier.
- Used filter expressions and zoom gates.

### Result
- Cities still invisible.

---

## 3) Filter syntax migration (expression -> legacy syntax)

### Why
- Suspected MapLibre filter parsing mismatch.

### Changes
- Rewrote filters from expression-style (e.g. `['>=', ['get', ...], ...]`) to legacy property-filter style (e.g. `['>=', 'pop_max', ...]`).

### Result
- Cities still invisible.

---

## 4) Single-layer city approach (radius/opacity expressions)

### Changes
- Abandoned multi-tier filters.
- Moved to one city source + one dot layer (+ glow/labels) using zoom/population expressions.
- Simplified click/hover handling and layer toggles.

### Result
- Still not visible.

---

## 5) Camera/menu cleanup requested by user

### Changes
- Set default map pitch to `0` (straight-on center view).
- Reorganized layer menu groups (Political / Places / Physical / Effects).

### Result
- UI improved, but cities still missing.

---

## 6) Deep data validation (backend + API)

### Verified
- Raw data file `ne_10m_populated_places_simple.geojson` exists and has valid Point geometries.
- API `/api/cities?zoom=20` returns large non-empty payload (thousands of features).
- `pop_max` values and properties looked valid.

### Result
- Confirmed problem was not simple "no data in file".

---

## 7) Added diagnostics into frontend

### Changes
- Added explicit runtime logs around city loading.
- Wrapped layer additions with `try/catch`.
- Added temporary on-screen hints/toasts for city count.

### Result
- Revealed city load path instability and inconsistent runtime behavior.

---

## 8) Hardcoded red test dots (manual source)

### Changes
- Injected 5 hardcoded test points (Tokyo, Paris, London, Moscow, NYC) as a separate source/layer.

### Result
- Red dots rendered correctly.
- This proved map rendering itself worked.

---

## 9) Intermediate bug discovered during debug edits

### Issue found
- A duplicate leftover layer block / duplicate closing sequence around city label code caused city layer setup to break.

### Changes
- Removed duplicate city label add block and cleanuped function structure.

### Result
- Removed one concrete failure source, but user still reported missing actual city set.

---

## 10) Retry + cache-busting fetch logic

### Changes
- Added direct city fetch retries with timestamp query (`_t=...`) to avoid stale responses.
- Attempted to bypass IndexedDB/API wrapper behavior.

### Result
- Still inconsistent in user view.

---

## 11) Critical cache finding from server logs

### Observation
- Server logs showed browser still requesting older script version (`globe.js?v=20`) even after updates.

### Changes
- Added `Cache-Control: no-cache, no-store, must-revalidate` for `/` (index.html) in `app.py`.
- Restarted server.

### Result
- Ensured new HTML/script references are fetched more reliably.

---

## 12) Final structural change for cities source

### Changes
- Reworked cities source to let MapLibre load cities directly by URL in source config:
  - `data: '/api/cities?zoom=20'`
- This bypasses JS-side object plumbing for cities.

### Result
- Applied as latest direction to remove client-side data handling as a potential fault source.

---

## 13) Requested removals applied

### Changes
- Removed/disabled wind, waves, and ocean currents effects.
- Removed red diagnostic dots from final path.

### Result
- Reduced visual noise and potential interactions.

---

## Additional Notes

- Multiple cache-version bumps were applied to force script/style refresh.
- Several rounds of hard refresh were required due to stale browser content.
- The issue behaved as a combination of:
  1. iterative code regression from repeated emergency edits,
  2. stale frontend assets (cached HTML/script),
  3. and brittle city-layer construction while debugging.

---

## Current State (at time of writing)

- A complete historical trail of city-visibility fixes has been documented.
- The project has moved to a simpler, direct city source loading path.
- Particle effects and debug red dots were removed per user request.

---

Created to preserve troubleshooting history and avoid repeating dead-end attempts.


latest attempt (did not work):

Gemini a dit
The issue stems from a fatal 500 Internal Server Error occurring silently in the backend /api/cities route.

In the Natural Earth GeoJSON dataset, properties like featurecla, name, and nameascii are frequently set to null rather than an empty string. When your code evaluates props.get("featurecla", ""), the dictionary key is present but its value is None. Attempting to chain .lower() onto a NoneType object triggers an AttributeError, crashing the entire response. Because MapLibre fetches this source asynchronously, the map renders everything else but skips the failed cities layer without alerting the UI.

To enforce memory safety against dirty or missing JSON properties, the parsing logic has been hardened to gracefully handle None fallbacks.
