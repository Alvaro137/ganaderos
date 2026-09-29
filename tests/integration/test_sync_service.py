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

# === PARTE 2 ===

class TestImport(TestSyncServiceBase):
    def _crear_actualizada(self) -> Path:
        """Simula una nueva export del PC: copia del censo con 2 animales y 1 parto más."""
        actualizada = self.tmp / "pc_actualizado.sqlite"
        shutil.copyfile(DEMO, actualizada)
        conn = sqlite3.connect(actualizada)
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


if __name__ == "__main__":
    unittest.main()
