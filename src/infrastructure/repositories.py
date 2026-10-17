import sqlite3
from datetime import date, datetime
from typing import List, Optional

from src.domain.models import Animal, Parto, Pesaje, RecetaSanitaria, TratamientoIndividual, Usuario
from src.domain.repositories import (
    AnimalRepository,
    ExplotacionRepository,
    PartoRepository,
    PesajeRepository,
    RecetaRepository,
    TratamientoRepository,
    UsuarioRepository,
)
from src.domain.value_objects import Crotal, ExplotacionCEA, PeriodoSupresion


def _parse_fecha_segura(val: Optional[str]) -> Optional[date]:
    """Parsea fechas de forma defensiva tolerando formatos heterogéneos o cadenas vacías/corruptas."""
    if not val:
        return None
    val_str = str(val).strip()
    if not val_str:
        return None
    # Formato estándar ISO (AAAA-MM-DD) y prefijo de timestamp (AAAA-MM-DD HH:MM:SS)
    try:
        return datetime.strptime(val_str[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        pass
    # Formato europeo alternativo (DD/MM/AAAA)
    try:
        return datetime.strptime(val_str[:10], "%d/%m/%Y").date()
    except (ValueError, TypeError):
        return None


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

    def list_activos(self) -> List[Animal]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM animales WHERE UPPER(TRIM(COALESCE(estado, ''))) = 'A'")
        return [self._map_to_domain(row) for row in cur.fetchall()]

    def list_reproductoras(self) -> List[Animal]:
        cur = self.conn.cursor()
        cur.execute(
            "SELECT * FROM animales "
            "WHERE UPPER(TRIM(COALESCE(estado, ''))) = 'A' AND vida = 1 "
            "AND (sexo = 'Vaca' OR sexo LIKE '%Hembra%')"
        )
        return [self._map_to_domain(row) for row in cur.fetchall()]

    def count_activos(self) -> int:
        cur = self.conn.cursor()
        cur.execute("SELECT COUNT(*) FROM animales WHERE UPPER(TRIM(COALESCE(estado, ''))) = 'A'")
        row = cur.fetchone()
        return row[0] if row else 0


    def _map_to_domain(self, row: sqlite3.Row) -> Animal:
        return Animal(
            crotal=Crotal(row['crotal']),
            nombre=row['nombre'],
            sexo=row['sexo'],
            raza=row['raza'],
            fecha_nacimiento=_parse_fecha_segura(row['fecha_nacimiento']),
            madre_crotal=row['madre_crotal'],
            padre_crotal=row['padre_crotal'],
            estado=row['estado'],
            vida=row['vida'],
            corral=row['corral'],
            fecha_alta=_parse_fecha_segura(row['fecha_alta']),
            fecha_ult_parto=_parse_fecha_segura(row['fecha_ult_parto']),
            total_partos=row['total_partos'] or 0
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
            fecha_parto=_parse_fecha_segura(row['fecha_parto']),
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
            fecha=_parse_fecha_segura(row['fecha']),
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


class SQLiteUsuarioRepository(UsuarioRepository):
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.conn.row_factory = sqlite3.Row

    def ensure_table_and_defaults(self) -> None:
        """Crea la tabla usuarios si no existe y siembra operarios por defecto."""
        cur = self.conn.cursor()
        cur.execute("""
        CREATE TABLE IF NOT EXISTS usuarios (
            id TEXT PRIMARY KEY,
            nombre TEXT NOT NULL,
            rol TEXT NOT NULL,
            pin_hash TEXT NOT NULL,
            password_hash TEXT,
            activo INTEGER DEFAULT 1,
            creado_en TEXT NOT NULL
        )
        """)
        self.conn.commit()

        cur.execute("SELECT COUNT(*) FROM usuarios")
        count = cur.fetchone()[0]
        if count == 0:
            now_str = datetime.now().isoformat()

            usuarios_defecto = [
                ("usr_admin", "Álvaro", "admin", "sin-pin", None, 1, now_str),
                ("usr_jose", "Jose", "operador", "sin-pin", None, 1, now_str),
                ("usr_amelia", "Amelia", "operador", "sin-pin", None, 1, now_str),
                ("usr_alex", "Alex", "operador", "sin-pin", None, 1, now_str),
                ("usr_otro", "Otro", "operador", "sin-pin", None, 1, now_str),
            ]
            cur.executemany("""
            INSERT INTO usuarios (id, nombre, rol, pin_hash, password_hash, activo, creado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, usuarios_defecto)
            self.conn.commit()

    def get_by_id(self, user_id: str) -> Optional[Usuario]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM usuarios WHERE id = ?", (user_id,))
        row = cur.fetchone()
        if row:
            return self._map_to_domain(row)
        return None

    def list_active(self) -> List[Usuario]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM usuarios WHERE activo = 1 ORDER BY rol ASC, nombre ASC")
        return [self._map_to_domain(row) for row in cur.fetchall()]

    def create(self, usuario: Usuario) -> None:
        cur = self.conn.cursor()
        cur.execute("""
        INSERT INTO usuarios (id, nombre, rol, pin_hash, password_hash, activo, creado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            usuario.id,
            usuario.nombre,
            usuario.rol,
            usuario.pin_hash,
            usuario.password_hash,
            1 if usuario.activo else 0,
            usuario.creado_en or datetime.now().isoformat()
        ))
        self.conn.commit()

    def _map_to_domain(self, row: sqlite3.Row) -> Usuario:
        return Usuario(
            id=row['id'],
            nombre=row['nombre'],
            rol=row['rol'],
            pin_hash=row['pin_hash'],
            password_hash=row['password_hash'],
            activo=bool(row['activo']),
            creado_en=row['creado_en']
        )


class SQLitePesajeRepository(PesajeRepository):
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.conn.row_factory = sqlite3.Row
        self._ensure_table()

    def _ensure_table(self) -> None:
        try:
            self.conn.execute("""
            CREATE TABLE IF NOT EXISTS pesajes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                crotal TEXT NOT NULL,
                fecha TEXT NOT NULL,
                peso_kg REAL NOT NULL,
                tipo TEXT DEFAULT 'Control',
                notas TEXT,
                operador TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            """)
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_pesajes_crotal ON pesajes(crotal);")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_pesajes_fecha ON pesajes(fecha);")
            self.conn.commit()
        except sqlite3.OperationalError:
            pass

    def list_by_crotal(self, crotal: str) -> List[Pesaje]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM pesajes WHERE crotal = ? ORDER BY fecha ASC, id ASC", (crotal,))
        return [self._map_to_domain(row) for row in cur.fetchall()]

    def list_recent(self, limite: int = 50) -> List[Pesaje]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM pesajes ORDER BY fecha DESC, id DESC LIMIT ?", (limite,))
        return [self._map_to_domain(row) for row in cur.fetchall()]

    def create(self, pesaje: Pesaje) -> Pesaje:
        fecha_str = pesaje.fecha.isoformat() if isinstance(pesaje.fecha, (date, datetime)) else str(pesaje.fecha)
        try:
            cur = self.conn.cursor()
            cur.execute("""
            INSERT INTO pesajes (crotal, fecha, peso_kg, tipo, notas, operador)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (
                pesaje.crotal,
                fecha_str,
                float(pesaje.peso_kg),
                pesaje.tipo or "Control",
                pesaje.notas,
                pesaje.operador
            ))
            self.conn.commit()
            pesaje.id = cur.lastrowid
            return pesaje
        except sqlite3.OperationalError:
            row = self.conn.execute("PRAGMA database_list").fetchone()
            db_path = row[2] if (row and len(row) >= 3 and row[2]) else None
            if db_path and db_path != "":
                w_conn = sqlite3.connect(db_path)
                try:
                    w_conn.execute("""
                    CREATE TABLE IF NOT EXISTS pesajes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        crotal TEXT NOT NULL,
                        fecha TEXT NOT NULL,
                        peso_kg REAL NOT NULL,
                        tipo TEXT DEFAULT 'Control',
                        notas TEXT,
                        operador TEXT,
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP
                    );
                    """)
                    cur = w_conn.cursor()
                    cur.execute("""
                    INSERT INTO pesajes (crotal, fecha, peso_kg, tipo, notas, operador)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """, (
                        pesaje.crotal,
                        fecha_str,
                        float(pesaje.peso_kg),
                        pesaje.tipo or "Control",
                        pesaje.notas,
                        pesaje.operador
                    ))
                    w_conn.commit()
                    pesaje.id = cur.lastrowid
                    return pesaje
                finally:
                    w_conn.close()
            raise

    def _map_to_domain(self, row: sqlite3.Row) -> Pesaje:
        f = _parse_fecha_segura(row['fecha']) or date.today()
        return Pesaje(
            crotal=row['crotal'],
            fecha=f,
            peso_kg=float(row['peso_kg']),
            tipo=row['tipo'] or 'Control',
            notas=row['notas'] if 'notas' in row.keys() else None,
            operador=row['operador'] if 'operador' in row.keys() else None,
            id=row['id']
        )


class SQLiteTratamientoRepository(TratamientoRepository):
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.conn.row_factory = sqlite3.Row
        self._ensure_table()

    def _ensure_table(self) -> None:
        try:
            self.conn.execute("""
            CREATE TABLE IF NOT EXISTS tratamientos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                crotal TEXT NOT NULL,
                fecha_inicio TEXT NOT NULL,
                fecha_fin TEXT,
                medicamento TEXT NOT NULL,
                veterinario TEXT,
                causa TEXT,
                dias_retirada INTEGER DEFAULT 0,
                fecha_fin_retirada TEXT
            );
            """)
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_tratamientos_crotal ON tratamientos(crotal);")
            self.conn.commit()
        except sqlite3.OperationalError:
            pass

    def list_by_crotal(self, crotal: str) -> List[TratamientoIndividual]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM tratamientos WHERE crotal = ? ORDER BY fecha_inicio DESC, id DESC", (crotal,))
        return [self._map_to_domain(row) for row in cur.fetchall()]

    def list_activos(self, fecha_ref: Optional[date] = None) -> List[TratamientoIndividual]:
        d_ref = fecha_ref or date.today()
        ref = d_ref.isoformat()
        cur = self.conn.cursor()
        cur.execute("""
        SELECT * FROM tratamientos
        WHERE fecha_inicio <= ? AND (
            (fecha_fin_retirada IS NOT NULL AND fecha_fin_retirada >= ?)
            OR (fecha_fin_retirada IS NULL AND dias_retirada > 0 AND date(COALESCE(fecha_fin, fecha_inicio), '+' || dias_retirada || ' days') >= ?)
            OR (fecha_fin_retirada IS NULL AND (dias_retirada IS NULL OR dias_retirada = 0) AND fecha_fin IS NOT NULL AND fecha_fin >= ?)
        )
        ORDER BY fecha_inicio DESC
        """, (ref, ref, ref, ref))
        tratamientos = [self._map_to_domain(row) for row in cur.fetchall()]
        return [t for t in tratamientos if t.esta_en_retirada(d_ref)]

    def _map_to_domain(self, row: sqlite3.Row) -> TratamientoIndividual:
        fi = _parse_fecha_segura(row['fecha_inicio']) or date.today()
        ff = _parse_fecha_segura(row['fecha_fin']) if 'fecha_fin' in row.keys() else None
        keys = row.keys()
        dias_ret = int(row['dias_retirada']) if 'dias_retirada' in keys and row['dias_retirada'] is not None else 0
        ff_ret = _parse_fecha_segura(row['fecha_fin_retirada']) if 'fecha_fin_retirada' in keys else None

        return TratamientoIndividual(
            crotal=row['crotal'],
            fecha_inicio=fi,
            medicamento=row['medicamento'],
            fecha_fin=ff,
            veterinario=row['veterinario'] if 'veterinario' in keys else None,
            causa=row['causa'] if 'causa' in keys else None,
            dias_retirada=dias_ret,
            fecha_fin_retirada=ff_ret,
            id=row['id']
        )

