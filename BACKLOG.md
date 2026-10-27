# Backlog. Ganaderos v2 (gestión ganadera extensiva y cebadero)
 
Este documento recoge las fuentes de información externas o heredadas y el backlog de funcionalidades priorizadas para la explotación.
 
---
 
## 1. Repositorio de información dispersa y fuentes externas
 
La explotación opera bajo dos códigos REGA:
- Explotación de reproductoras (pastos y dehesa, REGA terminado en `121`): vacas nodrizas, sementales y terneros lactantes en régimen extensivo.
- Cebadero de terneros (REGA terminado en `122`): terneros destetados en régimen de cebo intensivo hasta peso de sacrificio o venta.
 
### Fuentes de datos en proceso de unificación
 
| Fuente | Formato actual | Ubicación o origen | Entidades principales | Objetivo de integración |
| :--- | :--- | :--- | :--- | :--- |
| MoGa (ITACyL / SACPA) | CSV, Excel, portal web | Junta de Castilla y León | Crotal oficial (14 dígitos), fecha alta, fecha baja, madre, REGA actual | Conciliar el censo oficial con el censo físico en campo y detectar discrepancias con la administración. |
| Báscula de manga y tolva | Cuaderno de campo, báscula digital | Cebadero (122) | Crotal, fecha de pesaje, kg vivos, lote | Calcular la ganancia media diaria (GMD), días de cebo y previsión de peso de sacrificio. |
| Albaranes de piensos | Papel, facturas PDF | Cooperativas (Copiso, etc.) | Fecha, producto (tacos de campo, pienso de cebo), kg o toneladas, precio por tonelada | Trazabilidad del consumo y coste de alimentación por cabeza y corral. |
| Recetas veterinarias | Archivos PDF oficiales (Colvele, etc.) | Correo veterinario, escáner | Medicamento, tiempo de espera en carne, número de receta, REGA | Ingesta automática mediante `python/recetas-mvp/` a `bdlibro.mdb` y exportación a la PWA. |
| Base histórica Ganaderos 10 | Microsoft Access `.mdb` (Jet 32-bit) | PC de oficina (`C:\GANADEROS 10\bdlibro.mdb`) | Animales, partos, movimientos, medicamentos | Migración continua mediante `scripts/sync_access_merge.py` hacia SQLite y repositorio Git de respaldo. |
 
---
 
## 2. Épicas y casos de uso priorizados
 
### Épica 1: conciliación oficial con MoGa (ITACyL)
- [ ] US-101 (Importador MoGa): procesador CLI y web para exportaciones CSV del censo oficial de Castilla y León.
- [ ] US-102 (Detector de discrepancias):
  - Animales en el censo físico ausentes en MoGa (crotales sin tramitar o errores de guía).
  - Animales dados de baja en la Junta que figuran activos en el censo.
  - Vacas reproductoras con código de explotación no coincidente (traspasos pendientes de regularizar).
- [ ] US-103 (Informe de regularización): generación de informe para la unidad veterinaria de la Junta.
 
### Épica 2: control de peso y ganancia media diaria (GMD) [DESCARTADA / YAGNI]
- [x] **Descarte explícito por directriz del ganadero (KISS / YAGNI)**: En la operativa real en campo y dehesa no se realizan pesajes manuales en manga ni báscula. El único peso verificado y vinculante es el **peso a la canal** liquidado en matadero (Ganavaex).
- ~~US-201~~ (Esquema de pesajes manuales en SQLite): suprimido por YAGNI.
- ~~US-202~~ (Cálculo de GMD manual): sustituido por el cuadro de mando oficial de liquidaciones y rendimiento en canal.
- ~~US-203~~ (Previsión de salida a matadero por báscula): suprimido; el ganadero controla el punto óptimo mediante días de estancia y penalización por sobrepeso (>350 kg canal) auditado en facturas.







### Épica 3: trazabilidad sanitaria y libro digital de explotación
- [ ] US-301 (Exportador de hoja de tratamientos oficial):
  - Generar informe PDF conforme a la normativa de sanidad animal de Castilla y León para inspecciones veterinarias.
- [x] US-302 (Alerta de fin de retirada sanitaria):
  - Banner interactivo de alta visibilidad en la ficha del animal si está en periodo de supresión médica.

### Épica 4: costes de alimentación y control de silos
- [x] US-401 (Módulo de piensos y albaranes):
  - Consulta offline de albaranes de pienso, desglose de kilos, tipo de producto y coste por tonelada.
- [ ] US-402 (Control de stock en silos):
  - Estimación de niveles de tolvas según consumo animal y albaranes recibidos.

### Épica 5: análisis económico, devengo de cebo y lonjas agropecuarias
- [ ] US-501 (Doble perspectiva: tesorería vs margen técnico por ciclo de cebo):
  - Separar explícitamente en la PWA la visión de **Tesorería / Cash Flow** (entradas y salidas bancarias del mes) del **Margen Técnico de Cebo** (devengo biológico).
  - Imputar a cada ternero vendido el coste del pienso consumido durante sus días reales de estancia en el cebadero (`122`):
    $$D = \text{Fecha Sacrificio} - \text{Fecha Entrada Cebadero}$$
    $$\text{Pienso Imputado} = \Delta PV \times \text{FCR (4.8 - 5.2 kg/kg)} \times \bar{P}_{\text{pienso}}$$
- [ ] US-502 (Ventana móvil acumulada LTM de 12 meses):
  - Gráfico de balance con media móvil de 12 meses para neutralizar el desfase estacional y los picos de llenado de silos.
- [ ] US-503 (Ingesta semanal de la Lonja de Salamanca):
  - Tabla SQLite `cotizaciones_lonja` (`fecha`, `mesa`, `categoria`, `unidad`, `precio`, `variacion`).
  - Script semanal en la Orange Pi para descargar e ingestar las sesiones de los lunes desde `datosabiertossalamanca.es` (añojo extra, ternera, vaca desvieje, cebada, maíz).
- [ ] US-504 (Auditoría de liquidaciones y prima sobre lonja):
  - Comparar el precio liquidado en matadero (€/kg canal) con la cotización de la Lonja de Salamanca de la semana de sacrificio, mostrando la prima o descuento obtenido por lote y animal.
- [ ] US-505 (Detección y coste de sobrepeso en canal):
  - Cuantificar la penalización por exceso de peso (>350 kg canal en añojos) y el coste de los días extra de pienso consumido frente al punto óptimo de sacrificio.
- [ ] US-506 (Herramienta analítica de materias primas y timing de compra):
  - Gráfico comparativo de la evolución de cereales en lonja (cebada y maíz) frente a los precios de albaranes de pienso compuesto, proporcionando al ganadero una herramienta visual para evaluar el momento oportuno de reposición de silos sin recomendaciones automáticas invasivas.
 
---
 
## 3. Deuda técnica y mejoras de infraestructura
 
- [x] Concurrencia SQLite en modo WAL e inserciones idempotentes en Access.
- [x] Respaldo automático atómico con confirmación y envío a repositorio Git remoto privado.
- [x] Detección de versiones entre PC y móvil con `/api/database/meta`, aviso visual en interfaz y registro de auditoría local.
- [x] Conexión de `python/recetas-mvp` con la exportación mediante `--force-export` y scripts batch.
- [ ] Migrar la operativa de oficina a interfaz web servida desde la Orange Pi, eliminando la dependencia del controlador Jet OLEDB x86 de Microsoft Access.
- [ ] Respaldo diario automático programado en la Orange Pi hacia memoria USB en `/mnt/usb`.

