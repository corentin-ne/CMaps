# Project Roadmap & Task Tracker

## Phase 1: 3D Engine & Rendering Foundation
*The core visual and performance pipeline. Must be flawless before adding interactive complexity.*
- [x] **Implement Camera Controls:** Add smooth pan, zoom, rotate constraints, and "fly-to" camera transition animations for selections.
- [x] **Integrate 3D Topography/Altitude:** Apply DEM/heightmap data for physical terrain variations (mountains, valleys).
- [x] **Optimize Rendering Performance:** Implement WebGL optimizations (instanced rendering, simplified geometries at high zoom, GeoJSON-VT) to lock in 60FPS.
- [x] **Implement Data Caching:** Use IndexedDB or Service Workers for GeoJSON/TopoJSON asset delivery to ensure near-instant subsequent loads.

## Phase 2: Data Architecture & State Management
*The underlying schemas and logic required to calculate and maintain global state.*
- [x] **Expand Dynamic Data Schema:** Update Country and Region models to support Area, Population, GDP, and custom typed fields.
- [x] **Build Relational Aggregation Engine:** Implement strict parent-child logic (Country = Σ Regions). Automate recalculations when child node data changes.
- [x] **Implement Data Validation:** Add sanitization and strict typing for inputs (e.g., block negative areas, ensure numeric GDP).
- [x] **Develop History State (Undo/Redo):** Build a robust stack history system to forgive misclicks and safeguard map editing.

## Phase 3: Core Interactivity & Editing Mechanics
*The primary tools for the map editor loop.*
- [x] **Refine Selection Mechanics:** Add clean hover states and visual outlines for selecting countries and internal regions.
- [x] **Add Map Context Menus:** Implement a minimalistic right-click menu directly on the 3D map for quick actions (Edit Data, Make Independent, Change Flag).
- [x] **Develop "Add Region" Workflow:** Enable multi-selection mode to assign unassigned or assigned regions to a parent country and trigger the aggregation engine.
- [x] **Develop "Independence" Workflow:** Allow detaching a region to spawn a new sovereign country entity, automatically recalculating the former parent's stats.
- [x] **Implement Country Deletion Logic:** Cascade deletions to either remove child regions or return them to an "unclaimed" state, updating global counters.

## Phase 4: Geographic Enhancements & Asset Integration
*Adding granularity and life to the map data.*
- [x] **Refine Region Granularity:** Separate macro-regions into fine-grained polygons (e.g., splitting archipelagos and distinct islands).
- [x] **Handle "Unclaimed" Territories:** Create a distinct visual style (greyed out or hatched patterns) for unassigned landmasses.
- [x] **Integrate Cities:** Add cities as 3D markers/glowing nodes that dynamically contribute to their parent region's population statistics.
- [x] **Build Advanced Flag System:** Support transparent PNG/SVG uploads for non-rectangular flags. Map these to UI panels and optional 3D textures.

## Phase 5: UI, UX, & Gamification (The Polish)
*Modernizing the interface and making the software satisfying to use.*
- [x] **Add Dynamic Map Scale Bar:** Implement a real-world distance indicator (e.g., a 1km/100mi visual line) that updates based on the current zoom level.
- [x] **Overhaul Theme (Light Mode Default):** Transition to a clean, bright, modern aesthetic with vibrant map colors and soft shadows, retaining a dark mode toggle.
- [x] **Create Global Leaderboards Panel:** Build a minimalistic overlay highlighting global stats ("Richest Country", "Most Populated", "Largest Empire").
- [x] **Implement Export/Save Functionality:** Allow exporting the customized world state as a standard GeoJSON or proprietary save file for sharing.