"""Tests unitarios para el selector y auditor dinámico de modelos de IA."""

import unittest
from unittest.mock import MagicMock, patch

from scripts.select_models import (
    descubrir_gemini_models,
    descubrir_groq_models,
    descubrir_openrouter_free,
    parsear_version_gemini,
)


class TestModelSelector(unittest.TestCase):
    def test_parsear_version_gemini(self):
        """Valida la extracción precisa de versiones decimales en nombres de modelos Gemini."""
        self.assertEqual(parsear_version_gemini("gemini-3.8-flash"), 3.8)
        self.assertEqual(parsear_version_gemini("gemini-3.7-flash"), 3.7)
        self.assertEqual(parsear_version_gemini("gemini-3.5-flash-lite"), 3.5)
        self.assertEqual(parsear_version_gemini("gemini-3.1-flash-lite-preview"), 3.1)
        self.assertEqual(parsear_version_gemini("other-model"), 0.0)

    @patch("urllib.request.urlopen")
    def test_descubrir_gemini_models(self, mock_urlopen):
        """Valida que los modelos Gemini se ordenen por versión decimal y se descarten pre-3.0."""
        mock_response = MagicMock()
        mock_response.read.return_value = b"""{
            "models": [
                {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/gemini-3.5-flash-lite", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/gemini-3.8-flash", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/gemini-3.7-flash", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/gemini-3.1-flash-image", "supportedGenerationMethods": ["generateContent"]}
            ]
        }"""
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        candidatos = descubrir_gemini_models("fake-key")

        # gemini-2.5-flash (pre-3.0) y gemini-3.1-flash-image (imagen) deben ser excluidos
        nombres = [c["model"] for c in candidatos]
        self.assertNotIn("gemini-2.5-flash", nombres)
        self.assertNotIn("gemini-3.1-flash-image", nombres)

        # Orden por versión decreciente: 3.8 > 3.7 > 3.5-lite
        self.assertEqual(nombres, ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash-lite"])

    @patch("urllib.request.urlopen")
    def test_descubrir_openrouter_free_filters(self, mock_urlopen):
        """Valida que OpenRouter filtre estrictamente modelos con :free y verifique tools."""
        mock_response = MagicMock()
        mock_response.read.return_value = b"""{
            "data": [
                {
                    "id": "meta-llama/llama-3.3-70b-instruct",
                    "name": "Llama 3.3 70B",
                    "supported_parameters": ["tools"]
                },
                {
                    "id": "poolside/laguna-s-2.1:free",
                    "name": "Poolside Laguna S 2.1 (free)",
                    "supported_parameters": ["tools"]
                },
                {
                    "id": "z-ai/glm-5.2:free",
                    "name": "GLM 5.2 (free)",
                    "supported_parameters": ["temperature"]
                }
            ]
        }"""
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        modelos = descubrir_openrouter_free()

        # Debe incluir sólo poolside/laguna-s-2.1:free y descartar los no-free
        ids = [m["model"] for m in modelos]
        self.assertIn("poolside/laguna-s-2.1:free", ids)
        self.assertNotIn("meta-llama/llama-3.3-70b-instruct", ids)

        # z-ai/glm-5.2:free no tiene soporte de tools
        for m in modelos:
            if m["model"] == "z-ai/glm-5.2:free":
                self.assertFalse(m["soporta_tools"])
            elif m["model"] == "poolside/laguna-s-2.1:free":
                self.assertTrue(m["soporta_tools"])

    @patch("urllib.request.urlopen")
    def test_descubrir_groq_models_prioritizes_qwen(self, mock_urlopen):
        """Valida que Groq priorice Qwen 3.8 27B y respete excluir_gpt_oss."""
        mock_response = MagicMock()
        mock_response.read.return_value = b"""{
            "data": [
                {"id": "qwen/qwen3.8-27b"},
                {"id": "openai/gpt-oss-120b"},
                {"id": "whisper-large-v3"}
            ]
        }"""
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        # Sin excluir gpt-oss
        modelos_con = descubrir_groq_models("fake-key", excluir_gpt_oss=False)
        self.assertEqual(modelos_con[0]["model"], "qwen/qwen3.8-27b")
        self.assertEqual(modelos_con[1]["model"], "openai/gpt-oss-120b")

        # Excluyendo gpt-oss
        modelos_sin = descubrir_groq_models("fake-key", excluir_gpt_oss=True)
        self.assertEqual(len(modelos_sin), 1)
        self.assertEqual(modelos_sin[0]["model"], "qwen/qwen3.8-27b")


if __name__ == "__main__":
    unittest.main()
