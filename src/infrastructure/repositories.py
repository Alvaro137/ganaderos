import sqlite3
from datetime import datetime
from typing import List, Optional

from src.domain.models import Animal, Parto, RecetaSanitaria
from src.domain.repositories import (
    AnimalRepository,
    ExplotacionRepository,
    PartoRepository,
    RecetaRepository,
)
from src.domain.value_objects import Crotal, ExplotacionCEA, PeriodoSupresion


class SQLiteAnimalRepository(AnimalRepository):
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.conn.row_factory = sqlite3.Row

    def get_by_crotal(self, crotal: str) -> Optional[Animal]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM animales WHERE crotal = ?", (crotal,))
        row = cur.fetchone()
        if row:
            return self._map_to_domain(row)
        return None

    def list_all(self) -> List[Animal]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM animales")
        return [self._map_to_domain(row) for row in cur.fetchall()]

    def _map_to_domain(self, row: sqlite3.Row) -> Animal:
        return Animal(
            crotal=Crotal(row['crotal']),
            nombre=row['nombre'],
            sexo=row['sexo'],
            raza=row['raza'],
            fecha_nacimiento=datetime.strptime(row['fecha_nacimiento'], "%Y-%m-%d").date() if row['fecha_nacimiento'] else None,
            madre_crotal=row['madre_crotal'],
            padre_crotal=row['padre_crotal'],
            estado=row['estado'],
            vida=row['vida'],
            corral=row['corral'],
            fecha_alta=datetime.strptime(row['fecha_alta'], "%Y-%m-%d").date() if row['fecha_alta'] else None,
            fecha_ult_parto=datetime.strptime(row['fecha_ult_parto'], "%Y-%m-%d").date() if row['fecha_ult_parto'] else None,
            total_partos=row['total_partos']
        )


class SQLitePartoRepository(PartoRepository):
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.conn.row_factory = sqlite3.Row

    def list_by_madre(self, madre_crotal: str) -> List[Parto]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM partos WHERE madre_crotal = ? ORDER BY fecha_parto DESC", (madre_crotal,))
        return [self._map_to_domain(row) for row in cur.fetchall()]

    def list_all(self) -> List[Parto]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM partos ORDER BY fecha_parto DESC")
        return [self._map_to_domain(row) for row in cur.fetchall()]

    def _map_to_domain(self, row: sqlite3.Row) -> Parto:
        return Parto(
            madre_crotal=row['madre_crotal'],
            fecha_parto=datetime.strptime(row['fecha_parto'], "%Y-%m-%d").date() if row['fecha_parto'] else None,
            cria_crotal=row['cria_crotal'],
            cria_sexo=row['cria_sexo'],
            incidencias=row['incidencias'],
            id=row['id']
        )


class SQLiteRecetaRepository(RecetaRepository):
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.conn.row_factory = sqlite3.Row

    def list_all(self) -> List[RecetaSanitaria]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM recetas ORDER BY fecha DESC")
        return [self._map_to_domain(row) for row in cur.fetchall()]

    def _map_to_domain(self, row: sqlite3.Row) -> RecetaSanitaria:
        return RecetaSanitaria(
            fecha=datetime.strptime(row['fecha'], "%Y-%m-%d").date() if row['fecha'] else None,
            receta=row['receta'],
            medicamento=row['medicamento'],
            unidades=row['unidades'],
            dosis_unitaria=row['dosis_unitaria'],
            n_animales=row['n_animales'],
            veterinario=row['veterinario'],
            periodo_supresion=PeriodoSupresion(dias_carne=row['tiempo_carne'] or 0, dias_leche=row['tiempo_leche'] or 0),
            proveedor=row['proveedor'],
            cea=ExplotacionCEA(row['cea']) if row['cea'] else None,
            id=row['id']
        )


class SQLiteExplotacionRepository(ExplotacionRepository):
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.conn.row_factory = sqlite3.Row

    def list_all(self) -> List[dict]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM explotaciones")
        return [dict(row) for row in cur.fetchall()]
