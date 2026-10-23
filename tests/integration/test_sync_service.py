"""Tests del motor de sincronización offline-first (hub OPi).

Sandbox: usa copias temporales de la BD demo; ninguna prueba toca ficheros reales.
Reglas verificadas: append-only de los móviles, idempotencia por UUID, epoch
incremental, import del censo que NUNCA pierde registros de campo, escritura atómica.
"""
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from src.application.sync_service import SyncError, SyncService

REPO = Path(__file__).resolve().parents[2]
DEMO = REPO / "pwa" / "ganaderos_demo.sqlite"

CHANGENOTA = {
    "uuid": "test-uuid-nota-0001",
    "tipo": "nota",
    "crotal": "ES000810740273",
    "ts_dispositivo": "2026-09-24T10:00:00",
    "payload": {"texto": "Coja de la pata trasera derecha"},
}


class TestSyncServiceBase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sync_test_"))
        # "BD del móvil/hub" inicial: copia del demo
        self.maestra = self.tmp / "maestra.sqlite"
        shutil.copyfile(DEMO, self.maestra)
        conn = sqlite3.connect(self.maestra)
        conn.execute("CREATE TABLE IF NOT EXISTS campo_registros (uuid TEXT PRIMARY KEY, tipo TEXT NOT NULL, crotal TEXT, operador TEXT NOT NULL, device_id TEXT, ts_dispositivo TEXT, ts_servidor TEXT NOT NULL DEFAULT (datetime('now')), payload TEXT)")
        conn.execute("DELETE FROM campo_registros")
        conn.execute("CREATE TABLE IF NOT EXISTS _sync_estado (id INTEGER PRIMARY KEY CHECK (id = 1), epoch INTEGER NOT NULL DEFAULT 0, actualizado_en TEXT)")
        conn.execute("INSERT OR IGNORE INTO _sync_estado (id, epoch, actualizado_en) VALUES (1, 0, datetime('now'))")
        conn.execute("UPDATE _sync_estado SET epoch = 0 WHERE id = 1")
        conn.commit()
        conn.close()
        self.svc = SyncService(self.maestra)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


class TestEstado(TestSyncServiceBase):
    def test_estado_inicial_epoch_0(self):
        estado = self.svc.estado()
        self.assertEqual(estado["epoch"], 0)
        self.assertEqual(estado["registros_campo"], 0)
        self.assertTrue(estado["existe_bd"])

    def test_push_sin_cambios_no_sube_epoch(self):
        antes = self.svc.estado()
        res = self.svc.aplicar_cambios("dev-test", "usr_admin", [])
        self.assertEqual(res["epoch"], antes["epoch"])
        self.assertEqual(self.svc.estado()["epoch"], antes["epoch"])


