from pyspark.sql import functions as F

import hashlib


# ============================================================
# 1. CONFIGURACIÓN GENERAL
# ============================================================

CATALOG = "workspace"

BRONZE_SCHEMA = "yelp_bronze"

RAW = (
    "/Volumes/workspace/"
    "yelp_bronze/raw"
)

SOURCE_SYSTEM = "YELP"

LAYER = "bronze"


# ============================================================
# 2. METADATA TÉCNICA BRONZE
# ============================================================

METADATA_COLUMNS = [
    "_archivo_origen",
    "_fecha_ingesta",
    "_source_system",
    "_source_entity",
    "_pipeline_name",
    "_execution_id",
    "_layer",
    "_schema_hash",
    "_record_checksum"
]


# ============================================================
# 3. VALIDAR SCHEMA BRONZE
# ============================================================

def assert_bronze_schema_exists(
    spark
):

    full_schema = (
        f"{CATALOG}."
        f"{BRONZE_SCHEMA}"
    )

    try:

        spark.sql(
            f"""
            DESCRIBE SCHEMA
            {full_schema}
            """
        )

    except Exception as exc:

        raise RuntimeError(
            f"""
            ❌ No existe el schema Bronze.

            Schema:
            {full_schema}

            Ejecutar primero:
            00_setup/01_configurar_lakehouse
            """
        ) from exc

    return full_schema


# ============================================================
# 4. VALIDAR VOLUME RAW
# ============================================================

def validate_raw_volume(
    dbutils
):

    try:

        raw_files = (
            dbutils.fs.ls(
                RAW
            )
        )

    except Exception as exc:

        raise RuntimeError(
            f"""
            ❌ No fue posible acceder al Volume RAW.

            Ruta:
            {RAW}
            """
        ) from exc


    if not raw_files:

        raise RuntimeError(
            f"""
            ❌ El Volume RAW está vacío.

            Ruta:
            {RAW}
            """
        )


    return raw_files


# ============================================================
# 5. VALIDAR ARCHIVOS REQUERIDOS
# ============================================================

def validate_required_files(
    raw_files,
    required_files
):

    available_files = {
        file.name
        for file in raw_files
    }


    missing_files = (
        set(required_files)
        -
        available_files
    )


    if missing_files:

        raise RuntimeError(
            f"""
            ❌ Faltan archivos RAW requeridos.

            Archivos faltantes:
            {sorted(missing_files)}
            """
        )


    return True


# ============================================================
# 6. AGREGAR METADATA TÉCNICA BRONZE
# ============================================================

def add_bronze_metadata(
    df,
    entity,
    execution_id,
    pipeline_name,
    source_file_expression
):

    # --------------------------------------------------------
    # Columnas originales RAW
    # --------------------------------------------------------

    source_columns = sorted(
        df.columns
    )


    # --------------------------------------------------------
    # Fingerprint del schema
    # --------------------------------------------------------

    schema_json = (
        df
        .schema
        .json()
    )


    schema_hash = (
        hashlib
        .sha256(
            schema_json.encode(
                "utf-8"
            )
        )
        .hexdigest()
    )


    # --------------------------------------------------------
    # Representación determinística del registro
    # --------------------------------------------------------

    record_json = (

        F.to_json(

            F.struct(
                *[
                    F.col(c)
                    for c
                    in source_columns
                ]
            ),

            options={
                "ignoreNullFields":
                "false"
            }
        )
    )


    # --------------------------------------------------------
    # Metadata Bronze
    # --------------------------------------------------------

    return (

        df

        .withColumn(
            "_archivo_origen",
            source_file_expression
        )

        .withColumn(
            "_fecha_ingesta",
            F.current_timestamp()
        )

        .withColumn(
            "_source_system",
            F.lit(
                SOURCE_SYSTEM
            )
        )

        .withColumn(
            "_source_entity",
            F.lit(
                entity
            )
        )

        .withColumn(
            "_pipeline_name",
            F.lit(
                pipeline_name
            )
        )

        .withColumn(
            "_execution_id",
            F.lit(
                execution_id
            )
        )

        .withColumn(
            "_layer",
            F.lit(
                LAYER
            )
        )

        .withColumn(
            "_schema_hash",
            F.lit(
                schema_hash
            )
        )

        .withColumn(
            "_record_checksum",
            F.sha2(
                record_json,
                256
            )
        )
    )


