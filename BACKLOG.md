# BACKLOG — Ganaderos v2 (Gestión Ganadera Extensiva y Cebadero)

Este documento centraliza el mapa de información dispersa (legacy/externa) y el backlog de funcionalidades priorizadas para la explotación ganadera.

---

## 🗺️ 1. Repositorio de Información Dispersa y Fuentes Externas

La explotación opera bajo una estructura dual:
- **Explotación de Reproductoras de Vida (Pastos/Dehesa)**: Código REGA terminado en **`121`**. Vacas nodrizas, sementales y terneros lactantes en régimen extensivo.
- **Cebadero de Terneros**: Código REGA terminado en **`122`**. Terneros destetados en régimen de cebo intensivo hasta peso de sacrificio/venta.

### Fuentes de Datos en Proceso de Unificación:

| Fuente | Formato Actual | Ubicación / Origen | Entidades Principales | Objetivo de Integración |
| :--- | :--- | :--- | :--- | :--- |
| **MoGa (ITACyL / SACPA)** | CSV / Excel / Portal Web | Junta de Castilla y León | Crotal oficial (14 dgt), fecha alta, fecha baja, madre, REGA actual | Conciliación de censo oficial con censo físico real en campo. Detección de discrepancias con la administración. |
| **Báscula de Manga y Tolva** | Cuaderno de campo / Báscula digital | Cebadero (122) | Crotal, fecha pesaje, kg vivos, lote | Cálculo automático de Ganancia Media Diaria (GMD), días de cebo y previsión de peso de sacrificio. |
| **Albaranes de Piensos** | Papel / Facturas PDF | Cooperativas (Copiso, etc.) | Fecha, producto (tacos campo / pienso cebo), kg/tn, precio/tn | Trazabilidad del consumo y coste de alimentación por cabeza y corral. |
| **Recetas Veterinarias** | PDFs oficiales (Colvele, etc.) | Correo veterinario / Scanner | Medicamento, tiempo de espera en carne, número de receta, REGA | Ingesta automática mediante `python/recetas-mvp/` a `bdlibro.mdb` y exportación a la PWA móvil. |
| **Base Histórica Ganaderos 10** | Microsoft Access `.mdb` (Jet 32-bit) | PC de oficina (`C:\GANADEROS 10\bdlibro.mdb`) | Animales, Partos, Movimientos, Medicamentos | Migración continua mediante `scripts/sync_access_merge.py` hacia SQLite y Git Backup Vault. |

---

## 📋 2. Épicas y Casos de Uso Priorizados

### Épica 1: Conciliación Oficial MoGa (ITACyL)
- [ ] **US-101 (Importador MoGa)**: Parser CLI y web para procesar exportaciones CSV del censo oficial de Castilla y León.
- [ ] **US-102 (Detector de Discrepancias)**:
  - Animales presentes en el censo físico pero ausentes en MoGa (crotales sin tramitar o errores de guía).
  - Animales dados de baja en la Junta pero todavía marcados como activos en el censo.
  - Vacas reproductoras con código de explotación no coincidente (traspasos pendientes de regularizar).
- [ ] **US-103 (Informe de Regularización)**: Generación de lista lista para enviar a la Unidad Veterinaria de la Junta.

### Épica 2: Control Ponderal y Rendimiento de Crecimiento (GMD)
- [ ] **US-201 (Esquema de Pesajes en SQLite)**:
  - Tabla `Pesajes`: `id`, `animal_id`, `fecha`, `peso_kg`, `tipo` (Destete, Control, Salida), `operador`.
- [ ] **US-202 (Cálculo de GMD en Ficha)**:
  - En la ficha técnica de la PWA, mostrar gráfica de evolución de peso y GMD:  
    $$\text{GMD} = \frac{\text{Peso Actual} - \text{Peso Anterior}}{\text{Días Transcurridos}} \quad (\text{kg/día})$$
- [ ] **US-203 (Previsión de Salida a Matadero)**:
  - Estimación de la fecha en que el animal alcanzará los 520-540 kg comerciales en base a su GMD histórica.

### Épica 3: Trazabilidad Sanitaria y Libro Digital de Explotación
- [ ] **US-301 (Exportador de Hoja de Tratamientos Oficial)**:
  - Generación de informe PDF conforme a la normativa de sanidad animal de CyL para inspecciones veterinarias.
- [ ] **US-302 (Alerta de Fin de Retirada)**:
  - Notificación visual clara en la PWA si un animal en periodo de retirada sanitaria es seleccionado para traslado o venta.

### Épica 4: Costes de Alimentación y Control de Silos
- [ ] **US-401 (Módulo de Silos)**:
  - Registro de albaranes de pienso y seguimiento del stock remanente en tolvas/silos.
- [ ] **US-402 (Coste Alimentario por Ternero)**:
  - Imputación estimada de coste de pienso por lote durante el periodo de cebo.

---

## 🛠️ 3. Deuda Técnica y Mejoras de Infraestructura

- [x] **WAL Mode & 2PC en Access**: Blindaje de concurrencia SQLite WAL e idempotencia en Access completado.
- [x] **Git Backup Vault Inmutable**: Respaldo automático atómico con git commit y push a repositorio remoto privado.
- [x] **Sync UX & Banner CTA**: Detección de versiones PC -> Móvil con `/api/database/meta`, badge interactivo y registro de auditoría local.
- [x] **Integración Recetas MVP**: Conexión de `python/recetas-mvp` con el hub mediante `--force-export` y scripts batch directos.
- [ ] **Desacoplamiento Total de Access 32-bit**: A medio plazo, migrar la operativa de oficina a interfaz web servida directamente desde la Orange Pi, eliminando la dependencia del driver Jet OLEDB x86 de Microsoft.
- [ ] **Backup Automático en Pen USB**: Cron/systemd timer en la Orange Pi para volcar copia física timestamped diaria a `/mnt/usb`.