class TestPush(TestSyncServiceBase):
    def test_push_acepta_y_sube_epoch(self):
        res = self.svc.aplicar_cambios("dev-alvaro", "usr_admin", [CHANGENOTA])
        self.assertIn(CHANGENOTA["uuid"], res["aceptados"])
        self.assertEqual(res["epoch"], 1)
        hist = self.svc.historial()
        self.assertEqual(len(hist), 1)
        self.assertEqual(hist[0]["operador"], "usr_admin")
        self.assertEqual(hist[0]["tipo"], "nota")
        self.assertIn("Coja", hist[0]["payload"])

    def test_push_reintento_es_idempotente(self):
        self.svc.aplicar_cambios("dev-alvaro", "usr_admin", [CHANGENOTA])
        res2 = self.svc.aplicar_cambios("dev-alvaro", "usr_admin", [CHANGENOTA])
        self.assertIn(CHANGENOTA["uuid"], res2["duplicados"])
        self.assertEqual(self.svc.estado()["epoch"], 1)  # no crece por el reintento
        self.assertEqual(self.svc.estado()["registros_campo"], 1)

    def test_push_tipo_invalido_rechazado(self):
        malo = dict(CHANGENOTA, uuid="test-uuid-malo-00001", tipo="borrar_todo")
        res = self.svc.aplicar_cambios("dev-x", "usr_jose", [malo])
        self.assertEqual(len(res["rechazados"]), 1)
        self.assertIn("tipo no permitido", res["rechazados"][0]["motivo"])
        self.assertEqual(self.svc.estado()["registros_campo"], 0)

    def test_push_mezcla_acepta_y_rechaza(self):
        bueno = dict(CHANGENOTA, uuid="test-uuid-nota-0002", tipo="pesaje",
                     payload={"kg": 512.5})
        malo = dict(CHANGENOTA, uuid="test-uuid-nota-0003", tipo="hacking")
        res = self.svc.aplicar_cambios("dev-x", "usr_amelia", [bueno, malo])
        self.assertIn(bueno["uuid"], res["aceptados"])
        self.assertEqual(len(res["rechazados"]), 1)
        self.assertEqual(self.svc.estado()["registros_campo"], 1)

    def test_push_parto_mutation(self):
        parto = {
            "uuid": "test-uuid-parto-0001",
            "tipo": "parto",
            "crotal": "ES000810740273",
            "ts_dispositivo": "2026-09-29T16:00:00",
            "payload": {
                "fecha_parto": "2026-09-29",
                "cria_crotal": "C-0273",
                "cria_sexo": "H",
                "cria_raza": "Cruzado",
                "incidencias": "Parto asistido"
            },
        }
        res = self.svc.aplicar_cambios("dev-campo-01", "usr_jose", [parto])
        self.assertIn(parto["uuid"], res["aceptados"])
        hist = self.svc.historial()
        self.assertEqual(hist[0]["tipo"], "parto")
        self.assertEqual(hist[0]["operador"], "usr_jose")
        self.assertIn("C-0273", hist[0]["payload"])

    def test_push_movimiento_y_baja_mutations(self):
        mov = {
            "uuid": "test-uuid-mov-0001",
            "tipo": "movimiento",
            "crotal": "ES000810740273",
            "ts_dispositivo": "2026-10-25T10:00:00",
            "payload": {
                "tipo_movimiento": "TRASPASO_CEBADERO",
                "origen": "121",
                "destino": "122",
                "fecha": "2026-10-25",
            },
        }
        baja = {
            "uuid": "test-uuid-baja-0001",
            "tipo": "baja",
            "crotal": "ES000810740273",
            "ts_dispositivo": "2026-10-25T11:00:00",
            "payload": {
                "causa": "Muerte natural / Enfermedad",
                "fecha": "2026-10-25",
            },
        }
        res = self.svc.aplicar_cambios("dev-campo-01", "usr_admin", [mov, baja])
        self.assertIn(mov["uuid"], res["aceptados"])
        self.assertIn(baja["uuid"], res["aceptados"])
        self.assertEqual(len(res["rechazados"]), 0)
        hist = self.svc.historial()
        tipos = [h["tipo"] for h in hist]
        self.assertIn("movimiento", tipos)
        self.assertIn("baja", tipos)

# === PARTE 2 ===

class TestImport(TestSyncServiceBase):
    def _crear_actualizada(self) -> Path:
        """Simula una nueva export del PC: copia del censo con 2 animales y 1 parto más."""
        actualizada = self.tmp / "pc_actualizado.sqlite"
        shutil.copyfile(DEMO, actualizada)
        conn = sqlite3.connect(actualizada)
        conn.execute("CREATE TABLE IF NOT EXISTS campo_registros (uuid TEXT PRIMARY KEY, tipo TEXT NOT NULL, crotal TEXT, operador TEXT NOT NULL, device_id TEXT, ts_dispositivo TEXT, ts_servidor TEXT NOT NULL DEFAULT (datetime('now')), payload TEXT)")
        conn.execute("DELETE FROM campo_registros")
        conn.execute("CREATE TABLE IF NOT EXISTS _sync_estado (id INTEGER PRIMARY KEY CHECK (id = 1), epoch INTEGER NOT NULL DEFAULT 0, actualizado_en TEXT)")
        conn.execute("INSERT OR IGNORE INTO _sync_estado (id, epoch, actualizado_en) VALUES (1, 0, datetime('now'))")
        conn.execute("UPDATE _sync_estado SET epoch = 0 WHERE id = 1")
        conn.execute(
            "INSERT INTO animales (crotal, crotal_4, estado, vida, total_partos) "
            "VALUES ('ES000899999901', '9901', 'A', 1, 0), "
            "('ES000899999902', '9902', 'A', 1, 0)"
        )
        conn.execute(
            "INSERT INTO partos (madre_crotal, fecha_parto, cria_crotal, cria_sexo) "
            "VALUES ('ES000810740273', '2026-09-23', 'ES000899999903', 'Hembra')"
        )
        conn.execute(
            "INSERT OR REPLACE INTO meta VALUES ('fecha_exportacion', '2026-09-24 18:00:00')"
        )
        conn.commit()
        conn.close()
        return actualizada

    def test_import_conserva_registros_de_campo(self):
        # El "móvil" ya había subido una nota de campo
        self.svc.aplicar_cambios("dev-alvaro", "usr_admin", [CHANGENOTA])
        self.assertEqual(self.svc.estado()["epoch"], 1)

        resumen = self.svc.importar_bd_actualizada(self._crear_actualizada())

        # Nada de campo perdido
        self.assertEqual(resumen["registros_campo"], 1)
        self.assertEqual(resumen["importado"]["registros_campo_reintegrados"], 1)
        # El epoch SIEMPRE crece (nunca se retrocede ni se resetea)
        self.assertEqual(resumen["epoch"], 2)
        # El censo nuevo está presente
        conn = sqlite3.connect(self.maestra)
        total = conn.execute("SELECT COUNT(*) FROM animales").fetchone()[0]
        base = sqlite3.connect(DEMO)
        total_base = base.execute("SELECT COUNT(*) FROM animales").fetchone()[0]
        base.close()
        conn.close()
        self.assertEqual(total, total_base + 2)

    def test_import_no_deja_ficheros_tmp(self):
        self.svc.importar_bd_actualizada(self._crear_actualizada())
        residuos = list(self.tmp.glob("*.tmp*")) + list(self.tmp.glob("*.import_tmp*"))
        self.assertEqual(residuos, [])

    def test_import_bd_invalida_deja_maestra_intacta(self):
        self.svc.aplicar_cambios("dev-alvaro", "usr_admin", [CHANGENOTA])
        estado_antes = self.svc.estado()

        corrupta = self.tmp / "corrupta.sqlite"
        corrupta.write_bytes(b"esto no es una base de datos sqlite")
        with self.assertRaises(SyncError):
            self.svc.importar_bd_actualizada(corrupta)

        self.assertEqual(self.svc.estado(), estado_antes)

    def test_import_bd_sin_tablas_censo_rechazada(self):
        vacia = self.tmp / "vacia.sqlite"
        conn = sqlite3.connect(vacia)
        conn.execute("CREATE TABLE cualquier_cosa (x INTEGER)")
        conn.commit()
        conn.close()
        with self.assertRaises(SyncError):
            self.svc.importar_bd_actualizada(vacia)


