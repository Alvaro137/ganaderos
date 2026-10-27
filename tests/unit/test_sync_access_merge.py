"""Tests unitarios para el script de conciliación PC <-> Access (sync_access_merge.py)."""
import json
import tempfile
import unittest
import urllib.error
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

from scripts.sync_access_merge import (
    AccessReconciliationError,
    autenticar_hub,
    conciliar_bajas_en_access,
    conciliar_movimientos_en_access,
    conciliar_partos_en_access,
    crear_backup,
    main,
    mapear_tipo_movimiento,
    normalizar_cea,
    notificar_conciliacion,
    obtener_pendientes,
)


class TestSyncAccessMerge(unittest.TestCase):
    def test_crear_backup(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_file = Path(tmpdir) / "bdlibro.mdb"
            db_file.write_text("fake access content")

            backup = crear_backup(db_file)
            self.assertTrue(backup.exists())
            self.assertEqual(backup.parent.name, "backups")
            self.assertIn("bdlibro_backup_", backup.name)
            self.assertEqual(backup.read_text(), "fake access content")

    @patch("urllib.request.urlopen")
    def test_autenticar_hub_exitoso(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"token": "jwt-token-123"}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        token = autenticar_hub("http://localhost:8010", "mvp-testing")
        self.assertEqual(token, "jwt-token-123")

    @patch("urllib.request.urlopen")
    def test_autenticar_hub_error_credenciales(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.HTTPError(
            url="http://localhost:8010",
            code=401,
            msg="Unauthorized",
            hdrs={},
            fp=MagicMock(read=lambda: b"Contrase\xc3\xb1a incorrecta"),
        )
        with self.assertRaises(AccessReconciliationError) as ctx:
            autenticar_hub("http://localhost:8010", "password-erronea")
        self.assertIn("HTTP 401", str(ctx.exception))

    @patch("urllib.request.urlopen")
    def test_obtener_pendientes(self, mock_urlopen):
        mock_resp = MagicMock()
        pendientes_mock = [
            {"uuid": "u1", "tipo": "parto", "crotal": "ES012345678901"}
        ]
        mock_resp.read.return_value = json.dumps({"ok": True, "pendientes": pendientes_mock}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        res = obtener_pendientes("http://localhost:8010", "token-x", tipo="parto")
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["uuid"], "u1")

    @patch("urllib.request.urlopen")
    def test_notificar_conciliacion(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"ok": True, "actualizados": 2}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        conciliados = [
            {"uuid": "u1", "crotal_asignado": "ES220800857601"},
            {"uuid": "u2", "crotal_asignado": "ES220800857602"},
        ]
        n = notificar_conciliacion("http://localhost:8010", "token-x", conciliados)
        self.assertEqual(n, 2)

    def test_conciliar_partos_en_access_flujo_completo(self):
        mock_pyodbc = MagicMock()
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur
        mock_pyodbc.connect.return_value = mock_conn

        # Mock de consultas:
        # 1. Crotales libres (fetchall)
        # 2. Comprobar si ya existe cría (fetchone: None -> no existe)
        # 3. Localizar madre (fetchone: madre)
        # 4. @@IDENTITY para cod_movi (fetchone: (5665,))
        mock_cur.fetchall.side_effect = [
            [("ES220800857601", "ES371261100121"), ("ES220800857602", "ES371261100121")],
        ]
        mock_cur.fetchone.side_effect = [
            None,  # no existe previamente
            ("ES090810288379", "0000", "DUEÑA", "ES371261100121", "ES371261100121", datetime(2025, 4, 10)),  # madre
            (5665,),  # @@IDENTITY
        ]

        partos = [
            {
                "uuid": "uuid-parto-1",
                "crotal": "ES090810288379",
                "ts_dispositivo": "2026-10-17T10:00:00",
                "payload": {
                    "fecha_parto": "2026-10-17",
                    "cria_sexo": "H",
                    "cria_crotal": None,
                },
            }
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            with patch.dict("sys.modules", {"pyodbc": mock_pyodbc}):
                conciliados = conciliar_partos_en_access(db_path, "pwd", partos, dry_run=False)

            self.assertEqual(len(conciliados), 1)
            self.assertEqual(conciliados[0]["uuid"], "uuid-parto-1")
            self.assertEqual(conciliados[0]["crotal_asignado"], "ES220800857601")
            self.assertEqual(conciliados[0]["madre_crotal"], "ES090810288379")

            # Verifica que se hizo commit
            mock_conn.commit.assert_called_once()
            mock_conn.rollback.assert_not_called()

    def test_conciliar_partos_dry_run_hace_rollback(self):
        mock_pyodbc = MagicMock()
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur
        mock_pyodbc.connect.return_value = mock_conn

        mock_cur.fetchall.side_effect = [
            [("ES220800857601", "ES371261100121")],
        ]
        mock_cur.fetchone.side_effect = [
            None,  # no existe previamente
            ("ES090810288379", "0000", "DUEÑA", "ES371261100121", "ES371261100121", None),
            (5665,),
        ]

        partos = [
            {
                "uuid": "uuid-parto-dry",
                "crotal": "ES090810288379",
                "payload": {"fecha_parto": "2026-10-17", "cria_sexo": "M"},
            }
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            with patch.dict("sys.modules", {"pyodbc": mock_pyodbc}):
                conciliados = conciliar_partos_en_access(db_path, "pwd", partos, dry_run=True)

            self.assertEqual(len(conciliados), 1)
            mock_conn.commit.assert_not_called()
            mock_conn.rollback.assert_called_once()

    def test_conciliar_partos_sin_crotales_lanza_error(self):
        mock_pyodbc = MagicMock()
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur
        mock_pyodbc.connect.return_value = mock_conn

        # Crotales libres VACÍO
        mock_cur.fetchall.side_effect = [
            [],
        ]
        mock_cur.fetchone.side_effect = [
            None,  # no existe previamente
            ("ES090810288379", "0000", "DUEÑA", "ES371261100121", "ES371261100121", None),
        ]

        partos = [
            {
                "uuid": "uuid-parto-sin-crotal",
                "crotal": "ES090810288379",
                "payload": {"fecha_parto": "2026-10-17", "cria_sexo": "H"},
            }
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            with patch.dict("sys.modules", {"pyodbc": mock_pyodbc}):
                with self.assertRaises(AccessReconciliationError) as ctx:
                    conciliar_partos_en_access(db_path, "pwd", partos)
            self.assertIn("No quedan crotales en la tabla Crotales", str(ctx.exception))
            mock_conn.rollback.assert_called_once()

    def test_conciliar_partos_sin_pyodbc_lanza_error(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            with patch.dict("sys.modules", {"pyodbc": None}):
                with self.assertRaises(AccessReconciliationError) as ctx:
                    conciliar_partos_en_access(db_path, "pwd", [])
            self.assertIn("pyodbc no está disponible", str(ctx.exception))

    def test_conciliar_partos_idempotente_si_ya_existe_en_access(self):
        mock_pyodbc = MagicMock()
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur
        mock_pyodbc.connect.return_value = mock_conn

        # Crotales libres disponibles
        mock_cur.fetchall.return_value = [("ES220800857601", "ES371261100121")]
        # fetchone: la cría ya existe previamente con crotal ES220800857601
        mock_cur.fetchone.return_value = ("ES220800857601",)

        partos = [
            {
                "uuid": "uuid-parto-ya-existente",
                "crotal": "ES090810288379",
                "payload": {"fecha_parto": "2026-10-17", "cria_sexo": "H"},
            }
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            with patch.dict("sys.modules", {"pyodbc": mock_pyodbc}):
                conciliados = conciliar_partos_en_access(db_path, "pwd", partos)

            self.assertEqual(len(conciliados), 1)
            self.assertEqual(conciliados[0]["uuid"], "uuid-parto-ya-existente")
            self.assertEqual(conciliados[0]["crotal_asignado"], "ES220800857601")
            # No debe haberse ejecutado INSERT en Animal ni DELETE en Crotales
            llamadas_sql = [call[0][0] for call in mock_cur.execute.call_args_list]
            self.assertFalse(any("INSERT INTO Animal" in sql for sql in llamadas_sql))

    @patch.dict("sys.modules", {"pyodbc": None})
    def test_conciliar_partos_fichero_ldb_bloqueado_lanza_error(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")
            # Simular que Access / Ganaderos 10 está abierto
            ldb_path = Path(tmpdir) / "bdlibro.ldb"
            ldb_path.write_text("lock")

            with self.assertRaises(AccessReconciliationError) as ctx:
                conciliar_partos_en_access(db_path, "pwd", [{"uuid": "1"}])
            self.assertIn("en uso por Ganaderos 10", str(ctx.exception))

    def test_normalizar_cea(self):
        self.assertEqual(normalizar_cea("121"), "ES371261100121")
        self.assertEqual(normalizar_cea("122"), "ES371261100122")
        self.assertEqual(normalizar_cea("ES371261100121"), "ES371261100121")
        self.assertEqual(normalizar_cea(""), "")
        self.assertEqual(normalizar_cea(None), "")
        self.assertEqual(normalizar_cea("PARCELA_NORTE"), "PARCELA_NORTE")

    def test_mapear_tipo_movimiento(self):
        self.assertEqual(mapear_tipo_movimiento("TRASPASO_CEBADERO"), "T")
        self.assertEqual(mapear_tipo_movimiento("TRASPASO"), "T")
        self.assertEqual(mapear_tipo_movimiento("T"), "T")
        self.assertEqual(mapear_tipo_movimiento("MOVIMIENTO_INTERNO"), "U")
        self.assertEqual(mapear_tipo_movimiento("UBICACION"), "U")
        self.assertEqual(mapear_tipo_movimiento("CAMBIO_CORRAL"), "U")
        self.assertEqual(mapear_tipo_movimiento("U"), "U")
        self.assertEqual(mapear_tipo_movimiento("VENTA"), "V")
        self.assertEqual(mapear_tipo_movimiento("V"), "V")
        self.assertEqual(mapear_tipo_movimiento(None), "T")
        self.assertEqual(mapear_tipo_movimiento("OTRO_DESCONOCIDO"), "T")

    def test_conciliar_movimientos_en_access_mock_cursor(self):
        mock_cur = MagicMock()
        movimientos = [
            {
                "uuid": "uuid-mov-1",
                "crotal": "ES081008454820",
                "payload": {
                    "tipo_movimiento": "TRASPASO_CEBADERO",
                    "origen": "121",
                    "destino": "122",
                    "corral": "CEBADERO_1",
                    "ubicacion": "122",
                    "fecha": "2026-10-27",
                    "sexo": "M",
                },
            }
        ]

        conciliados = conciliar_movimientos_en_access(mock_cur, movimientos)

        self.assertEqual(len(conciliados), 1)
        self.assertEqual(conciliados[0]["uuid"], "uuid-mov-1")
        self.assertEqual(conciliados[0]["crotal_asignado"], "ES081008454820")
        self.assertEqual(conciliados[0]["crotal"], "ES081008454820")
        self.assertEqual(conciliados[0]["tipo"], "movimiento")
        self.assertEqual(conciliados[0]["fecha"], "2026-10-27")

        # Verificar que se ejecutaron UPDATE Animal e INSERT Movimiento con parámetros correctos
        llamadas = mock_cur.execute.call_args_list
        self.assertEqual(len(llamadas), 2)

        sql_update, args_update = llamadas[0][0]
        self.assertIn("UPDATE Animal SET corral = ?, ubicacion = ? WHERE crotal = ?", sql_update)
        self.assertEqual(args_update, ("CEBADERO_1", "ES371261100122", "ES081008454820"))

        sql_insert, args_insert = llamadas[1][0]
        self.assertIn(
            "INSERT INTO Movimiento (crotal, origen, destino, corral, fecha, tipo, sexo, registrado) VALUES (?, ?, ?, ?, ?, ?, ?, False)",
            sql_insert,
        )
        self.assertEqual(
            args_insert,
            ("ES081008454820", "ES371261100121", "ES371261100122", "CEBADERO_1", datetime(2026, 10, 27, 0, 0), "T", "01"),
        )

    def test_conciliar_movimientos_defensivo_idcorral_y_destino(self):
        mock_cur = MagicMock()
        movimientos = [
            {
                "uuid": "uuid-mov-2",
                "crotal": "ES081008454821",
                "payload": {
                    "idcorral": 5,
                    "destino": "122",
                    "tipo_movimiento": "MOVIMIENTO_INTERNO",
                    "fecha": "2026-10-27",
                    "sexo": "H",
                },
            }
        ]

        conciliados = conciliar_movimientos_en_access(mock_cur, movimientos)

        self.assertEqual(len(conciliados), 1)
        llamadas = mock_cur.execute.call_args_list
        self.assertEqual(len(llamadas), 2)

        sql_update, args_update = llamadas[0][0]
        self.assertEqual(args_update, ("5", "ES371261100122", "ES081008454821"))

        sql_insert, args_insert = llamadas[1][0]
        self.assertEqual(args_insert[5], "U")
        self.assertEqual(args_insert[6], "02")

    def test_conciliar_movimientos_missing_crotal(self):
        mock_cur = MagicMock()
        movimientos = [
            {"uuid": "uuid-sin-crotal-1", "crotal": "", "payload": {"corral": "CEBO"}},
            {"uuid": "uuid-sin-crotal-2", "payload": {"corral": "CEBO"}},
        ]

        conciliados = conciliar_movimientos_en_access(mock_cur, movimientos)

        self.assertEqual(len(conciliados), 0)
        mock_cur.execute.assert_not_called()

    def test_conciliar_bajas_en_access_mock_cursor(self):
        mock_cur = MagicMock()
        bajas = [
            {
                "uuid": "uuid-baja-1",
                "crotal": "ES090810288379",
                "payload": {
                    "fecha": "2026-10-25",
                    "causa": "Muerte natural",
                    "origen": "121",
                    "sexo": "H",
                },
            }
        ]

        conciliados = conciliar_bajas_en_access(mock_cur, bajas)

        self.assertEqual(len(conciliados), 1)
        self.assertEqual(conciliados[0]["uuid"], "uuid-baja-1")
        self.assertEqual(conciliados[0]["crotal_asignado"], "ES090810288379")
        self.assertEqual(conciliados[0]["crotal"], "ES090810288379")
        self.assertEqual(conciliados[0]["tipo"], "baja")
        self.assertEqual(conciliados[0]["fecha"], "2026-10-25")

        llamadas = mock_cur.execute.call_args_list
        self.assertEqual(len(llamadas), 2)

        sql_update, args_update = llamadas[0][0]
        self.assertIn("UPDATE Animal SET estado = 'B', vivo = False, f_sacrificio = ? WHERE crotal = ?", sql_update)
        self.assertEqual(args_update, (datetime(2026, 10, 25, 0, 0), "ES090810288379"))

        sql_insert, args_insert = llamadas[1][0]
        self.assertIn(
            "INSERT INTO Movimiento (crotal, origen, destino, corral, fecha, tipo, sexo, registrado) VALUES (?, ?, '', '', ?, 'M', ?, False)",
            sql_insert,
        )
        self.assertEqual(args_insert, ("ES090810288379", "ES371261100121", datetime(2026, 10, 25, 0, 0), "02"))

    def test_conciliar_bajas_missing_crotal(self):
        mock_cur = MagicMock()
        bajas = [
            {"uuid": "uuid-baja-sin-crotal", "payload": {"fecha": "2026-10-25"}},
        ]

        conciliados = conciliar_bajas_en_access(mock_cur, bajas)

        self.assertEqual(len(conciliados), 0)
        mock_cur.execute.assert_not_called()

    def test_conciliar_movimientos_db_commit_y_dry_run_rollback(self):
        mock_pyodbc = MagicMock()
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur
        mock_pyodbc.connect.return_value = mock_conn

        movimientos = [
            {
                "uuid": "m1",
                "crotal": "ES12345",
                "payload": {"corral": "CEBO", "ubicacion": "122", "fecha": "2026-10-27"},
            }
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            # Caso 1: dry_run=False -> commit
            with patch.dict("sys.modules", {"pyodbc": mock_pyodbc}):
                res_real = conciliar_movimientos_en_access(db_path, "pwd", movimientos, dry_run=False)
            self.assertEqual(len(res_real), 1)
            mock_conn.commit.assert_called_once()
            mock_conn.rollback.assert_not_called()

            mock_conn.reset_mock()

            # Caso 2: dry_run=True -> rollback
            with patch.dict("sys.modules", {"pyodbc": mock_pyodbc}):
                res_dry = conciliar_movimientos_en_access(db_path, "pwd", movimientos, dry_run=True)
            self.assertEqual(len(res_dry), 1)
            mock_conn.commit.assert_not_called()
            mock_conn.rollback.assert_called_once()

    def test_conciliar_bajas_db_commit_y_dry_run_rollback(self):
        mock_pyodbc = MagicMock()
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur
        mock_pyodbc.connect.return_value = mock_conn

        bajas = [
            {
                "uuid": "b1",
                "crotal": "ES12345",
                "payload": {"fecha": "2026-10-27", "origen": "121"},
            }
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            # dry_run=False -> commit
            with patch.dict("sys.modules", {"pyodbc": mock_pyodbc}):
                res_real = conciliar_bajas_en_access(db_path, "pwd", bajas, dry_run=False)
            self.assertEqual(len(res_real), 1)
            mock_conn.commit.assert_called_once()
            mock_conn.rollback.assert_not_called()

            mock_conn.reset_mock()

            # dry_run=True -> rollback
            with patch.dict("sys.modules", {"pyodbc": mock_pyodbc}):
                res_dry = conciliar_bajas_en_access(db_path, "pwd", bajas, dry_run=True)
            self.assertEqual(len(res_dry), 1)
            mock_conn.commit.assert_not_called()
            mock_conn.rollback.assert_called_once()

    def test_conciliar_movimientos_db_error_hace_rollback(self):
        mock_pyodbc = MagicMock()
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur
        mock_pyodbc.connect.return_value = mock_conn
        mock_cur.execute.side_effect = RuntimeError("Fallo de escritura ODBC")

        movimientos = [{"uuid": "m1", "crotal": "ES123", "payload": {}}]

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            with patch.dict("sys.modules", {"pyodbc": mock_pyodbc}):
                with self.assertRaises(AccessReconciliationError) as ctx:
                    conciliar_movimientos_en_access(db_path, "pwd", movimientos)
            self.assertIn("Fallo de escritura ODBC", str(ctx.exception))
            mock_conn.rollback.assert_called_once()

    def test_conciliar_bajas_db_error_hace_rollback(self):
        mock_pyodbc = MagicMock()
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur
        mock_pyodbc.connect.return_value = mock_conn
        mock_cur.execute.side_effect = RuntimeError("Fallo de escritura ODBC")

        bajas = [{"uuid": "b1", "crotal": "ES123", "payload": {}}]

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            with patch.dict("sys.modules", {"pyodbc": mock_pyodbc}):
                with self.assertRaises(AccessReconciliationError) as ctx:
                    conciliar_bajas_en_access(db_path, "pwd", bajas)
            self.assertIn("Fallo de escritura ODBC", str(ctx.exception))
            mock_conn.rollback.assert_called_once()

    @patch.dict("sys.modules", {"pyodbc": None})
    def test_conciliar_movimientos_sin_pyodbc_lanza_error(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")
            with self.assertRaises(AccessReconciliationError) as ctx:
                conciliar_movimientos_en_access(db_path, "pwd", [{"uuid": "1", "crotal": "ES1"}])
            self.assertIn("pyodbc no está disponible", str(ctx.exception))

    @patch.dict("sys.modules", {"pyodbc": None})
    def test_conciliar_bajas_sin_pyodbc_lanza_error(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")
            with self.assertRaises(AccessReconciliationError) as ctx:
                conciliar_bajas_en_access(db_path, "pwd", [{"uuid": "1", "crotal": "ES1"}])
            self.assertIn("pyodbc no está disponible", str(ctx.exception))

    def test_conciliar_movimientos_fichero_ldb_bloqueado_lanza_error(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")
            ldb_path = Path(tmpdir) / "bdlibro.ldb"
            ldb_path.write_text("lock")

            with self.assertRaises(AccessReconciliationError) as ctx:
                conciliar_movimientos_en_access(db_path, "pwd", [{"uuid": "1", "crotal": "ES1"}])
            self.assertIn("en uso por Ganaderos 10", str(ctx.exception))

    def test_conciliar_bajas_fichero_ldb_bloqueado_lanza_error(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")
            ldb_path = Path(tmpdir) / "bdlibro.ldb"
            ldb_path.write_text("lock")

            with self.assertRaises(AccessReconciliationError) as ctx:
                conciliar_bajas_en_access(db_path, "pwd", [{"uuid": "1", "crotal": "ES1"}])
            self.assertIn("en uso por Ganaderos 10", str(ctx.exception))

    @patch("scripts.sync_access_merge.tiene_controlador_access", return_value=True)
    @patch("scripts.sync_access_merge.guardar_snapshot_en_vault")
    @patch("scripts.sync_access_merge.exportar_y_subir_censo")
    @patch("scripts.sync_access_merge.notificar_conciliacion")
    @patch("scripts.sync_access_merge.conciliar_bajas_en_access")
    @patch("scripts.sync_access_merge.conciliar_movimientos_en_access")
    @patch("scripts.sync_access_merge.conciliar_partos_en_access")
    @patch("scripts.sync_access_merge.crear_backup")
    @patch("scripts.sync_access_merge.obtener_pendientes")
    @patch("scripts.sync_access_merge.autenticar_hub")
    def test_main_end_to_end_con_movimientos_y_bajas(
        self,
        mock_auth,
        mock_pendientes,
        mock_backup,
        mock_conciliar_partos,
        mock_conciliar_movs,
        mock_conciliar_bajas,
        mock_notificar,
        mock_exportar,
        mock_vault,
        mock_controlador,
    ):
        mock_auth.return_value = "token-test"
        # 1 parto, 1 movimiento, 1 baja
        mock_pendientes.side_effect = [
            [{"uuid": "p1", "crotal": "MADRE1"}],
            [{"uuid": "m1", "crotal": "ANIMAL1"}],
            [{"uuid": "b1", "crotal": "ANIMAL2"}],
        ]
        mock_backup.return_value = Path("/tmp/backup.mdb")
        mock_conciliar_partos.return_value = [{"uuid": "p1", "crotal_asignado": "CALF1", "madre_crotal": "MADRE1", "fecha_parto": "2026-10-27"}]
        mock_conciliar_movs.return_value = [{"uuid": "m1", "crotal_asignado": "ANIMAL1", "crotal": "ANIMAL1", "fecha": "2026-10-27"}]
        mock_conciliar_bajas.return_value = [{"uuid": "b1", "crotal_asignado": "ANIMAL2", "crotal": "ANIMAL2", "fecha": "2026-10-27"}]
        mock_notificar.return_value = 3
        mock_exportar.return_value = {"ok": True, "epoch": 100}
        mock_vault.return_value = {"commit": "vault-hash", "message": "msg"}

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            with patch("sys.argv", ["sync_access_merge.py", "--source", str(db_path), "--password", "pwd"]):
                ret = main()

            self.assertEqual(ret, 0)
            mock_conciliar_partos.assert_called_once()
            mock_conciliar_movs.assert_called_once()
            mock_conciliar_bajas.assert_called_once()

            # Verifica que notificar_conciliacion recibió los 3 registros conciliados
            mock_notificar.assert_called_once()
            conciliados_enviados = mock_notificar.call_args[0][2]
            self.assertEqual(len(conciliados_enviados), 3)
            self.assertEqual([c["uuid"] for c in conciliados_enviados], ["p1", "m1", "b1"])

            mock_exportar.assert_called_once()
            mock_vault.assert_called_once()

    @patch("scripts.sync_access_merge.tiene_controlador_access", return_value=True)
    @patch("scripts.sync_access_merge.guardar_snapshot_en_vault")
    @patch("scripts.sync_access_merge.exportar_y_subir_censo")
    @patch("scripts.sync_access_merge.notificar_conciliacion")
    @patch("scripts.sync_access_merge.conciliar_bajas_en_access")
    @patch("scripts.sync_access_merge.conciliar_movimientos_en_access")
    @patch("scripts.sync_access_merge.conciliar_partos_en_access")
    @patch("scripts.sync_access_merge.crear_backup")
    @patch("scripts.sync_access_merge.obtener_pendientes")
    @patch("scripts.sync_access_merge.autenticar_hub")
    def test_main_solo_movimientos_y_bajas(
        self,
        mock_auth,
        mock_pendientes,
        mock_backup,
        mock_conciliar_partos,
        mock_conciliar_movs,
        mock_conciliar_bajas,
        mock_notificar,
        mock_exportar,
        mock_vault,
        mock_controlador,
    ):
        mock_auth.return_value = "token-test"
        # 0 partos, 1 movimiento, 1 baja
        mock_pendientes.side_effect = [
            [],
            [{"uuid": "m1", "crotal": "ANIMAL1"}],
            [{"uuid": "b1", "crotal": "ANIMAL2"}],
        ]
        mock_backup.return_value = Path("/tmp/backup.mdb")
        mock_conciliar_movs.return_value = [{"uuid": "m1", "crotal_asignado": "ANIMAL1", "crotal": "ANIMAL1", "fecha": "2026-10-27"}]
        mock_conciliar_bajas.return_value = [{"uuid": "b1", "crotal_asignado": "ANIMAL2", "crotal": "ANIMAL2", "fecha": "2026-10-27"}]
        mock_notificar.return_value = 2

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            with patch("sys.argv", ["sync_access_merge.py", "--source", str(db_path), "--password", "pwd"]):
                ret = main()

            self.assertEqual(ret, 0)
            mock_conciliar_partos.assert_not_called()
            mock_conciliar_movs.assert_called_once()
            mock_conciliar_bajas.assert_called_once()
            mock_notificar.assert_called_once()
            conciliados_enviados = mock_notificar.call_args[0][2]
            self.assertEqual(len(conciliados_enviados), 2)

    @patch("scripts.sync_access_merge.tiene_controlador_access", return_value=True)
    @patch("scripts.sync_access_merge.notificar_conciliacion")
    @patch("scripts.sync_access_merge.crear_backup")
    @patch("scripts.sync_access_merge.obtener_pendientes")
    @patch("scripts.sync_access_merge.autenticar_hub")
    def test_main_sin_pendientes_salida_limpia(
        self,
        mock_auth,
        mock_pendientes,
        mock_backup,
        mock_notificar,
        mock_controlador,
    ):
        mock_auth.return_value = "token-test"
        mock_pendientes.side_effect = [[], [], []]

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            with patch("sys.argv", ["sync_access_merge.py", "--source", str(db_path), "--password", "pwd"]):
                ret = main()

            self.assertEqual(ret, 0)
            mock_backup.assert_not_called()
            mock_notificar.assert_not_called()


if __name__ == "__main__":
    unittest.main()
