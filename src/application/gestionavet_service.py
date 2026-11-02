"""Servicio de Integración e Ingesta de Tratamientos y Recetas desde Gestionavet."""
from __future__ import annotations

import csv
import io
import logging
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("ganaderos.gestionavet")


def normalizar_fecha_es(fecha_str: str) -> str:
    """Convierte fechas en formato DD-MM-AAAA o DD/MM/AAAA a formato ISO AAAA-MM-DD."""
    if not fecha_str:
        return ""
    limpia = fecha_str.strip().strip('"').strip("'")
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(limpia, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return limpia


def _normalizar_clave(k: str) -> str:
    """Normaliza nombres de columnas CSV eliminando caracteres no alfanuméricos."""
    sin_tildes = (
        k.upper()
        .replace("Á", "A")
        .replace("É", "E")
        .replace("Í", "I")
        .replace("Ó", "O")
        .replace("Ú", "U")
    )
    return re.sub(r"[^A-Z0-9]", "", sin_tildes)


def parsear_csv_tratamientos(csv_texto: str) -> List[Dict[str, Any]]:
    """Parsea el contenido CSV del Libro Oficial de Tratamientos de Gestionavet."""
    if not csv_texto or not csv_texto.strip():
        return []

    f = io.StringIO(csv_texto.strip())
    reader = csv.reader(f, delimiter=";")
    try:
        headers_raw = next(reader)
    except StopIteration:
        return []

    # Mapeo de cabeceras normalizadas a campos estándar
    col_map: Dict[int, str] = {}
    for idx, h in enumerate(headers_raw):
        norm = _normalizar_clave(h)
        if "FECHASDEADMINISTRACION" in norm or "FECHASADMINISTRACION" in norm:
            col_map[idx] = "fecha_admin"
        elif "CODIGODERECETA" in norm or "CODIGORECETA" in norm:
            col_map[idx] = "receta"
        elif "MEDICAMENTO" in norm:
            col_map[idx] = "medicamento"
        elif "VETERIANARIO" in norm or "VETERINARIO" in norm:
            col_map[idx] = "veterinario"
        elif "CANTIDAD" in norm and idx not in col_map:
            col_map[idx] = "dosis"
        elif "NATURALEZATRATAMIENTO" in norm or "NATURALEZA" in norm:
            col_map[idx] = "naturaleza"
        elif "INDICACIONES" in norm:
            col_map[idx] = "indicaciones"
        elif "IDENTIFICACIONANIMAL" in norm or "LOTEANIMALES" in norm:
            col_map[idx] = "crotal"
        elif "FECHAINICIOTRATAMIENTO" in norm:
            col_map[idx] = "fecha_inicio"
        elif "FECHAFINTRATAMIENTO" in norm:
            col_map[idx] = "fecha_fin"
        elif "PROVEEDOR" in norm:
            col_map[idx] = "proveedor"
        elif "TIEMPOESPERA" in norm:
            col_map[idx] = "tiempo_espera"

    registros: List[Dict[str, Any]] = []
    for row in reader:
        if not row or not any(row):
            continue
        item: Dict[str, Any] = {}
        for idx, val in enumerate(row):
            campo = col_map.get(idx)
            if campo:
                item[campo] = val.strip().strip('"')

        # Si no hay crotal ni medicamento, omitir
        if not item.get("crotal") and not item.get("medicamento"):
            continue

        item["fecha_inicio"] = normalizar_fecha_es(item.get("fecha_inicio") or item.get("fecha_admin", ""))
        item["fecha_fin"] = normalizar_fecha_es(item.get("fecha_fin") or item.get("fecha_inicio", ""))
        item["causa"] = item.get("naturaleza") or item.get("indicaciones", "")
        registros.append(item)

    return registros


def guardar_tratamientos_gestionavet_en_bd(
    conn: sqlite3.Connection,
    tratamientos: List[Dict[str, Any]],
    cea_por_defecto: str = "",
) -> Dict[str, int]:
    """Inserta recetas y tratamientos de Gestionavet con origen='gestionavet' de forma idempotente."""
    conn.row_factory = sqlite3.Row
    nuevas_recetas = 0
    nuevos_tratamientos = 0

    with conn:
        for t in tratamientos:
            cod_receta = (t.get("receta") or "").strip()
            medicamento = (t.get("medicamento") or "").strip()
            vet = (t.get("veterinario") or "").strip()
            fecha_rec = t.get("fecha_inicio") or ""
            crotal = (t.get("crotal") or "").strip()
            dosis = (t.get("dosis") or "").strip()
            causa = (t.get("causa") or "").strip()

            # 1. Gestionar Receta
            receta_id: Optional[int] = None
            if cod_receta:
                cur = conn.execute("SELECT id FROM recetas WHERE receta = ?", (cod_receta,))
                row_rec = cur.fetchone()
                if row_rec:
                    receta_id = row_rec["id"]
                else:
                    cur_ins = conn.execute(
                        """
                        INSERT INTO recetas (
                            fecha, receta, medicamento, unidades, dosis_unitaria,
                            n_animales, veterinario, cea, origen
                        ) VALUES (?, ?, ?, 1.0, 1.0, 1, ?, ?, 'gestionavet')
                        """,
                        (fecha_rec, cod_receta, medicamento, vet, cea_por_defecto),
                    )
                    receta_id = cur_ins.lastrowid
                    nuevas_recetas += 1

            # 2. Gestionar Tratamiento individual
            # Comprobación de duplicados (mismo crotal, misma fecha_inicio, mismo medicamento y origen gestionavet)
            cur_t = conn.execute(
                """
                SELECT id FROM tratamientos
                WHERE crotal = ? AND fecha_inicio = ? AND medicamento = ? AND origen = 'gestionavet'
                """,
                (crotal, t.get("fecha_inicio"), medicamento),
            )
            if not cur_t.fetchone():
                conn.execute(
                    """
                    INSERT INTO tratamientos (
                        fecha_inicio, fecha_fin, crotal, medicamento, dosis,
                        receta_id, causa, origen
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'gestionavet')
                    """,
                    (
                        t.get("fecha_inicio"),
                        t.get("fecha_fin"),
                        crotal,
                        medicamento,
                        dosis,
                        receta_id,
                        causa,
                    ),
                )
                nuevos_tratamientos += 1

    return {
        "recetas_nuevas": nuevas_recetas,
        "tratamientos_nuevos": nuevos_tratamientos,
        "total_procesados": len(tratamientos),
    }


def sincronizar_gestionavet_en_bd(
    db_path: Path,
    usr: Optional[str] = None,
    pwd: Optional[str] = None,
    rega_filtro: Optional[str] = None,
    fecha_desde: str = "",
    fecha_hasta: str = "",
) -> Dict[str, Any]:
    """Descarga los tratamientos de Gestionavet e inserta en la base de datos SQLite con origen='gestionavet'."""
    from scripts.export_gestionavet import GestionavetClient, load_credentials

    usuario = usr
    password = pwd
    if not usuario or not password:
        usuario, password = load_credentials()

    client = GestionavetClient(usuario, password)
    logger.info("Autenticando en Gestionavet...")
    client.login()

    all_regas = client.get_regas()
    target_regas: List[Tuple[str, str, str]] = []
    if rega_filtro:
        for val, code, desc in all_regas:
            if rega_filtro.lower() in val.lower() or rega_filtro.lower() in code.lower():
                target_regas.append((val, code, desc))
    else:
        target_regas = all_regas

    if not target_regas:
        raise ValueError("No se encontraron códigos REGA para procesar en Gestionavet.")

    total_rec_nuevas = 0
    total_trat_nuevos = 0
    total_items = 0

    conn = sqlite3.connect(str(db_path))
    try:
        for val, code, desc in target_regas:
            logger.info(f"Descargando tratamientos CSV para REGA {code}...")
            # Usar un buffer o archivo temporal en memoria
            csv_bytes = client.export_libro_tratamientos(
                output_path=os.devnull,
                rega_val=val,
                formato="csv",
                tipo_informe="22",
                fecha_desde=fecha_desde,
                fecha_hasta=fecha_hasta,
            )
            # Decodificar texto con fallback seguro
            try:
                csv_texto = csv_bytes.decode("latin-1")
            except UnicodeDecodeError:
                csv_texto = csv_bytes.decode("utf-8", errors="ignore")

            registros = parsear_csv_tratamientos(csv_texto)
            if registros:
                res = guardar_tratamientos_gestionavet_en_bd(conn, registros, cea_por_defecto=code)
                total_rec_nuevas += res["recetas_nuevas"]
                total_trat_nuevos += res["tratamientos_nuevos"]
                total_items += res["total_procesados"]

        # Actualizar epoch para refresco reactivo en la PWA
        try:
            conn.execute(
                "UPDATE _sync_estado SET epoch = epoch + 1, actualizado_en = datetime('now') WHERE id = 1"
            )
            conn.commit()
        except sqlite3.OperationalError:
            pass

    finally:
        conn.close()

    return {
        "ok": True,
        "recetas_nuevas": total_rec_nuevas,
        "tratamientos_nuevos": total_trat_nuevos,
        "total_procesados": total_items,
        "message": f"Sincronizados {total_rec_nuevas} recetas y {total_trat_nuevos} tratamientos desde Gestionavet.",
    }
