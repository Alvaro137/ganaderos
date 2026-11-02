"""Tests unitarios para el script de lanzamiento inteligente de Ganaderos 10."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from scripts.ganaderos_launcher import (
    ejecutar_sync_access,
    esperar_cierre_access,
    lanzar_ganaderos_access,
    main,
)


def test_ejecutar_sync_access_llamada_correcta(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    mock_run = MagicMock()
    mock_run.return_value.returncode = 0
    monkeypatch.setattr("subprocess.run", mock_run)

    dummy_mdb = tmp_path / "bdlibro.mdb"
    dummy_mdb.touch()

    exito = ejecutar_sync_access(
        source_mdb=dummy_mdb,
        api_url="https://test.api",
        pwa_password="secret_pass",
        force_export=True,
        dry_run=False,
    )

    assert exito is True
    assert mock_run.called
    cmd_args = mock_run.call_args[0][0]
    assert "--source" in cmd_args
    assert str(dummy_mdb) in cmd_args
    assert "--force-export" in cmd_args
    assert "--api-url" in cmd_args
    assert "https://test.api" in cmd_args


def test_lanzar_ganaderos_access_custom_exe(tmp_path: Path) -> None:
    dummy_exe = tmp_path / "Ganaderos.exe"
    dummy_exe.touch()
    dummy_mdb = tmp_path / "bdlibro.mdb"

    with patch("subprocess.Popen") as mock_popen:
        res = lanzar_ganaderos_access(dummy_mdb, app_exe=dummy_exe)
        assert res is True
        mock_popen.assert_called_once_with([str(dummy_exe)])


def test_lanzar_ganaderos_access_startfile_win32(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    dummy_mdb = tmp_path / "bdlibro.mdb"
    dummy_mdb.touch()

    monkeypatch.setattr("sys.platform", "win32")
    mock_startfile = MagicMock()
    monkeypatch.setattr("os.startfile", mock_startfile, raising=False)

    res = lanzar_ganaderos_access(dummy_mdb, app_exe=None)
    assert res is True
    mock_startfile.assert_called_once_with(str(dummy_mdb))


def test_esperar_cierre_access(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    dummy_mdb = tmp_path / "bdlibro.mdb"

    # Simular: primero bloqueado (True), luego se libera (False)
    estados_bloqueo = [True, True, False]

    def mock_bloqueada(_path: Path) -> bool:
        if estados_bloqueo:
            return estados_bloqueo.pop(0)
        return False

    monkeypatch.setattr("scripts.ganaderos_launcher.esta_bloqueada_por_access", mock_bloqueada)
    monkeypatch.setattr("time.sleep", lambda _: None)

    # Debe retornar sin excepciones al liberarse
    esperar_cierre_access(dummy_mdb, max_espera_inicio=5)
    assert len(estados_bloqueo) == 0


def test_main_bd_no_existe(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    no_existe = tmp_path / "inexistente.mdb"
    test_args = ["ganaderos_launcher.py", "--source", str(no_existe)]
    monkeypatch.setattr("sys.argv", test_args)

    with patch("scripts.ganaderos_launcher.mostrar_notificacion_windows"):
        exit_code = main()
        assert exit_code == 1


def test_main_no_launch_solo_pre_sync(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    dummy_mdb = tmp_path / "bdlibro.mdb"
    dummy_mdb.touch()

    test_args = ["ganaderos_launcher.py", "--source", str(dummy_mdb), "--no-launch"]
    monkeypatch.setattr("sys.argv", test_args)
    monkeypatch.setattr("scripts.ganaderos_launcher.esta_bloqueada_por_access", lambda _: False)

    mock_sync = MagicMock(return_value=True)
    monkeypatch.setattr("scripts.ganaderos_launcher.ejecutar_sync_access", mock_sync)

    exit_code = main()
    assert exit_code == 0
    assert mock_sync.call_count == 1
    call_kwargs = mock_sync.call_args[1]
    assert call_kwargs["force_export"] is False
