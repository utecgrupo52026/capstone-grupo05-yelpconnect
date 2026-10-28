"""Escritura de los JSON que consume el dashboard Angular."""
import hashlib
import json
import math
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd

# Carpeta servida por Angular como /data/*.json
DATA_DIR = Path(__file__).resolve().parents[2] / "E8_dashboard_bi" / "web" / "public" / "data"


def _limpiar(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, (pd.Timestamp, datetime, date)):
        return v.isoformat()[:10] if isinstance(v, date) and not isinstance(v, datetime) else v.isoformat()
    if hasattr(v, "item"):  # escalares numpy
        return _limpiar(v.item())
    if v is pd.NA or v is pd.NaT:
        return None
    return v


def registros(df: pd.DataFrame) -> list[dict]:
    return [{k: _limpiar(v) for k, v in fila.items()} for fila in df.to_dict(orient="records")]


def escribir(nombre: str, contenido) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if isinstance(contenido, pd.DataFrame):
        contenido = registros(contenido)
    ruta = DATA_DIR / f"{nombre}.json"
    ruta.write_text(json.dumps(contenido, ensure_ascii=False, indent=1, default=_limpiar), encoding="utf8")
    print(f"  → {ruta.relative_to(DATA_DIR.parents[3])}")
    return ruta


def hash_corto(valor: str | None) -> str | None:
    """Seudonimiza identificadores de usuario antes de publicarlos."""
    if valor is None:
        return None
    return "u_" + hashlib.sha256(str(valor).encode()).hexdigest()[:10]


def ahora_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
