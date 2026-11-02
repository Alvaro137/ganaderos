#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
export_gestionavet.py - Descarga automatizada de recetas y libros de tratamientos desde Gestionavet.

Uso:
    python scripts/export_gestionavet.py --libro-pdf
    python scripts/export_gestionavet.py --recetas-pdf
    python scripts/export_gestionavet.py --todo

Requisitos:
    - Python 3 estándar (sin dependencias externas).
    - Variables gestionavet_usr y gestionavet_pwd definidas en .env o entorno.
"""

import argparse
import hashlib
import http.cookiejar
import os
import re
import sys
import urllib.parse
import urllib.request
from typing import List, Tuple


def load_credentials() -> Tuple[str, str]:
    """Carga credenciales desde variables de entorno o archivo .env local."""
    usr = os.getenv("gestionavet_usr")
    pwd = os.getenv("gestionavet_pwd")

    if not usr or not pwd:
        env_paths = [".env", os.path.join(os.path.dirname(__file__), "..", ".env")]
        for p in env_paths:
            if os.path.exists(p):
                with open(p, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("#") or "=" not in line:
                            continue
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip('"').strip("'")
                        if k == "gestionavet_usr" and not usr:
                            usr = v
                        elif k == "gestionavet_pwd" and not pwd:
                            pwd = v

    if not usr or not pwd:
        raise ValueError(
            "No se encontraron las variables 'gestionavet_usr' y 'gestionavet_pwd' "
            "en el entorno ni en el archivo .env"
        )

    return usr, pwd


def md5(val: str) -> str:
    return hashlib.md5(val.encode("utf-8")).hexdigest()


class GestionavetClient:
    BASE_URL = "https://gestionavet.es"

    def __init__(self, username: str, password: str):
        self.username = username
        self.password = password
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))
        self.headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "es-ES,es;q=0.9",
        }

    def login(self) -> bool:
        """Realiza el handshake de autenticación por desafío-respuesta MD5."""
        req = urllib.request.Request(f"{self.BASE_URL}/login", headers=self.headers)
        with self.opener.open(req) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        match = re.search(
            r'id=["\']BaseUsuarioLogin_codigo["\'][^>]*value=["\']([^"\']+)["\']', html
        )
        if not match:
            match = re.search(
                r'value=["\']([^"\']+)["\'][^>]*id=["\']BaseUsuarioLogin_codigo["\']', html
            )

        if not match:
            raise RuntimeError("No se pudo obtener el token nonce c0 de Gestionavet.")

        c0 = match.group(1)

        clave_md5 = md5(self.password)
        c1 = md5(f"u:{self.username}:c0:{c0}")
        c2 = md5(f"k:{clave_md5}:c1:{c1}")
        c3 = md5(f"c0:{c0}:c1:{c1}:c2:{c2}")

        payload = urllib.parse.urlencode({
            "BaseUsuarioLogin[codigo]": c3,
            "BaseUsuarioLogin[codigo1]": c1,
            "BaseUsuarioLogin[codigo2]": c2,
            "BaseUsuarioLogin[usuario]": self.username,
            "BaseUsuarioLogin[clave]": clave_md5,
            "yt0": "Entrar",
        }).encode("utf-8")

        headers_post = dict(self.headers)
        headers_post.update({
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": self.BASE_URL,
            "Referer": f"{self.BASE_URL}/login",
        })

        req_login = urllib.request.Request(f"{self.BASE_URL}/login", data=payload, headers=headers_post)
        with self.opener.open(req_login) as resp:
            resp_html = resp.read().decode("utf-8", errors="ignore")

        if "El usuario, la clave o los controles de acceso son incorrectos" in resp_html:
            raise PermissionError("Autenticación rechazada por Gestionavet: credenciales inválidas.")

        return True

    def get_regas(self) -> List[Tuple[str, str, str]]:
        """
        Obtiene los códigos REGA disponibles en la cuenta.
        Devuelve lista de (id_interno, codigo_rega, descripcion).
        """
        req = urllib.request.Request(
            f"{self.BASE_URL}/recetas/librosTitulares/listaLibroTit",
            headers=self.headers,
        )
        with self.opener.open(req) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        regas_block = re.findall(
            r'<select[^>]*id="FiltroLibroRecetas_cea"[^>]*>(.*?)</select>', html, re.DOTALL
        )
        if not regas_block:
            return []

        options = re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', regas_block[0])
        results = []
        for val, txt in options:
            if not val:
                continue
            clean_txt = txt.strip()
            # Extraer código REGA limpio (ej. ES371261100121)
            m_rega = re.search(r'(ES\d+)', clean_txt)
            rega_code = m_rega.group(1) if m_rega else val
            results.append((val, rega_code, clean_txt))
        return results

    def export_libro_tratamientos(
        self,
        output_path: str,
        rega_val: str,
        formato: str = "pdf",
        tipo_informe: str = "22",
        fecha_desde: str = "",
        fecha_hasta: str = "",
    ) -> bytes:
        """
        Descarga el libro oficial de tratamientos de una explotación.
        formato: 'pdf' o 'csv'
        tipo_informe: '22' (NUEVO 2023 pdf), '11' (Estándar pdf), '12' (CSV)
        """
        # 1. Obtener ruta de exportación actual con token _rs
        req = urllib.request.Request(
            f"{self.BASE_URL}/recetas/librosTitulares/listaLibroTit",
            headers=self.headers,
        )
        with self.opener.open(req) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        m = re.search(r"btnImprimir.*?submitForm\s*\(\s*this\s*,\s*['\"]([^'\"]+)['\"]", html)
        if not m:
            action_path = "/recetas/librosTitulares/listaLibroTit/imprimir/1"
        else:
            action_path = m.group(1).encode("utf-8").decode("unicode_escape")

        if formato == "csv" and tipo_informe == "22":
            tipo_informe = "23"

        post_data = {
            "FiltroLibroRecetas[cea]": rega_val,
            "FiltroLibroRecetas[tipolistado]": tipo_informe,
            "FiltroLibroRecetas[pagina]": "1",
            "FiltroLibroRecetas[visible]": "1",
            "FiltroLibroRecetas[fecha_desde]": fecha_desde,
            "FiltroLibroRecetas[fecha_hasta]": fecha_hasta,
        }

        url = urllib.parse.urljoin(self.BASE_URL, action_path)
        req_post = urllib.request.Request(
            url,
            data=urllib.parse.urlencode(post_data).encode("utf-8"),
            headers=dict(self.headers, **{
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": f"{self.BASE_URL}/recetas/librosTitulares/listaLibroTit",
            }),
        )

        with self.opener.open(req_post) as resp:
            content = resp.read()

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(content)

        return content

    def export_recetas(
        self,
        output_path: str,
        tipo_informe: str = "8",
        fecha_desde: str = "",
        fecha_hasta: str = "",
    ) -> bytes:
        """
        Descarga el informe de recetas.
        tipo_informe:
            '8': Imprimir recetas firmadas (PDF)
            '1': Listado de recetas (PDF)
            '2': Listado de recetas (CSV)
            '17': Resumen de recetas (PDF)
        """
        req = urllib.request.Request(
            f"{self.BASE_URL}/recetas/recetas/listaRecetasTit",
            headers=self.headers,
        )
        with self.opener.open(req) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        m = re.search(r"btn_Exportar.*?submitForm\s*\(\s*this\s*,\s*['\"]([^'\"]+)['\"]", html)
        if not m:
            action_path = "/recetas/recetas/listaRecetasTit/imprimir/1"
        else:
            action_path = m.group(1).encode("utf-8").decode("unicode_escape")

        post_data = {
            "FiltroRecetas[tipolistado]": tipo_informe,
            "FiltroRecetas[visible]": "0",
            "FiltroRecetas[fechafirma_desde]": fecha_desde,
            "FiltroRecetas[fechafirma_hasta]": fecha_hasta,
        }

        url = urllib.parse.urljoin(self.BASE_URL, action_path)
        req_post = urllib.request.Request(
            url,
            data=urllib.parse.urlencode(post_data).encode("utf-8"),
            headers=dict(self.headers, **{
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": f"{self.BASE_URL}/recetas/recetas/listaRecetasTit",
            }),
        )

        with self.opener.open(req_post) as resp:
            content = resp.read()

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(content)

        return content


def count_pdf_pages(pdf_bytes: bytes) -> int:
    """Cuenta el número de páginas de un documento PDF binario."""
    return len(re.findall(rb'/Type\s*/Page\b', pdf_bytes))


def main():
    parser = argparse.ArgumentParser(description="Exportador automatizado de recetas Gestionavet")
    parser.add_argument("--libro-pdf", nargs="?", const="libro_tratamientos.pdf", help="Descargar Libro de Tratamientos en PDF")
    parser.add_argument("--libro-csv", nargs="?", const="libro_tratamientos.csv", help="Descargar Libro de Tratamientos en CSV")
    parser.add_argument("--recetas-pdf", nargs="?", const="recetas_firmadas.pdf", help="Descargar Recetas Firmadas en PDF")
    parser.add_argument("--todo", action="store_true", help="Descargar tanto el libro como las recetas")
    parser.add_argument("--rega", default=None, help="Código o ID de REGA específico (ej. ES371261100121 o 29756)")
    parser.add_argument("--desde", default="", help="Fecha inicial (DD-MM-YYYY)")
    parser.add_argument("--hasta", default="", help="Fecha final (DD-MM-YYYY)")

    args = parser.parse_args()

    if not (args.libro_pdf or args.libro_csv or args.recetas_pdf or args.todo):
        args.todo = True

    try:
        usr, pwd = load_credentials()
        client = GestionavetClient(usr, pwd)

        print("[*] Iniciando sesion en Gestionavet...")
        client.login()
        print("[+] Sesion establecida correctamente.")

        all_regas = client.get_regas()
        print(f"[*] Explotaciones REGA detectadas ({len(all_regas)}):")
        for val, code, desc in all_regas:
            print(f"    - [{val}] {desc}")

        # Determinar qué REGAs procesar
        target_regas = []
        if args.rega:
            for val, code, desc in all_regas:
                if args.rega.lower() in val.lower() or args.rega.lower() in code.lower():
                    target_regas.append((val, code, desc))
            if not target_regas:
                raise ValueError(f"No se encontro ninguna explotacion que coincida con '{args.rega}'")
        else:
            target_regas = all_regas

        # Descarga de Libros de Tratamientos
        if args.libro_pdf or args.todo:
            base_target = args.libro_pdf or "libro_tratamientos.pdf"
            base_dir = os.path.dirname(os.path.abspath(base_target))
            base_name, base_ext = os.path.splitext(os.path.basename(base_target))

            active_libros = []
            for val, code, desc in target_regas:
                # Nombre específico por explotación
                if len(target_regas) > 1:
                    out_path = os.path.join(base_dir, f"{base_name}_{code}{base_ext}")
                else:
                    out_path = base_target

                print(f"[*] Generando Libro de Tratamientos para {code} ({desc})...")
                content = client.export_libro_tratamientos(
                    output_path=out_path,
                    rega_val=val,
                    formato="pdf",
                    tipo_informe="22",  # Formato oficial NUEVO 2023
                    fecha_desde=args.desde,
                    fecha_hasta=args.hasta,
                )
                pages = count_pdf_pages(content)
                size_kb = len(content) / 1024
                print(f"[+] Guardado: {out_path} ({pages} paginas, {size_kb:.1f} KB)")
                active_libros.append((out_path, pages, content))

            # Si hay una explotación con más tratamientos, asegurar que el archivo base también tenga ese contenido
            if len(target_regas) > 1 and active_libros:
                # Ordenar por páginas descendente
                active_libros.sort(key=lambda x: x[1], reverse=True)
                main_libro_path, main_pages, main_bytes = active_libros[0]
                if main_pages > 1 and base_target != main_libro_path:
                    with open(base_target, "wb") as f:
                        f.write(main_bytes)
                    print(f"[+] Libro principal ({main_pages} paginas) copiado como '{base_target}'.")

        # Descarga de CSV
        if args.libro_csv:
            base_target = args.libro_csv
            for val, code, desc in target_regas:
                out_path = base_target if len(target_regas) == 1 else f"{os.path.splitext(base_target)[0]}_{code}.csv"
                print(f"[*] Descargando Libro CSV para {code}...")
                client.export_libro_tratamientos(
                    output_path=out_path,
                    rega_val=val,
                    formato="csv",
                    tipo_informe="22",
                    fecha_desde=args.desde,
                    fecha_hasta=args.hasta,
                )
                print(f"[+] CSV guardado: {out_path}")

        # Descarga de Recetas Firmadas
        if args.recetas_pdf or args.todo:
            out = args.recetas_pdf or "recetas_firmadas.pdf"
            print(f"[*] Descargando Recetas Firmadas (PDF) en '{out}'...")
            content = client.export_recetas(
                output_path=out,
                tipo_informe="8",
                fecha_desde=args.desde,
                fecha_hasta=args.hasta,
            )
            pages = count_pdf_pages(content)
            print(f"[+] Recetas Firmadas guardadas: '{out}' ({pages} paginas, {len(content)/1024:.1f} KB)")

        print("\n[OK] Operacion completada exitosamente.")

    except Exception as e:
        print(f"\n[ERROR] Error durante la ejecucion: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
