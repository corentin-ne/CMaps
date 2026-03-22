# Project Roadmap & Task Tracker

## 1. Core Editor Mechanics & Workflows
*Streamlining the user experience for map manipulation.*
- [x] **Revamp "Edit Region" System:** Completely remove the legacy drawing-based mechanics. Implement a strict click-to-transfer region system. Workflow: Select parent country > enter "Add Regions" mode > click existing regions (from other countries or unassigned) to instantly reassign them and trigger the aggregation engine.

## 2. Geography & 3D Visuals
*Normalizing the map data and expanding geographical landmarks.*
- [x] **Normalize 3D Topography:** Remove the hyper-detailed, localized DEM data (currently restricting topography to specific European regions). Implement a uniform, low-resolution global topological model, or disable 3D terrain entirely to maintain global visual consistency.
- [x] **Geographical Landmarks:** Parse and integrate GeoJSON layers for major global features, adding visual representations and labels for mountain ranges, major lakes, and river systems.
- [x] **Integrate Cities:** Add major cities as 3D markers or glowing nodes that dynamically contribute to their parent region's population and economic statistics.
- [x] **Refine Region Granularity:** Audit and separate macro-regions into fine-grained polygons to accurately represent archipelagos, exclaves, and distinct coastal islands.

## 3. Data Portability & Polish
*Ensuring the map states can be persisted and shared.*
- [x] **Implement Export/Save Functionality:** Build an export pipeline allowing users to download their customized world state as a standard GeoJSON bundle or a proprietary save file for external sharing and local backups.