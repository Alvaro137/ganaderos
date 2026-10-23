"""Servicio de conciliación entre el censo físico en campo y el censo oficial MoGa (Junta de Extremadura / CyL / SITRAN)."""

from __future__ import annotations

import csv
import io
import os
import re
import sqlite3
import xml.etree.ElementTree as ET
import zipfile
from typing import Any, Dict, List, Optional, Set, Union


def normalizar_crotal(raw: Optional[str]) -> str:
    """Limpia y normaliza crotales de 14 dígitos (ej: 'ES 08 371261100121' -> 'ES08371261100121')."""
    if not raw:
        return ""
    clean = re.sub(r"[\s\-_.]", "", str(raw)).strip().upper()
    return clean


def extraer_sufijo_10(crotal: str) -> str:
    """Extrae los últimos 10 dígitos numéricos del crotal para tolerancia a fallos en dígito de control."""
    c = normalizar_crotal(crotal)
    nums = re.findall(r"\d+", c)
    all_digits = "".join(nums)
    if len(all_digits) >= 10:
        return all_digits[-10:]
    return all_digits


def formatear_fecha_iso(fecha_raw: Optional[str]) -> Optional[str]:
    """Normaliza fechas DD-MM-YYYY o DD/MM/YYYY a formato ISO YYYY-MM-DD para SQLite."""
    if not fecha_raw:
        return None
    s = str(fecha_raw).strip()
    if not s or s.lower() in ["none", "null", "-", ""]:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})", s)
    if m:
        d, mth, y = m.groups()
        return f"{y}-{int(mth):02d}-{int(d):02d}"
    return s


def procesar_csv_moga(contenido_csv: Union[str, bytes, io.StringIO]) -> List[Dict[str, Any]]:
    """Parsea el fichero CSV oficial de MoGa / ITACyL tolerando diferentes delimitadores (; o ,)."""
    if isinstance(contenido_csv, bytes):
        try:
            texto = contenido_csv.decode("utf-8-sig")
        except UnicodeDecodeError:
            texto = contenido_csv.decode("latin-1")
    elif isinstance(contenido_csv, io.StringIO):
        texto = contenido_csv.getvalue()
    else:
        texto = str(contenido_csv)

    lineas = [line_item for line_item in texto.splitlines() if line_item.strip()]
    if not lineas:
        return []

    primera_linea = lineas[0]
    delimitador = ";" if ";" in primera_linea else ("," if "," in primera_linea else "\t")

    reader = csv.DictReader(lineas, delimiter=delimitador)
    registros = []

    for row in reader:
        crotal = None
        for k in ["CROTAL", "IDENTIFICACION", "ANIMAL", "NUMERO_IDENTIFICACION", "crotal"]:
            if k in row and row[k]:
                crotal = normalizar_crotal(row[k])
                break

        if not crotal:
            for v in row.values():
                c = normalizar_crotal(v)
                if len(c) >= 12 and (c.startswith("ES") or c.isdigit()):
                    crotal = c
                    break

        if not crotal:
            continue

        estado = row.get("ESTADO") or row.get("SITUACION") or row.get("estado") or "ALTA"
        explotacion = (
            row.get("EXPLOTACION")
            or row.get("REGA")
            or row.get("CEA")
            or row.get("explotacion")
            or ""
        )
        raza = row.get("RAZA") or row.get("raza") or ""
        sexo = row.get("SEXO") or row.get("sexo") or ""
        fnac = (
            row.get("FECHA_NACIMIENTO") or row.get("FECHA_NAC") or row.get("fecha_nacimiento") or ""
        )

        registros.append(
            {
                "crotal": crotal,
                "estado": estado.strip().upper(),
                "explotacion": explotacion.strip().upper(),
                "raza": raza.strip(),
                "sexo": sexo.strip(),
                "fecha_nacimiento": fnac.strip(),
            }
        )

    return registros


