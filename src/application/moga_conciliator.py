"""Servicio de conciliación entre el censo físico en campo y el censo oficial MoGa (ITACyL / SACPA)."""
from __future__ import annotations

import csv
import io
import re
from typing import Any, Dict, List, Optional, Set, Union


def normalizar_crotal(raw: Optional[str]) -> str:
    """Limpia y normaliza crotales de 14 dígitos (ej: 'ES 08 371261100121' -> 'ES08371261100121')."""
    if not raw:
        return ""
    clean = re.sub(r"[\s\-_.]", "", str(raw)).strip().upper()
    return clean


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

    # Detectar delimitador (; o , o \t)
    primera_linea = lineas[0]
    delimitador = ";" if ";" in primera_linea else ("," if "," in primera_linea else "\t")

    reader = csv.DictReader(lineas, delimiter=delimitador)
    registros = []

    for row in reader:
        # Búsqueda tolerante de nombres de cabecera estándar ITACyL
        crotal = None
        for k in ["CROTAL", "IDENTIFICACION", "ANIMAL", "NUMERO_IDENTIFICACION", "crotal"]:
            if k in row and row[k]:
                crotal = normalizar_crotal(row[k])
                break

        if not crotal:
            # Intentar primer valor que coincida con regex ES\d{12}
            for v in row.values():
                c = normalizar_crotal(v)
                if len(c) >= 12 and (c.startswith("ES") or c.isdigit()):
                    crotal = c
                    break

        if not crotal:
            continue

        estado = row.get("ESTADO") or row.get("SITUACION") or row.get("estado") or "ALTA"
        explotacion = row.get("EXPLOTACION") or row.get("REGA") or row.get("CEA") or row.get("explotacion") or ""
        raza = row.get("RAZA") or row.get("raza") or ""
        sexo = row.get("SEXO") or row.get("sexo") or ""
        fnac = row.get("FECHA_NACIMIENTO") or row.get("FECHA_NAC") or row.get("fecha_nacimiento") or ""

        registros.append({
            "crotal": crotal,
            "estado": estado.strip().upper(),
            "explotacion": explotacion.strip().upper(),
            "raza": raza.strip(),
            "sexo": sexo.strip(),
            "fecha_nacimiento": fnac.strip(),
        })

    return registros


def conciliar_censo_con_moga(animales_locales: List[Dict[str, Any]], registros_moga: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compara el censo local con MoGa identificando discrepancias de censo y REGA."""
    moga_map: Dict[str, Dict[str, Any]] = {r["crotal"]: r for r in registros_moga}
    local_map: Dict[str, Dict[str, Any]] = {normalizar_crotal(a["crotal"]): a for a in animales_locales}

    crotales_moga: Set[str] = set(moga_map.keys())
    crotales_locales: Set[str] = set(local_map.keys())

    # 1. Animales en el censo físico local ausentes en MoGa (crotal sin tramitar)
    no_en_moga = []
    for c in crotales_locales:
        a = local_map[c]
        if a.get("estado", "A").upper() == "A" and c not in crotales_moga:
            no_en_moga.append({
                "crotal": c,
                "crotal_4": a.get("crotal_4") or c[-4:],
                "corral": a.get("corral"),
                "motivo": "Animal activo en campo pero ausente en registro oficial MoGa",
            })

    # 2. Animales dados de baja en MoGa que figuran activos en campo
    bajas_en_moga_activas_campo = []
    # 2b. Animales de alta en MoGa dados de baja en el censo local (trámite oficial pendiente)
    bajas_locales_activas_moga = []

    for c in crotales_locales & crotales_moga:
        a = local_map[c]
        m = moga_map[c]
        if a.get("estado", "A").upper() == "A" and m["estado"] in ["BAJA", "MUERTE", "SACRIFICIO", "TRASPASADO"]:
            bajas_en_moga_activas_campo.append({
                "crotal": c,
                "crotal_4": a.get("crotal_4") or c[-4:],
                "estado_moga": m["estado"],
                "motivo": f"Baja en MoGa ({m['estado']}) pero figura como Activo en campo",
            })
        elif a.get("estado", "A").upper() == "B" and m["estado"] == "ALTA":
            bajas_locales_activas_moga.append({
                "crotal": c,
                "crotal_4": a.get("crotal_4") or c[-4:],
                "motivo": "Dado de baja en el censo local pero todavía de alta oficial en MoGa (trámite pendiente)",
            })

    # 3. Animales de alta en MoGa ausentes en el censo local
    no_en_campo = []
    for c in crotales_moga:
        m = moga_map[c]
        if m["estado"] == "ALTA" and c not in crotales_locales:
            no_en_campo.append({
                "crotal": c,
                "explotacion": m.get("explotacion"),
                "motivo": "De alta oficial en MoGa pero no existe en la base de datos local",
            })

    # 4. Total conciliados
    coincidentes = len(crotales_locales & crotales_moga)

    return {
        "resumen": {
            "total_local": len(local_map),
            "total_moga": len(moga_map),
            "coincidentes": coincidentes,
            "discrepancias_totales": len(no_en_moga) + len(bajas_en_moga_activas_campo) + len(bajas_locales_activas_moga) + len(no_en_campo),
        },
        "no_en_moga": no_en_moga,
        "bajas_oficiales_activas_local": bajas_en_moga_activas_campo,
        "bajas_locales_activas_oficial": bajas_locales_activas_moga,
        "no_en_campo": no_en_campo,
    }
