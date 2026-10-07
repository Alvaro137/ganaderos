"""Tests de concurrencia, resiliencia transaccional y validación de esquemas en sincronización.

Verifica:
1. Concurrencia real: Múltiples operadores (Álvaro y Jose) enviando mutaciones simultáneas vía hilos.
2. Integridad de epoch y atomicidad transaccional (sin bloqueos ni carreras en SQLite).
3. Idempotencia y deduplicación bajo concurrencia.
4. Validación rigurosa de esquemas de mutación de campo.
5. Control de acceso RBAC estricto: importación y cambio de clave reservados a admin.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest

from fastapi.testclient import TestClient

from src.application.sync_service import SyncService
from src.server.app import app

REPO = Path(__file__).resolve().parents[2]
DEMO = REPO / "pwa" / "ganaderos_demo.sqlite"


class TestSyncConcurrencyAndRobustness(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sync_concurrency_test_"))
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
        self.sync_svc = SyncService(self.maestra)
        app.state.sync_service = self.sync_svc
        self.client = TestClient(app)

    def tearDown(self):
        if hasattr(app.state, "sync_service"):
            del app.state.sync_service
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _token(self, user_id="usr_admin") -> str:
        resp = self.client.post("/api/auth/login", json={"password": "mvp-testing", "user_id": user_id})
        return resp.json()["token"]

    def test_concurrent_pushes_multi_operator(self):
        """Simula a dos operadores enviando 10 mutaciones concurrentes cada uno."""
        token_admin = self._token("usr_admin")
        token_jose = self._token("usr_jose")

        def enviar_cambio(args):
            idx, token, device, user = args
            mutacion = {
                "uuid": f"uuid-concurrent-{user}-{idx:04d}",
                "tipo": "nota",
                "crotal": "ES083710104591",
                "ts_dispositivo": "2026-10-07T12:00:00",
                "payload": {"texto": f"Observación de campo {idx} por {user}"},
            }
            resp = self.client.post(
                "/api/sync/push",
                headers={"Authorization": f"Bearer {token}"},
                json={"device_id": device, "changes": [mutacion]},
            )
            return resp.status_code, resp.json()

        tareas = []
        for i in range(10):
            tareas.append((i, token_admin, "movil-alvaro", "usr_admin"))
            tareas.append((i, token_jose, "movil-jose", "usr_jose"))

        with ThreadPoolExecutor(max_workers=4) as executor:
            resultados = list(executor.map(enviar_cambio, tareas))

        # Todas las peticiones deben haber sido procesadas exitosamente
        for status_code, data in resultados:
            self.assertEqual(status_code, 200)
            self.assertTrue(data["ok"])
            self.assertEqual(len(data["aceptados"]), 1)

        # Estado consolidado final
        estado = self.sync_svc.estado()
        self.assertEqual(estado["registros_campo"], 20)
        self.assertGreaterEqual(estado["epoch"], 20)

        # Historial con atribución correcta
        hist = self.sync_svc.historial(limite=50)
        self.assertEqual(len(hist), 20)
        operadores = {r["operador"] for r in hist}
        self.assertIn("usr_admin", operadores)
        self.assertIn("usr_jose", operadores)

    def test_concurrent_duplicate_pushes_idempotent(self):
        """Mismo lote de mutaciones enviado simultáneamente desde dos conexiones."""
        token = self._token("usr_jose")
        mutacion = {
            "uuid": "uuid-duplicate-race-001",
            "tipo": "parto",
            "crotal": "ES083710851728",
            "ts_dispositivo": "2026-10-07T12:30:00",
            "payload": {
                "fecha_parto": "2026-10-07",
                "cria_crotal": "ES083710999999",
                "cria_sexo": "Macho",
            },
        }

        def enviar_mismo_parto(_):
            return self.client.post(
                "/api/sync/push",
                headers={"Authorization": f"Bearer {token}"},
                json={"device_id": "movil-jose", "changes": [mutacion]},
            )

        with ThreadPoolExecutor(max_workers=3) as executor:
            resps = list(executor.map(enviar_mismo_parto, range(3)))

        for r in resps:
            self.assertEqual(r.status_code, 200)

        # Exactamente 1 registro insertado en la BD
        conn = sqlite3.connect(self.maestra)
        count = conn.execute("SELECT COUNT(*) FROM campo_registros WHERE uuid = 'uuid-duplicate-race-001'").fetchone()[0]
        conn.close()
        self.assertEqual(count, 1)

    def test_push_parto_schema_validation(self):
        """Valida que una mutación de parto con campos correctos sea aceptada y guardada."""
        token = self._token("usr_admin")
        parto_valido = {
            "uuid": "uuid-parto-valido-001",
            "tipo": "parto",
            "crotal": "ES083710851728",
            "ts_dispositivo": "2026-10-07T14:00:00",
            "payload": {
                "fecha_parto": "2026-10-07",
                "cria_crotal": "C-1728-E2E",
                "cria_sexo": "Hembra",
                "incidencias": "Nacimiento gemelar asistido",
            },
        }
        resp = self.client.post(
            "/api/sync/push",
            headers={"Authorization": f"Bearer {token}"},
            json={"device_id": "tablet-campo", "changes": [parto_valido]},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("uuid-parto-valido-001", data["aceptados"])

        # Verificar contenido en base de datos SQLite
        conn = sqlite3.connect(self.maestra)
        row = conn.execute(
            "SELECT tipo, operador, payload FROM campo_registros WHERE uuid = 'uuid-parto-valido-001'"
        ).fetchone()
        conn.close()
        self.assertIsNotNone(row)
        self.assertEqual(row[0], "parto")
        self.assertEqual(row[1], "usr_admin")
        self.assertIn("Nacimiento gemelar", row[2])

    def test_rbac_security_admin_vs_operator(self):
        """Certifica que solo usuarios admin pueden realizar importaciones de base de datos."""
        token_jose = self._token("usr_jose")
        token_admin = self._token("usr_admin")

        # 1. Jose (operador estándar) intenta importar BD -> 403 Forbidden
        resp_jose = self.client.post(
            "/api/sync/import",
            headers={"Authorization": f"Bearer {token_jose}"},
            files={"file": ("censo.sqlite", DEMO.read_bytes(), "application/octet-stream")},
        )
        self.assertEqual(resp_jose.status_code, 403)
        self.assertIn("Solo el propietario", resp_jose.json()["detail"])

        # 2. Jose intenta cambiar contraseña global -> 403 Forbidden
        resp_pwd_jose = self.client.post(
            "/api/auth/change-password",
            headers={"Authorization": f"Bearer {token_jose}"},
            json={"current_password": "mvp-testing", "new_password": "claveSegura123"},
        )
        self.assertEqual(resp_pwd_jose.status_code, 403)

        # 3. Álvaro (admin) importa BD con éxito
        resp_admin = self.client.post(
            "/api/sync/import",
            headers={"Authorization": f"Bearer {token_admin}"},
            files={"file": ("censo.sqlite", DEMO.read_bytes(), "application/octet-stream")},
        )
        self.assertEqual(resp_admin.status_code, 200)
        self.assertTrue(resp_admin.json()["ok"])
