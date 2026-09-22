// modules/heuristics.js
/**
 * Motor Heurístico Offline para Consultas en Campo (Principio DRY).
 * Sincronizado de forma determinista con el catálogo y reglas de la pasarela backend
 * (src/infrastructure/llm_gateway.py y src/application/query_builder.py).
 */

export function resolverConsultaOffline(textoPrompt) {
  let p = textoPrompt.trim().toLowerCase();

  // 1. Normalizar espacios en números partidos por transcripción de Whisper (ej. "10 45" -> "1045")
  p = p.replace(/\b(\d{2})\s+(\d{2})\b/g, "$1$2");

  // 2. Detección de crotal: 4 dígitos o código oficial completo (ej. ES083710104599 -> 4599)
  const mOficial = p.match(/\b(?:es)?\d{8,12}(\d{4})\b/);
  const m4dig = p.match(/\b(\d{4})\b/);
  const crotalDetectado = m4dig ? m4dig[1] : (mOficial ? mOficial[1] : null);

  // 3. Historial de partos, descendencia o becerros de una vaca nodriza
  const palabrasParto = ["parto", "cría", "cria", "hijo", "descendencia", "becerro", "ternero", "nacid"];
  if (crotalDetectado && palabrasParto.some((w) => p.includes(w))) {
    return {
      sql: `
        SELECT p.id, p.fecha_parto, p.cria_crotal, p.cria_sexo, p.incidencias,
               a.crotal_4 as cria_crotal_4, a.raza as cria_raza, a.estado as cria_estado, a.corral as cria_corral
        FROM partos p
        LEFT JOIN animales a ON p.cria_crotal = a.crotal
        WHERE p.madre_crotal IN (SELECT crotal FROM animales WHERE crotal_4 = ?)
        ORDER BY p.fecha_parto DESC
      `.trim(),
      params: [crotalDetectado],
      interpretacion: `Partos y descendencia de la madre con crotal ${crotalDetectado} (Modo sin cobertura).`,
      tipo_resultado: "partos",
      offline: true
    };
  }

  // 4. Ficha individual de animal
  const palabrasFicha = ["ficha", "vaca", "animal", "crotal", "dato"];
  const tokens = p.split(/\s+/).filter(Boolean);
  if (crotalDetectado && (palabrasFicha.some((w) => p.includes(w)) || tokens.length <= 2)) {
    return {
      sql: "SELECT * FROM animales WHERE crotal_4 = ? AND estado = 'A' LIMIT 1",
      params: [crotalDetectado],
      interpretacion: `Ficha técnica de la cabeza con crotal ${crotalDetectado} (Modo sin cobertura).`,
      tipo_resultado: "animales",
      offline: true
    };
  }

  // 5. Traspasos entre explotaciones (121 vida vs 122 cebadero) - evaluar antes de corrales
  if (p.includes("traspaso") || p.includes("traslad") || p.includes("movimiento")) {
    return {
      sql: `
        SELECT m.id, m.crotal, m.fecha, m.tipo, m.origen, m.destino, m.corral,
               a.crotal_4, a.sexo, a.raza
        FROM movimientos m
        LEFT JOIN animales a ON m.crotal = a.crotal
        WHERE (m.origen LIKE '%121%' AND m.destino LIKE '%122%') OR m.tipo LIKE '%TRASPASO%'
        ORDER BY m.fecha DESC LIMIT 20
      `.trim(),
      params: [],
      interpretacion: "Últimos traspasos registrados hacia el cebadero 122 (Modo sin cobertura).",
      tipo_resultado: "movimientos",
      offline: true
    };
  }

  // 6. Compras y gastos de alimentación / pienso - evaluar antes de corrales
  const palabrasAlimento = ["pienso", "alimento", "compra", "gasto", "tolva", "albaran", "albarán"];
  if (palabrasAlimento.some((w) => p.includes(w))) {
    return {
      sql: `
        SELECT id, fecha, albaran, proveedor, producto, kilos, precio_kg, importe_total
        FROM compras_alimento
        ORDER BY fecha DESC LIMIT 20
      `.trim(),
      params: [],
      interpretacion: "Albaranes y compras de alimentación para el ganado (Modo sin cobertura).",
      tipo_resultado: "alimentos",
      offline: true
    };
  }

  // 7. Medicamento más usado / tratamientos más frecuentes
  if ((p.includes("medicamento") || p.includes("tratamiento")) &&
      (p.includes("más") || p.includes("mas") || p.includes("frecuente") || p.includes("usado") || p.includes("recetad"))) {
    return {
      sql: `
        SELECT medicamento, COUNT(*) AS total_recetas, SUM(n_animales) AS total_animales_tratados,
               MAX(tiempo_carne) AS max_supresion_dias
        FROM recetas
        GROUP BY medicamento
        ORDER BY total_recetas DESC LIMIT 10
      `.trim(),
      params: [],
      interpretacion: "Medicamentos y tratamientos veterinarios más prescritos (Modo sin cobertura).",
      tipo_resultado: "recetas",
      offline: true
    };
  }

  // 8. Tratamientos con supresión sanitaria / tiempo de espera activo
  if (p.includes("supresion") || p.includes("supresión") || p.includes("retirada") || p.includes("medicamento") || p.includes("receta")) {
    return {
      sql: `
        SELECT r.id, r.fecha, r.receta, r.medicamento, r.n_animales, r.tiempo_carne, r.veterinario, r.cea,
               date(r.fecha, '+' || CAST(r.tiempo_carne AS TEXT) || ' days') AS fin_supresion
        FROM recetas r
        WHERE r.tiempo_carne > 0 AND date(r.fecha, '+' || CAST(r.tiempo_carne AS TEXT) || ' days') >= date('now')
        ORDER BY fin_supresion ASC LIMIT 20
      `.trim(),
      params: [],
      interpretacion: "Tratamientos veterinarios con retirada sanitaria activa (Modo sin cobertura).",
      tipo_resultado: "recetas",
      offline: true
    };
  }

  // 9. Vacas adultas sin parir / nodrizas vacías
  if (p.includes("sin parir") || p.includes("vacia") || p.includes("vacía") || p.includes("no pare") || p.includes("no paren") || p.includes("nodriza")) {
    return {
      sql: `
        SELECT * FROM animales
        WHERE (sexo = 'Vaca' OR sexo LIKE 'Hembra%') AND estado = 'A'
          AND (fecha_ult_parto IS NULL OR fecha_ult_parto = '' OR total_partos = 0)
        ORDER BY fecha_nacimiento ASC
      `.trim(),
      params: [],
      interpretacion: "Vacas nodrizas adultas sin partos registrados (Modo sin cobertura).",
      tipo_resultado: "animales",
      offline: true
    };
  }

  // 10. Censo por cercado o corral de pasto conocido
  const corrales = ["dueña", "duena", "espadaña", "espadana", "rivera", "vega", "cebadero"];
  for (const c of corrales) {
    if (p.includes(c)) {
      const normC = (c.includes("due")) ? "DUEÑA" : ((c.includes("espad")) ? "ESPADAÑA" : c.toUpperCase());
      return {
        sql: "SELECT * FROM animales WHERE UPPER(corral) LIKE ? AND estado = 'A' ORDER BY crotal_4 ASC",
        params: [`%${normC}%`],
        interpretacion: `Animales censados en lote ${normC} (Modo sin cobertura).`,
        tipo_resultado: "animales",
        offline: true
      };
    }
  }

  return null;
}