def parsear_xlsx_animales_moga(origen: Union[str, bytes, io.BytesIO]) -> List[Dict[str, Any]]:
    """Parsea el fichero XLSX oficial de MoGa mediante OpenXML estándar con zero dependencias externas."""
    if isinstance(origen, (bytes, bytearray)):
        file_obj = io.BytesIO(origen)
    elif isinstance(origen, io.BytesIO):
        file_obj = origen
    else:
        file_obj = origen

    with zipfile.ZipFile(file_obj, "r") as z:
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))  # nosec B314
        ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        rows = sheet.findall(".//s:row", ns)

        headers: Optional[List[str]] = None
        data: List[Dict[str, Any]] = []
        cea = ""

        for r in rows:
            vals = []
            for c in r.findall("s:c", ns):
                t = c.get("t")
                v = c.find("s:v", ns)
                val = v.text if v is not None else ""
                if t == "inlineStr":
                    is_t = c.find(".//s:t", ns)
                    val = is_t.text if is_t is not None else ""
                vals.append(val.strip() if val else "")

            if not vals or not any(vals):
                continue

            if vals[0].startswith("CEA") and len(vals) > 1:
                cea = vals[1].split()[0].strip()

            if "Identificador" in vals:
                headers = vals
                continue

            if headers and len(vals) >= len(headers):
                row_dict = dict(zip(headers, vals[: len(headers)]))
                crotal = normalizar_crotal(row_dict.get("Identificador"))
                if not crotal:
                    continue

                row_dict["crotal"] = crotal
                row_dict["crotal_4"] = row_dict.get("NºMan.") or crotal[-4:]
                row_dict["sexo"] = "H" if row_dict.get("Sexo", "").upper().startswith("H") else "M"
                row_dict["raza"] = row_dict.get("Morfotipo", "").strip()
                row_dict["fecha_nacimiento"] = formatear_fecha_iso(row_dict.get("F.Nacim."))
                row_dict["madre_crotal"] = normalizar_crotal(row_dict.get("Ident. Madre")) or None
                row_dict["id_electronico"] = row_dict.get("Id. Elec.", "").strip() or None
                row_dict["tipo_identificacion"] = row_dict.get("Tipo Id.", "").strip() or None
                row_dict["cea_nacimiento"] = row_dict.get("CEA Nacim.", "").strip() or None
                row_dict["cea_situacion"] = row_dict.get("CEA Situ.", "").strip() or cea
                row_dict["fecha_tuberculosis"] = formatear_fecha_iso(
                    row_dict.get("F. Ult. Act. Tuberc.")
                )
                row_dict["fecha_lengua_azul"] = formatear_fecha_iso(
                    row_dict.get("F. Ult. Vac. L.Azul")
                )
                row_dict["fecha_pri_parto"] = formatear_fecha_iso(row_dict.get("F.Pri.Parto"))
                row_dict["fecha_ult_parto"] = formatear_fecha_iso(row_dict.get("F.Últ.Parto"))

                try:
                    num_p = float(row_dict.get("Num.Partos", 0) or 0)
                    row_dict["total_partos"] = int(num_p)
                except ValueError:
                    row_dict["total_partos"] = 0

                row_dict["_cea_origen_fichero"] = cea
                data.append(row_dict)

        return data


