// modules/heuristics.js
export function resolverConsultaOffline(textoPrompt) {
  const p = textoPrompt.trim().toLowerCase();
  const mCrotal = p.match(/\b(\d{4})\b/);

  if (mCrotal) {
    const c4 = mCrotal[1];
    if (p.includes("parto") || p.includes("cria") || p.includes("cría") || p.includes("hijo")) {
      return {
        sql: "SELECT p.id, p.fecha_parto, p.cria_crotal, p.cria_sexo, a.crotal_4 as cria_crotal_4, a.raza as cria_raza, a.estado as cria_estado FROM partos p LEFT JOIN animales a ON p.cria_crotal = a.crotal WHERE p.madre_crotal IN (SELECT crotal FROM animales WHERE crotal_4 = ?) ORDER BY p.fecha_parto DESC",
        params: [c4],
        interpretacion: `Partos y descendencia de la madre ${c4} (Modo sin cobertura).`,
        tipo_resultado: "partos",
        offline: true
      };
    }
    return {
      sql: "SELECT * FROM animales WHERE crotal_4 = ? AND estado = 'A' LIMIT 1",
      params: [c4],
      interpretacion: `Ficha técnica de la cabeza con crotal ${c4} (Modo sin cobertura).`,
      tipo_resultado: "animales",
      offline: true
    };
  }

  if (p.includes("traspaso") || p.includes("traslado")) {
    return {
      sql: "SELECT m.id, m.crotal, m.fecha, m.tipo, m.origen, m.destino, m.corral, a.crotal_4, a.sexo, a.raza FROM movimientos m LEFT JOIN animales a ON m.crotal = a.crotal WHERE m.origen LIKE '%121%' AND m.destino LIKE '%122%' ORDER BY m.fecha DESC LIMIT 20",
      params: [],
      interpretacion: "Últimos traspasos registrados hacia el cebadero 122 (Modo sin cobertura).",
      tipo_resultado: "movimientos",
      offline: true
    };
  }

  const corrales = ["dueña", "espadaña", "rivera", "vega", "cebadero"];
  for (const c of corrales) {
    if (p.includes(c)) {
      return {
        sql: "SELECT * FROM animales WHERE UPPER(corral) LIKE ? AND estado = 'A' ORDER BY crotal_4 ASC",
        params: [`%${c.toUpperCase()}%`],
        interpretacion: `Animales censados en lote ${c.toUpperCase()} (Modo sin cobertura).`,
        tipo_resultado: "animales",
        offline: true
      };
    }
  }

  if (p.includes("sin parir") || p.includes("vacia") || p.includes("vacía")) {
    return {
      sql: "SELECT * FROM animales WHERE (sexo = 'Vaca' OR sexo LIKE 'Hembra%') AND estado = 'A' AND (fecha_ult_parto IS NULL OR fecha_ult_parto = '' OR total_partos = 0) ORDER BY fecha_nacimiento ASC",
      params: [],
      interpretacion: "Vacas adultas sin partos registrados (Modo sin cobertura).",
      tipo_resultado: "animales",
      offline: true
    };
  }

  if (p.includes("supresion") || p.includes("supresión") || p.includes("retirada") || p.includes("medicamento")) {
    return {
      sql: "SELECT r.id, r.fecha, r.receta, r.medicamento, r.n_animales, r.tiempo_carne, r.veterinario, r.cea, date(r.fecha, '+' || CAST(r.tiempo_carne AS TEXT) || ' days') AS fin_supresion FROM recetas r WHERE r.tiempo_carne > 0 AND date(r.fecha, '+' || CAST(r.tiempo_carne AS TEXT) || ' days') >= date('now') ORDER BY fin_supresion ASC LIMIT 20",
      params: [],
      interpretacion: "Tratamientos veterinarios con retirada sanitaria activa (Modo sin cobertura).",
      tipo_resultado: "recetas",
      offline: true
    };
  }

  return null;
}
