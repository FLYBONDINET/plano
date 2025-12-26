# EZE Plataforma OPS

Local-first para operación de plataforma:
- Estados: ARR/DEP/TRN/NS/MX (colores por estado)
- Bloqueo duro de stands (1 stand = 1 avión), override Supervisor/Admin
- Roles: OPERATOR / SUPERVISOR / ADMIN
- Auditoría con snapshots (timeline)
- Capas: importar GeoJSON overlay (calles/zonas)
- Import/Export JSON backup
- Sync opcional (Apps Script stub en /backend)

## Ejecutar
Abrí index.html (recomendado Live Server).

## Sync opcional
En js/app.js poné SYNC.enabled=true y SYNC.endpoint=URL del WebApp.
Luego editá backend/apps_script.gs con tu SHEET_ID.

Generado: 2025-12-26T18:49:41.106967