def parsear_xls_movimientos_moga(
    origen: Union[str, bytes, io.StringIO, io.BytesIO],
) -> List[Dict[str, Any]]:
    """Parsea el fichero XLS (tabla HTML generada por MoGa) con codificación y estructura tolerante."""
    if isinstance(origen, (bytes, bytearray)):
        try:
            content = origen.decode("utf-8")
        except UnicodeDecodeError:
            content = origen.decode("latin-1")
    elif isinstance(origen, io.StringIO):
        content = origen.getvalue()
    elif isinstance(origen, io.BytesIO):
        b = origen.getvalue()
        try:
            content = b.decode("utf-8")
        except UnicodeDecodeError:
            content = b.decode("latin-1")
    elif os.path.exists(str(origen)):
        with open(str(origen), "r", encoding="latin-1") as f:
            content = f.read()
    else:
        content = str(origen)

    tables = re.findall(r"<table[^>]*>(.*?)</table>", content, re.DOTALL | re.IGNORECASE)
    if len(tables) < 6:
        return []

    t_data = tables[5]
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", t_data, re.DOTALL | re.IGNORECASE)
    if len(rows) < 2:
        return []

    header_cells = re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", rows[1], re.DOTALL | re.IGNORECASE)
    headers = [re.sub(r"<[^>]+>", "", c).replace("&nbsp;", "").strip() for c in header_cells]

    movimientos = []
    for r in rows[2:]:
        cells = re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, re.DOTALL | re.IGNORECASE)
        clean = [re.sub(r"<[^>]+>", "", c).replace("&nbsp;", "").strip() for c in cells]
        if len(clean) >= len(headers):
            row_dict = dict(zip(headers, clean[: len(headers)]))

            tipo = row_dict.get("Tipo", "").strip()
            tipo_doc = row_dict.get("Tipo de Doc", "").strip()
            num_reg = row_dict.get("Nº Registro", "").strip()
            num_sol = row_dict.get("Nº Solicitud", "").strip()
            f_reg = formatear_fecha_iso(row_dict.get("F. Registro"))
            f_mov = formatear_fecha_iso(row_dict.get("Salida en origen o F. Muerte")) or f_reg
            f_llegada = formatear_fecha_iso(
                row_dict.get("Llegada en destino o F. Identificación o     F. Nacimiento")
            )

            identificador = row_dict.get(
                "Identificador Mvto. o  Nº Transacción   o Animal", ""
            ).strip()
            crotal = normalizar_crotal(identificador) if identificador.startswith("ES") else None

            movimientos.append(
                {
                    "numero_registro": num_reg,
                    "numero_solicitud": num_sol,
                    "fecha_registro": f_reg,
                    "tipo": tipo,
                    "tipo_documento": tipo_doc,
                    "identificador": identificador,
                    "crotal": crotal,
                    "cea_origen": row_dict.get("CEA Origen", "").strip(),
                    "fecha": f_mov,
                    "cea_destino": row_dict.get("CEA Destino", "").strip(),
                    "fecha_llegada": f_llegada,
                    "animales": int(row_dict.get("Animales", 1) or 1),
                    "especie": row_dict.get("Especie", "BÓVIDOS").strip(),
                }
            )

    return movimientos


