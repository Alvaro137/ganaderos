"""Tests automatizados de regresión para la suite de benchmarking del asistente de IA."""

import unittest

from scripts.run_ai_benchmark import DATASET_PATH, ejecutar_benchmark


class TestAIBenchmarkRegression(unittest.TestCase):
    def setUp(self):
        self.dataset_path = DATASET_PATH
        self.assertTrue(self.dataset_path.exists(), f"El dataset no existe en {self.dataset_path}")

    def test_benchmark_intent_accuracy_threshold(self):
        """Valida que la precisión de clasificación del asistente no descienda del 90%."""
        results, metrics = ejecutar_benchmark(self.dataset_path)

        self.assertGreater(metrics["total_cases"], 40, "El dataset debe contener al menos 40 casos.")
        self.assertGreaterEqual(
            metrics["intent_accuracy"],
            0.90,
            f"Regresión detectada: Intent accuracy {metrics['intent_accuracy']*100:.1f}% es inferior al 90%."
        )

    def test_benchmark_args_accuracy_threshold(self):
        """Valida que la extracción de argumentos (AST Match) sea superior al 85%."""
        _, metrics = ejecutar_benchmark(self.dataset_path)

        self.assertGreaterEqual(
            metrics["args_accuracy"],
            0.85,
            f"Regresión en extracción de argumentos: {metrics['args_accuracy']*100:.1f}% es inferior al 85%."
        )

    def test_benchmark_sql_query_validity(self):
        """Valida que el 100% de las intenciones generen consultas SQL parametrizadas válidas."""
        _, metrics = ejecutar_benchmark(self.dataset_path)

        self.assertEqual(
            metrics["query_validity_rate"],
            1.0,
            f"Fallo en construcción de consultas SQL: tasa de validez {metrics['query_validity_rate']*100:.1f}% != 100%."
        )

    def test_ast_validation_latency_budget(self):
        """Valida que el tiempo de verificación AST y compilación SQL P95 sea inferior a 15 ms."""
        _, metrics = ejecutar_benchmark(self.dataset_path)

        self.assertLess(
            metrics["latency_p95_ms"],
            15.0,
            f"Latencia de verificación excesiva: {metrics['latency_p95_ms']:.3f} ms supera el presupuesto de 15 ms."
        )


if __name__ == "__main__":
    unittest.main()
