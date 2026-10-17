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
 
### Épica 2: control de peso y ganancia media diaria (GMD)
- [ ] US-201 (Esquema de pesajes en SQLite):
  - Tabla `Pesajes`: `id`, `animal_id`, `fecha`, `peso_kg`, `tipo` (Destete, Control, Salida), `operador`.
- [ ] US-202 (Cálculo de GMD en ficha):
  - Mostrar en la ficha técnica de la PWA la evolución de peso y el cálculo de GMD:  
    $$\text{GMD} = \frac{\text{Peso actual} - \text{Peso anterior}}{\text{Días transcurridos}} \quad (\text{kg/día})$$
- [ ] US-203 (Previsión de salida a matadero):
  - Estimar la fecha en la que el animal alcanza los 520-540 kg comerciales según su GMD histórica.
 
### Épica 3: trazabilidad sanitaria y libro digital de explotación
- [ ] US-301 (Exportador de hoja de tratamientos oficial):
  - Generar informe PDF conforme a la normativa de sanidad animal de Castilla y León para inspecciones veterinarias.
- [ ] US-302 (Alerta de fin de retirada):
  - Alerta visual en la PWA si se selecciona para traslado o venta un animal en periodo de retirada sanitaria.
 
### Épica 4: costes de alimentación y control de silos
- [ ] US-401 (Módulo de silos):
  - Registrar albaranes de pienso y seguir el stock disponible en tolvas y silos.
- [ ] US-402 (Coste alimentario por ternero):
  - Imputar el coste estimado de pienso por lote durante el cebo.
 
---
 
## 3. Deuda técnica y mejoras de infraestructura
 
- [x] Concurrencia SQLite en modo WAL e inserciones idempotentes en Access.
- [x] Respaldo automático atómico con confirmación y envío a repositorio Git remoto privado.
- [x] Detección de versiones entre PC y móvil con `/api/database/meta`, aviso visual en interfaz y registro de auditoría local.
- [x] Conexión de `python/recetas-mvp` con la exportación mediante `--force-export` y scripts batch.
- [ ] Migrar la operativa de oficina a interfaz web servida desde la Orange Pi, eliminando la dependencia del controlador Jet OLEDB x86 de Microsoft Access.
- [ ] Respaldo diario automático programado en la Orange Pi hacia memoria USB en `/mnt/usb`.