def conciliar_censo_con_moga(
    animales_locales: List[Dict[str, Any]], registros_moga: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """Compara el censo local con MoGa identificando discrepancias de censo y REGA."""
    moga_map: Dict[str, Dict[str, Any]] = {
        r["crotal"]: r for r in registros_moga if r.get("crotal")
    }
    local_map: Dict[str, Dict[str, Any]] = {
        normalizar_crotal(a["crotal"]): a for a in animales_locales if a.get("crotal")
    }

    crotales_moga: Set[str] = set(moga_map.keys())
    crotales_locales: Set[str] = set(local_map.keys())

    no_en_moga = []
    for c in crotales_locales:
        a = local_map[c]
        if a.get("estado", "A").upper() == "A" and c not in crotales_moga:
            no_en_moga.append(
                {
                    "crotal": c,
                    "crotal_4": a.get("crotal_4") or c[-4:],
                    "corral": a.get("corral"),
                    "motivo": "Animal activo en campo pero ausente en registro oficial MoGa",
                }
            )

    bajas_en_moga_activas_campo = []
    bajas_locales_activas_moga = []

    for c in crotales_locales & crotales_moga:
        a = local_map[c]
        m = moga_map[c]
        if a.get("estado", "A").upper() == "A" and m.get("estado") in [
            "BAJA",
            "MUERTE",
            "SACRIFICIO",
            "TRASPASADO",
        ]:
            bajas_en_moga_activas_campo.append(
                {
                    "crotal": c,
                    "crotal_4": a.get("crotal_4") or c[-4:],
                    "estado_moga": m.get("estado"),
                    "motivo": f"Baja en MoGa ({m.get('estado')}) pero figura como Activo en campo",
                }
            )
        elif a.get("estado", "A").upper() == "B" and m.get("estado") == "ALTA":
            bajas_locales_activas_moga.append(
                {
                    "crotal": c,
                    "crotal_4": a.get("crotal_4") or c[-4:],
                    "motivo": "Dado de baja en el censo local pero todavía de alta oficial en MoGa (trámite pendiente)",
                }
            )

    no_en_campo = []
    for c in crotales_moga:
        m = moga_map[c]
        if m.get("estado") == "ALTA" and c not in crotales_locales:
            no_en_campo.append(
                {
                    "crotal": c,
                    "explotacion": m.get("explotacion"),
                    "motivo": "De alta oficial en MoGa pero no existe en la base de datos local",
                }
            )

    coincidentes = len(crotales_locales & crotales_moga)

    return {
        "resumen": {
            "total_local": len(local_map),
            "total_moga": len(moga_map),
            "coincidentes": coincidentes,
            "discrepancias_totales": len(no_en_moga)
            + len(bajas_en_moga_activas_campo)
            + len(bajas_locales_activas_moga)
            + len(no_en_campo),
        },
        "no_en_moga": no_en_moga,
        "bajas_oficiales_activas_local": bajas_en_moga_activas_campo,
        "bajas_locales_activas_oficial": bajas_locales_activas_moga,
        "no_en_campo": no_en_campo,
    }


def asegurar_columnas_moga(conn: sqlite3.Connection) -> None:
    """Garantiza la existencia de columnas de trazabilidad oficial MoGa en animales y movimientos."""
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(animales)")
    existentes_anim = {r[1] for r in cur.fetchall()}
    columnas_nuevas_anim = [
        ("id_electronico", "TEXT"),
        ("tipo_identificacion", "TEXT"),
        ("cea_nacimiento", "TEXT"),
        ("cea_situacion", "TEXT"),
        ("fecha_tuberculosis", "TEXT"),
        ("fecha_lengua_azul", "TEXT"),
        ("fecha_pri_parto", "TEXT"),
    ]
    for col, tipo in columnas_nuevas_anim:
        if col not in existentes_anim:
            cur.execute(f"ALTER TABLE animales ADD COLUMN {col} {tipo}")

    cur.execute("PRAGMA table_info(movimientos)")
    existentes_mov = {r[1] for r in cur.fetchall()}
    columnas_nuevas_mov = [
        ("numero_registro", "TEXT"),
        ("numero_solicitud", "TEXT"),
        ("tipo_documento", "TEXT"),
    ]
    for col, tipo in columnas_nuevas_mov:
        if col not in existentes_mov:
            cur.execute(f"ALTER TABLE movimientos ADD COLUMN {col} {tipo}")

    conn.commit()


def auditar_y_conciliar_moga(
    conn: sqlite3.Connection,
    dir_121: str,
    dir_122: str,
) -> Dict[str, Any]:
    """Realiza una auditoría forense exhaustiva entre la base de datos y los ficheros MoGa de 121 y 122."""
    path_anim_121 = os.path.join(dir_121, "animales.xlsx")
    path_mov_121 = os.path.join(dir_121, "movimientos.xls")
    path_anim_122 = os.path.join(dir_122, "animales.xlsx")
    path_mov_122 = os.path.join(dir_122, "movimientos.xls")

    anim_121 = parsear_xlsx_animales_moga(path_anim_121) if os.path.exists(path_anim_121) else []
    anim_122 = parsear_xlsx_animales_moga(path_anim_122) if os.path.exists(path_anim_122) else []
    mov_121 = parsear_xls_movimientos_moga(path_mov_121) if os.path.exists(path_mov_121) else []
    mov_122 = parsear_xls_movimientos_moga(path_mov_122) if os.path.exists(path_mov_122) else []

    all_moga = {a["crotal"]: a for a in anim_121 + anim_122}
    all_moga_crotales = set(all_moga.keys())

    cur = conn.cursor()
    cur.execute(
        "SELECT crotal, crotal_4, estado, corral, sexo, raza, fecha_nacimiento FROM animales"
    )
    db_animals = {row[0]: row for row in cur.fetchall()}
    db_active = {k: v for k, v in db_animals.items() if v[2] == "A"}

    # Mapeo por sufijo de 10 dígitos (tolerancia a dígitos de control locales erróneos)
    moga_by_suffix = {extraer_sufijo_10(k): (k, a) for k, a in all_moga.items()}
    db_by_suffix = {extraer_sufijo_10(k): (k, row) for k, row in db_active.items()}

    # 1. Crotales con error de dígito de control en la BD local
    errores_digito_control = []
    matched_suffixes = set(moga_by_suffix.keys()) & set(db_by_suffix.keys())
    for s in matched_suffixes:
        moga_crotal, m_a = moga_by_suffix[s]
        db_crotal, db_row = db_by_suffix[s]
        if moga_crotal != db_crotal:
            errores_digito_control.append(
                {
                    "crotal_db": db_crotal,
                    "crotal_moga": moga_crotal,
                    "crotal_4": db_row[1],
                    "corral": db_row[3],
                    "motivo": f"Dígito de control discordante (DB: {db_crotal[:4]} vs MoGa oficial: {moga_crotal[:4]})",
                }
            )

    # 2. Animales activos en DB ausentes en MoGa
    activos_db_no_moga = []
    muertes_detectadas_en_movimientos = []
    # Buscar si murieron según los movimientos de MoGa
    muertes_moga_map = {}
    for m in mov_121 + mov_122:
        if m.get("tipo") == "Salida" and m.get("tipo_documento") == "Muerte" and m.get("crotal"):
            muertes_moga_map[m["crotal"]] = m

    for s, (db_crotal, db_row) in db_by_suffix.items():
        if s not in moga_by_suffix:
            # Comprobar si hay muerte en movimientos
            m_muerte = None
            for mc, mov in muertes_moga_map.items():
                if extraer_sufijo_10(mc) == s:
                    m_muerte = mov
                    break

            if m_muerte:
                muertes_detectadas_en_movimientos.append(
                    {
                        "crotal_db": db_crotal,
                        "crotal_oficial": m_muerte["crotal"],
                        "crotal_4": db_row[1],
                        "fecha_muerte": m_muerte["fecha"],
                        "numero_solicitud": m_muerte.get("numero_solicitud"),
                        "motivo": f"Fallecido el {m_muerte['fecha']} en MoGa pero constaba como Activo en campo",
                    }
                )
            else:
                activos_db_no_moga.append(
                    {
                        "crotal_db": db_crotal,
                        "crotal_4": db_row[1],
                        "corral": db_row[3],
                        "motivo": "Activo en base de datos local pero ausente en censo MoGa",
                    }
                )

    # 3. Animales activos en MoGa no activos o inexistentes en DB
    moga_no_activos_db = []
    for s, (moga_crotal, m_a) in moga_by_suffix.items():
        if s not in db_by_suffix:
            # Comprobar si existe como baja en DB
            en_db_baja = False
            for k, row in db_animals.items():
                if extraer_sufijo_10(k) == s:
                    en_db_baja = True
                    moga_no_activos_db.append(
                        {
                            "crotal_moga": moga_crotal,
                            "crotal_db": k,
                            "tipo": "EN_DB_COMO_BAJA",
                            "corral": row[3],
                            "motivo": "Dado de alta oficial en MoGa pero marcado como baja en la base local",
                        }
                    )
                    break
            if not en_db_baja:
                moga_no_activos_db.append(
                    {
                        "crotal_moga": moga_crotal,
                        "crotal_4": m_a.get("crotal_4"),
                        "tipo": "INEXISTENTE_EN_DB",
                        "raza": m_a.get("raza"),
                        "sexo": m_a.get("sexo"),
                        "fecha_nacimiento": m_a.get("fecha_nacimiento"),
                        "cea_situacion": m_a.get("cea_situacion"),
                        "motivo": "Alta oficial en MoGa pero no registrado en la base de datos local",
                    }
                )

    # 4. Estadísticas sanitarias y electrónicas
    con_tuberculosis = sum(1 for a in all_moga.values() if a.get("fecha_tuberculosis"))
    con_lengua_azul = sum(1 for a in all_moga.values() if a.get("fecha_lengua_azul"))
    con_rfid = sum(1 for a in all_moga.values() if a.get("id_electronico"))

    # 5. Localización en Cebadero (MoGa 122)
    cebadero_122 = []
    for a in anim_122:
        c = a["crotal"]
        s = extraer_sufijo_10(c)
        db_corral = db_by_suffix.get(s, (None, (None, None, None, "DESCONOCIDO")))[1][3]
        cebadero_122.append(
            {
                "crotal": c,
                "crotal_4": a["crotal_4"],
                "corral_db": db_corral,
                "es_cebadero_en_db": db_corral.upper() in ["CEBADERO", "122"],
            }
        )

    return {
        "resumen": {
            "total_moga": len(all_moga),
            "total_moga_121": len(anim_121),
            "total_moga_122": len(anim_122),
            "total_db_activos": len(db_active),
            "coincidentes_exactos": len(set(db_active.keys()) & all_moga_crotales),
            "coincidentes_por_sufijo_10": len(matched_suffixes),
            "errores_digito_control": len(errores_digito_control),
            "muertes_detectadas_moga": len(muertes_detectadas_en_movimientos),
            "altas_nuevas_moga": len(
                [x for x in moga_no_activos_db if x["tipo"] == "INEXISTENTE_EN_DB"]
            ),
            "activos_locales_huerfanos": len(activos_db_no_moga),
            "cobertura_tuberculosis": con_tuberculosis,
            "cobertura_lengua_azul": con_lengua_azul,
            "cobertura_rfid_electronico": con_rfid,
            "movimientos_121": len(mov_121),
            "movimientos_122": len(mov_122),
        },
        "errores_digito_control": errores_digito_control,
        "muertes_detectadas": muertes_detectadas_en_movimientos,
        "altas_nuevas": moga_no_activos_db,
        "activos_huerfanos": activos_db_no_moga,
        "cebadero_122": cebadero_122,
        "archivos": {
            "121_animales": path_anim_121,
            "121_movimientos": path_mov_121,
            "122_animales": path_anim_122,
            "122_movimientos": path_mov_122,
        },
    }


def aplicar_conciliacion_moga(
    conn: sqlite3.Connection,
    dir_121: str,
    dir_122: str,
) -> Dict[str, Any]:
    """Aplica las correcciones en la base de datos asumiendo que MoGa es la fuente de verdad definitiva."""
    asegurar_columnas_moga(conn)
    cur = conn.cursor()

    auditoria = auditar_y_conciliar_moga(conn, dir_121, dir_122)

    # 1. Corregir los 35 crotales con dígito de control erróneo en cascada
    corregidos_crotal = 0
    for err in auditoria["errores_digito_control"]:
        db_c = err["crotal_db"]
        moga_c = err["crotal_moga"]
        if db_c != moga_c:
            cur.execute("UPDATE animales SET crotal = ? WHERE crotal = ?", (moga_c, db_c))
            cur.execute("UPDATE movimientos SET crotal = ? WHERE crotal = ?", (moga_c, db_c))
            cur.execute("UPDATE partos SET madre_crotal = ? WHERE madre_crotal = ?", (moga_c, db_c))
            cur.execute("UPDATE partos SET cria_crotal = ? WHERE cria_crotal = ?", (moga_c, db_c))
            cur.execute(
                "UPDATE animales SET madre_crotal = ? WHERE madre_crotal = ?", (moga_c, db_c)
            )
            cur.execute(
                "UPDATE animales SET padre_crotal = ? WHERE padre_crotal = ?", (moga_c, db_c)
            )
            cur.execute("UPDATE tratamientos SET crotal = ? WHERE crotal = ?", (moga_c, db_c))
            try:
                cur.execute("UPDATE pesajes SET crotal = ? WHERE crotal = ?", (moga_c, db_c))
            except sqlite3.OperationalError:
                pass
            try:
                cur.execute(
                    "UPDATE ventas_canales SET crotal_asignado = ? WHERE crotal_asignado = ?",
                    (moga_c, db_c),
                )
            except sqlite3.OperationalError:
                pass
            corregidos_crotal += 1

    # 2. Dar de baja los animales fallecidos según MoGa
    dados_de_baja = 0
    for m in auditoria["muertes_detectadas"]:
        c = m["crotal_oficial"]
        cur.execute("UPDATE animales SET estado = 'B' WHERE crotal = ?", (c,))
        # Insertar movimiento de muerte si no existe
        cur.execute("SELECT id FROM movimientos WHERE crotal = ? AND tipo = 'MUERTE'", (c,))
        if not cur.fetchone():
            cur.execute(
                "INSERT INTO movimientos (crotal, fecha, tipo, origen, destino, corral, numero_solicitud, tipo_documento) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    c,
                    m["fecha_muerte"],
                    "MUERTE",
                    "ES371261100121",
                    "",
                    "ESPADAÑA",
                    m.get("numero_solicitud"),
                    "Muerte",
                ),
            )
        dados_de_baja += 1

    # 3. Dar de alta animales nuevos de MoGa
    dados_de_alta = 0
    anim_121 = parsear_xlsx_animales_moga(os.path.join(dir_121, "animales.xlsx"))
    anim_122 = parsear_xlsx_animales_moga(os.path.join(dir_122, "animales.xlsx"))
    all_moga_map = {a["crotal"]: a for a in anim_121 + anim_122}

    for alta in auditoria["altas_nuevas"]:
        if alta["tipo"] == "INEXISTENTE_EN_DB":
            c = alta["crotal_moga"]
            m_a = all_moga_map.get(c)
            if m_a:
                corral_inicial = "CEBADERO" if "122" in m_a.get("cea_situacion", "") else "ESPADAÑA"
                cur.execute(
                    """
                    INSERT INTO animales (
                        crotal, crotal_4, nombre, sexo, raza, fecha_nacimiento,
                        madre_crotal, padre_crotal, estado, vida, corral, fecha_alta,
                        id_electronico, tipo_identificacion, cea_nacimiento, cea_situacion,
                        fecha_tuberculosis, fecha_lengua_azul, fecha_pri_parto, fecha_ult_parto, total_partos
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        c,
                        m_a.get("crotal_4"),
                        "",
                        m_a.get("sexo", "H"),
                        m_a.get("raza", ""),
                        m_a.get("fecha_nacimiento"),
                        m_a.get("madre_crotal"),
                        None,
                        "A",
                        1 if m_a.get("sexo") == "H" else 0,
                        corral_inicial,
                        m_a.get("fecha_nacimiento"),
                        m_a.get("id_electronico"),
                        m_a.get("tipo_identificacion"),
                        m_a.get("cea_nacimiento"),
                        m_a.get("cea_situacion"),
                        m_a.get("fecha_tuberculosis"),
                        m_a.get("fecha_lengua_azul"),
                        m_a.get("fecha_pri_parto"),
                        m_a.get("fecha_ult_parto"),
                        m_a.get("total_partos", 0),
                    ),
                )
                dados_de_alta += 1

    # 4. Actualizar datos oficiales en todos los animales presentes en MoGa
    actualizados_oficiales = 0
    for c, m_a in all_moga_map.items():
        cur.execute(
            """
            UPDATE animales SET
                id_electronico = COALESCE(?, id_electronico),
                tipo_identificacion = COALESCE(?, tipo_identificacion),
                cea_nacimiento = COALESCE(?, cea_nacimiento),
                cea_situacion = COALESCE(?, cea_situacion),
                fecha_tuberculosis = COALESCE(?, fecha_tuberculosis),
                fecha_lengua_azul = COALESCE(?, fecha_lengua_azul),
                fecha_pri_parto = COALESCE(?, fecha_pri_parto),
                total_partos = MAX(COALESCE(total_partos, 0), ?)
            WHERE crotal = ?
            """,
            (
                m_a.get("id_electronico"),
                m_a.get("tipo_identificacion"),
                m_a.get("cea_nacimiento"),
                m_a.get("cea_situacion"),
                m_a.get("fecha_tuberculosis"),
                m_a.get("fecha_lengua_azul"),
                m_a.get("fecha_pri_parto"),
                m_a.get("total_partos", 0),
                c,
            ),
        )
        if cur.rowcount > 0:
            actualizados_oficiales += 1

    # 5. Asegurar corral = CEBADERO para todos los animales de CEA 122
    for a in anim_122:
        cur.execute(
            "UPDATE animales SET corral = 'CEBADERO' WHERE crotal = ? AND corral != 'CEBADERO'",
            (a["crotal"],),
        )

    conn.commit()

    return {
        "ok": True,
        "corregidos_crotal": corregidos_crotal,
        "dados_de_baja": dados_de_baja,
        "dados_de_alta": dados_de_alta,
        "actualizados_oficiales": actualizados_oficiales,
        "censo_oficial_moga": len(all_moga_map),
    }