# ============================================================
# 7. APLICAR METADATA UNITY CATALOG
# ============================================================

def apply_bronze_uc_metadata(
    spark,
    table_name,
    entity,
    description,
    criticality="medium",
    classification="internal",
    retention_class="raw_source"
):

    """
    Aplica metadata descriptiva y tags de Unity Catalog
    a una tabla Bronze existente.

    No modifica el contenido de la tabla.
    """


    safe_description = (
        description
        .replace(
            "'",
            "''"
        )
    )


    # --------------------------------------------------------
    # COMMENT ON TABLE
    # --------------------------------------------------------

    spark.sql(
        f"""
        COMMENT ON TABLE {table_name}
        IS '{safe_description}'
        """
    )


    print(
        f"✔ COMMENT aplicado: "
        f"{table_name}"
    )


    # --------------------------------------------------------
    # TAGS UNITY CATALOG
    # --------------------------------------------------------

    try:

        spark.sql(
            f"""
            ALTER TABLE {table_name}
            SET TAGS (
                'data_layer' = 'bronze',
                'data_domain' = 'yelp_source',
                'data_product' = 'bronze_ingestion',
                'source_system' = 'yelp',
                'classification' = '{classification}',
                'criticality' = '{criticality}',
                'retention_class' = '{retention_class}',
                'entity' = '{entity}'
            )
            """
        )


        print(
            f"✔ TAGS aplicados: "
            f"{table_name}"
        )


    except Exception as exc:

        print(
            f"⚠ No fue posible aplicar "
            f"TAGS a {table_name}"
        )

        print(
            f"Detalle: {exc}"
        )


# ============================================================
# 8. COMENTARIOS DE COLUMNAS TÉCNICAS
# ============================================================

def apply_bronze_metadata_column_comments(
    spark,
    table_name
):

    column_comments = {

        "_archivo_origen":
            "Archivo RAW que originó el registro.",

        "_fecha_ingesta":
            "Timestamp de ingestión del registro en la capa Bronze.",

        "_source_system":
            "Sistema origen del registro. Para YelpConnect corresponde a YELP.",

        "_source_entity":
            "Entidad de origen del registro.",

        "_pipeline_name":
            "Pipeline responsable de la ingesta.",

        "_execution_id":
            "Identificador único de la ejecución que generó el registro.",

        "_layer":
            "Capa del Lakehouse. Para estas tablas corresponde a bronze.",

        "_schema_hash":
            "SHA-256 del schema fuente utilizado como fingerprint estructural.",

        "_record_checksum":
            "SHA-256 del contenido original del registro utilizado para trazabilidad e integridad."
    }


    existing_columns = {
        field.name
        for field
        in spark.table(
            table_name
        ).schema.fields
    }


    for (
        column_name,
        comment
    ) in column_comments.items():

        if (
            column_name
            not in existing_columns
        ):

            continue


        safe_comment = (
            comment.replace(
                "'",
                "''"
            )
        )


        spark.sql(
            f"""
            ALTER TABLE {table_name}
            ALTER COLUMN {column_name}
            COMMENT '{safe_comment}'
            """
        )


    print(
        f"✔ Comentarios técnicos aplicados: "
        f"{table_name}"
    )


# ============================================================
# 9. VALIDAR METADATA BRONZE
# ============================================================

def validate_bronze_metadata(
    df
):

    missing_columns = [
        column
        for column
        in METADATA_COLUMNS
        if column
        not in df.columns
    ]


    return {
        "metadata_ok":
            len(
                missing_columns
            )
            ==
            0,

        "missing_columns":
            missing_columns
    }