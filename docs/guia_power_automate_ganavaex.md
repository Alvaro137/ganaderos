# Guía de Automatización: Ingesta de Facturas GANAVAEX con Power Automate

Esta guía describe cómo configurar una regla visual en **Microsoft Power Automate** (integrado gratuitamente en Outlook Web / Microsoft 365) para que cada vez que la cooperativa GANAVAEX envíe una liquidación por correo electrónico, el PDF se envíe automáticamente al servidor de **Ganaderos Campo** (`campo.alvaro137.com`).

---

## 1. Requisitos Previos

1. Cuenta de Microsoft (la misma con la que accedes a **Outlook Web**).
2. Secreto de webhook configurado en el archivo `.env` de la Orange Pi:
   ```env
   GANAVAEX_WEBHOOK_SECRET="tu-clave-secreta-webhook-ganavaex"
   ```
3. Dirección del servidor: `https://campo.alvaro137.com/api/ventas/webhook-ganavaex`.

---

## 2. Configuración en Power Automate (Paso a Paso)

Accede a [make.powerautomate.com](https://make.powerautomate.com) con tu cuenta de Microsoft y pulsa en **Crear** → **Flujo de nube automatizado**.

### Bloque 1: Disparador (Trigger)
* **Nombre del conector**: `Office 365 Outlook`
* **Evento**: *Cuando llega un nuevo correo electrónico (V3)*
* **Configuración**:
  * **Carpeta**: `Bandeja de entrada` (o la subcarpeta donde guardes Ganavaex)
  * **De**: `facturacion@ganavaex.com` (o el remitente habitual de GANAVAEX)
  * **Incluir datos adjuntos**: `Sí`
  * **Solo con datos adjuntos**: `Sí`

---

### Bloque 2: Bucle para Datos Adjuntos
* **Control**: *Aplicar a cada uno* (Apply to each)
  * **Seleccionar una salida**: `Datos adjuntos` (Attachments)

Dentro del bucle:
* **Acción**: `Office 365 Outlook` → *Obtener datos adjuntos (V2)*
  * **Id. del mensaje**: `Id. del mensaje` (del paso 1)
  * **Id. de datos adjuntos**: `Id. de datos adjuntos` (del elemento actual)

---

### Bloque 3: Envío HTTP a Ganaderos Campo
* **Acción**: `HTTP` → *HTTP*
* **Configuración de la petición**:
  * **Método**: `POST`
  * **URI**: `https://campo.alvaro137.com/api/ventas/webhook-ganavaex`
  * **Encabezados (Headers)**:
    ```
    X-Webhook-Secret: tu-clave-secreta-webhook-ganavaex
    Content-Type: application/pdf
    X-Filename: @{items('Aplicar_a_cada_uno')?['name']}
    ```
  * **Cuerpo (Body)**: `@{body('Obtener_datos_adjuntos_(V2)')?['contentBytes']}`

---

## 3. ¿Qué ocurre internamente al recibir una factura?

1. **Validación Instantánea**: La Orange Pi verifica la firma del secreto con `hmac.compare_digest` para impedir accesos no autorizados.
2. **Extracción Automática**: El backend parsea el PDF extrayendo:
   - Número de liquidación y fecha.
   - Kilos reales de canal de cada res.
   - Categoría comercial (`AÑOJO`, `TERNERA`, `VACA`) y precio por kg canal (€/kg).
   - Descuentos de transporte, cuota de cooperativa y retenciones.
3. **Persistencia en SQLite**: Inserta en `ventas_liquidaciones`, `ventas_canales` y `ventas_gastos`.
4. **Auditoría Git Vault**: Guarda una copia inmutable del PDF en el repositorio privado `ganaderos-backup-vault` bajo `liquidaciones/YYYY/factura_XXX.pdf`.
5. **Aviso a los Móviles**: Incrementa el contador `epoch`. La próxima vez que los vaqueros abran la PWA en el campo, tendrán los datos de rendimiento en canal actualizados en su base de datos local.
