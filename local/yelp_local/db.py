"""
Conexión al SQL Warehouse de Databricks desde la laptop.

Las credenciales se leen de local/.env (ignorado por git). Nunca se escriben
en los JSON ni en el dashboard: el navegador solo ve agregados ya exportados.
"""
import os
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

CATALOGO = "workspace"
GOLD = f"{CATALOGO}.yelp_gold"
SILVER = f"{CATALOGO}.yelp_silver"
GOV = f"{CATALOGO}.yelp_gov"

_ENV = Path(__file__).resolve().parents[1] / ".env"


def conectar(staging_dir: str | None = None):
    """Abre una conexión al SQL Warehouse. staging_dir habilita PUT a Volumes."""
    from databricks import sql  # import diferido: el modo --demo no lo necesita

    load_dotenv(_ENV)
    faltan = [k for k in ("DATABRICKS_SERVER_HOSTNAME", "DATABRICKS_HTTP_PATH", "DATABRICKS_TOKEN")
              if not os.getenv(k)]
    if faltan:
        raise SystemExit(f"Faltan variables en {_ENV}: {', '.join(faltan)} (ver .env.example)")

    extra = {"staging_allowed_local_path": staging_dir} if staging_dir else {}
    return sql.connect(
        server_hostname=os.environ["DATABRICKS_SERVER_HOSTNAME"],
        http_path=os.environ["DATABRICKS_HTTP_PATH"],
        access_token=os.environ["DATABRICKS_TOKEN"],
        **extra,
    )


def consultar(conn, query: str) -> pd.DataFrame:
    """Ejecuta una consulta y devuelve un DataFrame (vía Arrow)."""
    with conn.cursor() as cur:
        cur.execute(query)
        return cur.fetchall_arrow().to_pandas()


def ejecutar(conn, statement: str) -> None:
    with conn.cursor() as cur:
        cur.execute(statement)


def verificar_columnas(conn, esperado: dict[str, list[str]]) -> bool:
    """Comprueba que cada tabla exista y tenga las columnas que el script consulta."""
    ok = True
    for tabla, columnas in esperado.items():
        try:
            existentes = set(consultar(conn, f"DESCRIBE TABLE {tabla}")["col_name"])
        except Exception as e:  # noqa: BLE001 — se reporta y se sigue con la siguiente tabla
            print(f"✗ {tabla}: no accesible ({str(e).splitlines()[0][:120]})")
            ok = False
            continue
        faltan = [c for c in columnas if c not in existentes]
        print(f"{'✓' if not faltan else '✗'} {tabla}" + (f"  — faltan: {faltan}" if faltan else ""))
        ok &= not faltan
    print("\nTodo listo." if ok else "\nHay diferencias: ajustar las consultas antes de ejecutar.")
    return ok