class TestSyncAPI(unittest.TestCase):
    def setUp(self):
        import os

        from fastapi.testclient import TestClient

        from src.server.app import app

        os.environ["PWA_ALLOW_ANON_DB"] = "1"
        self.tmp = Path(tempfile.mkdtemp(prefix="sync_api_test_"))
        self.maestra = self.tmp / "maestra.sqlite"
        shutil.copyfile(DEMO, self.maestra)
        conn = sqlite3.connect(self.maestra)
        conn.execute("CREATE TABLE IF NOT EXISTS campo_registros (uuid TEXT PRIMARY KEY, tipo TEXT NOT NULL, crotal TEXT, operador TEXT NOT NULL, device_id TEXT, ts_dispositivo TEXT, ts_servidor TEXT NOT NULL DEFAULT (datetime('now')), payload TEXT)")
        conn.execute("DELETE FROM campo_registros")
        conn.execute("CREATE TABLE IF NOT EXISTS _sync_estado (id INTEGER PRIMARY KEY CHECK (id = 1), epoch INTEGER NOT NULL DEFAULT 0, actualizado_en TEXT)")
        conn.execute("INSERT OR IGNORE INTO _sync_estado (id, epoch, actualizado_en) VALUES (1, 0, datetime('now'))")
        conn.execute("UPDATE _sync_estado SET epoch = 0 WHERE id = 1")
        conn.commit()
        conn.close()
        # Inyectamos el servicio de sync apuntando a la sandbox (no a la BD real)
        app.state.sync_service = SyncService(self.maestra)
        self.client = TestClient(app)

    def tearDown(self):
        from src.server.app import app
        if hasattr(app.state, "sync_service"):
            del app.state.sync_service
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _token(self, user_id=None) -> str:
        body = {"password": "mvp-testing"}
        if user_id:
            body["user_id"] = user_id
        resp = self.client.post("/api/auth/login", json=body)
        return resp.json()["token"]

    def test_push_sin_token_es_401(self):
        resp = self.client.post(
            "/api/sync/push",
            json={"device_id": "dev-x", "changes": []},
        )
        self.assertEqual(resp.status_code, 401)

    def test_push_endpoint_flujo_completo(self):
        token = self._token("usr_jose")
        resp = self.client.post(
            "/api/sync/push",
            headers={"Authorization": f"Bearer {token}"},
            json={"device_id": "movil-jose", "changes": [CHANGENOTA]},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["ok"])
        self.assertIn(CHANGENOTA["uuid"], data["aceptados"])
        self.assertEqual(data["epoch"], 1)
        # La atribución queda registrada: el cambio es de Jose
        resp_hist = self.client.get(
            "/api/sync/historial", headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(resp_hist.json()["registros"][0]["operador"], "usr_jose")

    def test_import_solo_admin(self):
        token_jose = self._token("usr_jose")
        resp = self.client.post(
            "/api/sync/import",
            headers={"Authorization": f"Bearer {token_jose}"},
            files={"file": ("censo.sqlite", DEMO.read_bytes(), "application/octet-stream")},
        )
        self.assertEqual(resp.status_code, 403)

    def test_pendientes_endpoint(self):
        token_admin = self._token("usr_admin")
        self.client.post(
            "/api/sync/push",
            headers={"Authorization": f"Bearer {token_admin}"},
            json={"device_id": "movil-admin", "changes": [CHANGENOTA]},
        )
        resp = self.client.get(
            "/api/sync/pendientes",
            headers={"Authorization": f"Bearer {token_admin}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["pendientes"][0]["uuid"], CHANGENOTA["uuid"])

    def test_conciliado_endpoint_solo_admin(self):
        token_jose = self._token("usr_jose")
        resp = self.client.post(
            "/api/sync/conciliado",
            headers={"Authorization": f"Bearer {token_jose}"},
            json={"conciliados": [{"uuid": "dummy-uuid"}]},
        )
        self.assertEqual(resp.status_code, 403)

    def test_conciliado_endpoint_flujo_exitoso(self):
        token_admin = self._token("usr_admin")
        self.client.post(
            "/api/sync/push",
            headers={"Authorization": f"Bearer {token_admin}"},
            json={"device_id": "movil-admin", "changes": [CHANGENOTA]},
        )
        resp = self.client.post(
            "/api/sync/conciliado",
            headers={"Authorization": f"Bearer {token_admin}"},
            json={"conciliados": [{"uuid": CHANGENOTA["uuid"], "crotal_asignado": "ES220800857601"}]},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["actualizados"], 1)

        # Ya no debe aparecer en pendientes
        resp_pend = self.client.get(
            "/api/sync/pendientes",
            headers={"Authorization": f"Bearer {token_admin}"},
        )
        self.assertEqual(resp_pend.json()["total"], 0)


class TestConciliacion(TestSyncServiceBase):
    def test_listar_pendientes_y_marcar_conciliados(self):
        parto = {
            "uuid": "uuid-parto-conciliar-1",
            "tipo": "parto",
            "crotal": "ES000810740273",
            "ts_dispositivo": "2026-10-17T10:00:00",
            "payload": {"fecha_parto": "2026-10-17", "cria_sexo": "H"},
        }
        self.svc.aplicar_cambios("dev-1", "usr_admin", [CHANGENOTA, parto])

        todos = self.svc.listar_pendientes()
        self.assertEqual(len(todos), 2)

        partos = self.svc.listar_pendientes(tipo="parto")
        self.assertEqual(len(partos), 1)
        self.assertEqual(partos[0]["uuid"], parto["uuid"])
        self.assertEqual(partos[0]["conciliado_en_access"], 0)

        actualizados = self.svc.marcar_conciliados([
            {"uuid": parto["uuid"], "crotal_asignado": "ES220800857601"}
        ])
        self.assertEqual(actualizados, 1)

        partos_post = self.svc.listar_pendientes(tipo="parto")
        self.assertEqual(len(partos_post), 0)

        hist = self.svc.historial()
        parto_hist = next(h for h in hist if h["uuid"] == parto["uuid"])
        self.assertEqual(parto_hist["conciliado_en_access"], 1)
        self.assertEqual(parto_hist["crotal_asignado"], "ES220800857601")
        self.assertIsNotNone(parto_hist["ts_conciliado"])

    def test_import_conserva_estado_conciliacion(self):
        parto = {
            "uuid": "uuid-parto-import-1",
            "tipo": "parto",
            "crotal": "ES000810740273",
            "ts_dispositivo": "2026-10-17T10:00:00",
            "payload": {"fecha_parto": "2026-10-17", "cria_sexo": "H"},
        }
        self.svc.aplicar_cambios("dev-1", "usr_admin", [parto])
        self.svc.marcar_conciliados([
            {"uuid": parto["uuid"], "crotal_asignado": "ES220800857601"}
        ])

        actualizada = self.tmp / "actualizada.sqlite"
        shutil.copyfile(DEMO, actualizada)
        self.svc.importar_bd_actualizada(actualizada)

        hist = self.svc.historial()
        parto_hist = next(h for h in hist if h["uuid"] == parto["uuid"])
        self.assertEqual(parto_hist["conciliado_en_access"], 1)
        self.assertEqual(parto_hist["crotal_asignado"], "ES220800857601")
        self.assertIsNotNone(parto_hist["ts_conciliado"])


if __name__ == "__main__":
    unittest.main()

