# SAEZ-ATCCTRL (OCC Map)

App web estática (HTML/CSS/JS) para visualizar posiciones en mapa satelital (SAEZ) + tarjetas de vuelos (ARR/DEP/TA),
con **modo editor** protegido por contraseña.

## Qué incluye
- Mapa satélite (Esri World Imagery) centrado en Ezeiza.
- Oscurecimiento del mapa para resaltar overlays (CSS filter).
- Modo Editor (password: **12345678**):
  - Click en mapa → crear posición (nombre + HDG).
  - Lista lateral con editar/eliminar.
  - Se guarda en `localStorage` (persistente en tu navegador).
- Lectura de datos desde Google Sheets via **Apps Script** (JSONP para evitar CORS).
- Vuelos:
  - Arribos (tams_arribos1): B vuelo, D matrícula, E posición, F hora arribo asignada, G aterrizaje real, I origen, J estado.
  - Salidas (tams_salidas1): B vuelo, C hora salida, F hora salida actualizada (reemplaza C), D matrícula, E posición, G despegue, H puerta, I destino, J estado.
  - Omite filas con remarks CON / CAN / ALT (ver Code.gs).
- Movimientos tipo `72>50B`: dibuja flecha desde la primera pos hacia la siguiente (si ambas posiciones existen en el editor).
- Timelapse básico (simula reloj; filtra/actualiza estados por horario cuando existe).

## Cómo usar (rápido)
1. Abrí `index.html` con un servidor local (recomendado):
   - VS Code → extensión **Live Server** → "Go Live"
2. Desplegá el Apps Script como **Web App** (ver carpeta `apps_script/Code.gs`).
3. Copiá la URL del Web App.
4. En la app: botón **Refrescar** → pegás la URL cuando te la pida.

## Nota importante (CORS)
Esta app usa **JSONP** para poder leer datos desde un HTML servido localmente.
Por eso el Apps Script soporta `?callback=...`.

---

Si querés que las posiciones se guarden en el Sheet/Drive en vez de localStorage, decímelo y lo conectamos.
