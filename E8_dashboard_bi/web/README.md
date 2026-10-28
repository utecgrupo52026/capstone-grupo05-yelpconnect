# Dashboard YelpConnect (Angular)

Dashboard estático de Trust & Safety, ML y calidad de datos. Consume **solo** el snapshot
JSON de `public/data/`, generado por los scripts de [`local/`](../../local/README.md).

```bash
npm install
npm start          # http://localhost:4200
npm run build      # dist/web/browser
```

**Netlify:** New site → Import from Git → *Base directory* `E8_dashboard_bi/web`.
El resto (build, publish, redirects SPA) está en `netlify.toml`.

Para actualizar los datos: ejecutar `local/exportar_gold.py` y `local/ml_anomalias.py`,
commitear `public/data/*.json` y hacer push; Netlify vuelve a publicar solo.
