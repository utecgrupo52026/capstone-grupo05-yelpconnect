# local/ — herramientas que corren en la laptop

Scripts Python que leen la capa gold/gov de Databricks y generan el snapshot JSON del
dashboard (`E8_dashboard_bi/web/public/data/`). Arquitectura completa en
[`ARQUITECTURA_DASHBOARD_ML.md`](../ARQUITECTURA_DASHBOARD_ML.md).

| Script | Qué hace |
|---|---|
| `exportar_gold.py` | Lee `yelp_gold` + `yelp_gov` → `meta`, `overview`, `monthly`, `rules`, `businesses`, `queue`, `dq` (.json) |
| `ml_anomalias.py` | Isolation Forest sobre `slv_review_features`, compara contra `slv_review_risk` → `ml_resumen`, `ml_top` (.json) |

Ambos aceptan `--demo` (datos sintéticos, sin Databricks) y `--verificar` (revisa tablas y columnas).

## 1. Obtener credenciales de Databricks (una sola vez)

**Token personal (PAT)**
1. En Databricks, clic en tu usuario (arriba a la derecha) → **Settings**.
2. **Developer** → **Access tokens** → **Manage** → **Generate new token**.
3. Comentario: `dashboard-local`, vigencia: 90 días → **Generate**.
4. Copia el valor (empieza con `dapi…`). Solo se muestra una vez.

**Datos del SQL Warehouse**
1. Menú izquierdo → **SQL Warehouses** → abre el warehouse (en Free Edition: *Serverless Starter Warehouse*).
2. Pestaña **Connection details** → copia **Server hostname** y **HTTP path**.

**Guardarlas**
```bash
cp .env.example .env     # y completa los 3 valores
```
`.env` está en `.gitignore`: **nunca** se sube al repo ni se pega en chats o documentos.

## 2. Instalar y ejecutar

```powershell
cd local
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

python exportar_gold.py --verificar   # 1) ¿existen las tablas/columnas esperadas?
python ml_anomalias.py --verificar
python exportar_gold.py               # 2) snapshot gold → JSON
python ml_anomalias.py                # 3) modelo → JSON (+ --publicar para crear gld_review_anomaly_ml)
```

Después: `cd ../E8_dashboard_bi/web && npm install && npm start` → http://localhost:4200

> El warehouse serverless consume cuota diaria de Free Edition: el exportador solo trae
> agregados y tops; el script de ML sí trae todas las filas de features (una lectura por corrida).
