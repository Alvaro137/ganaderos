// tests/frontend/test_modules.mjs
import { resolverConsultaOffline } from '../../pwa/js/modules/heuristics.js';
import { extraer4Digitos, calcularEdad } from '../../pwa/js/modules/config.js';

console.log("Ejecutando tests de frontend...");

let p1 = resolverConsultaOffline("ficha vaca 1045");
if (p1 && p1.params[0] === "1045") {
  console.log("Test Heuristicas 1: PASADO");
} else {
  console.error("Test Heuristicas 1: FALLADO");
}

let c = extraer4Digitos("ES080000001045");
if (c === "1045") {
  console.log("Test Extraer 4 Digitos: PASADO");
} else {
  console.error("Test Extraer 4 Digitos: FALLADO");
}

console.log("Todos los tests finalizados.");
