# Requisitos: Marketplace de Autos Usados

Basado en `vision.md`. Cada requisito incluye su criterio de aceptación.

**Estado:** Aprobado por el usuario, incluyendo los supuestos de REQ-08 y
REQ-09.

## Verificación de Vendedores

### REQ-01: Verificación de vendedor por RUT (automática + manual)

El sistema debe verificar a todo vendedor (persona natural o concesionario)
mediante una combinación de:

1. Validación automática del formato y existencia del RUT ingresado
2. Revisión manual de documentación de respaldo por parte de un equipo interno

**Criterio de aceptación:**
- Dado que un vendedor se registra con un RUT, el sistema valida
  automáticamente el formato (dígito verificador correcto) y rechaza el
  registro si el formato es inválido.
- Si el formato es válido, la cuenta queda en estado "Pendiente de revisión"
  hasta que un revisor interno apruebe o rechace la documentación de
  respaldo.
- El vendedor no puede publicar anuncios mientras su cuenta esté en estado
  "Pendiente de revisión" o "Rechazado".
- El vendedor solo puede publicar anuncios cuando su cuenta está en estado
  "Verificado".

### REQ-02: Documentación de respaldo según tipo de vendedor

El sistema debe solicitar distinta documentación de respaldo según el tipo
de vendedor:

- **Persona natural**: RUT (de la persona)
- **Concesionario**: RUT de la empresa

**Criterio de aceptación:**
- Dado que un vendedor se registra como "Persona natural", el formulario de
  registro exige su RUT personal como documento de respaldo.
- Dado que un vendedor se registra como "Concesionario", el formulario de
  registro exige el RUT de la empresa como documento de respaldo.
- El registro no puede completarse (queda bloqueado) si falta el
  documento de respaldo correspondiente al tipo de vendedor seleccionado.

## Publicación de Anuncios

### REQ-03: Campos obligatorios para publicar un anuncio

Todo anuncio de vehículo debe incluir como mínimo:

- Marca
- Modelo
- Año
- Kilometraje
- Precio
- Fotos (mínimo 3)

**Criterio de aceptación:**
- El sistema no permite publicar un anuncio si falta marca, modelo, año,
  kilometraje o precio.
- El sistema no permite publicar un anuncio con menos de 3 fotos cargadas.
- Al completar todos los campos obligatorios y subir al menos 3 fotos, el
  vendedor puede enviar el anuncio a publicación.

### REQ-04: Campos obligatorios adicionales (estado, papeles, uso)

Además de REQ-03, todo anuncio debe incluir obligatoriamente:

- Estado del vehículo
- Si los papeles/documentación están al día (sí/no)
- Tipo de uso (familiar, de trabajo, de carga, todo terreno)

**Criterio de aceptación:**
- El sistema no permite publicar un anuncio si falta el estado del
  vehículo, la indicación de papeles al día, o el tipo de uso.
- El tipo de uso debe seleccionarse de una lista predefinida (familiar,
  trabajo, carga, todo terreno).

### REQ-05: Ciclo de vida del anuncio

Un anuncio puede tener los siguientes estados: Borrador, Publicado, Pausado,
Vendido, Rechazado. El cambio de estado lo realiza un moderador.

**Criterio de aceptación:**
- Un anuncio nuevo se crea en estado "Borrador".
- Solo un moderador puede cambiar el estado de un anuncio entre Borrador,
  Publicado, Pausado, Vendido y Rechazado.
- Un anuncio en estado "Publicado" es visible en las búsquedas del
  marketplace; en cualquier otro estado no aparece en resultados de
  búsqueda pública.
- Un anuncio en estado "Rechazado" o "Vendido" no puede recibir nuevos
  contactos de compradores.

## Búsqueda y Comparación

### REQ-06: Filtros de búsqueda

El comprador debe poder filtrar anuncios publicados por:

- Marca
- Modelo
- Año
- Ubicación

**Criterio de aceptación:**
- El comprador puede combinar dos o más filtros (marca, modelo, año,
  ubicación) en una misma búsqueda.
- Los resultados de búsqueda solo muestran anuncios en estado "Publicado"
  que cumplen todos los filtros aplicados.
- Si ningún anuncio cumple los filtros, el sistema muestra un listado
  vacío con un mensaje indicándolo (no un error).

### REQ-07: Agrupación automática por similitud

El sistema debe agrupar automáticamente los anuncios por similitud, de
forma que el comprador vea ofertas comparables de distintos vendedores
para un mismo tipo de vehículo.

**Criterio de aceptación:**
- Al buscar un vehículo, el sistema agrupa automáticamente los anuncios
  que comparten marca, modelo y rango de año similar, mostrando ese grupo
  como un listado comparativo de ofertas de distintos vendedores.
- Cada grupo comparativo muestra, para cada anuncio, al menos: precio,
  año, kilometraje, estado, papeles al día y vendedor.

## Ventas y Comisión

### REQ-08: Confirmación de venta concretada *(supuesto)*

> **Supuesto:** no se definió un flujo de pago dentro de la plataforma. Se
> asume que la venta se confirma manualmente: el vendedor solicita marcar
> el anuncio como vendido indicando el precio final, y un moderador
> confirma esa solicitud antes de que el anuncio pase a estado "Vendido"
> (consistente con REQ-05, donde solo el moderador cambia estados).

**Criterio de aceptación:**
- El vendedor puede enviar una "solicitud de venta concretada" desde un
  anuncio en estado "Publicado", indicando el precio final de venta.
- El anuncio permanece en estado "Publicado" hasta que un moderador
  aprueba la solicitud; al aprobarla, el anuncio pasa a estado "Vendido".
- Al aprobarse la venta, el sistema calcula y registra la comisión
  correspondiente sobre el precio final indicado.

### REQ-09: Planes destacados para concesionarios *(supuesto)*

> **Supuesto:** no se definieron los niveles o precios de los planes
> destacados. Se asume un único plan "Destacado" que un concesionario
> puede activar por anuncio, sin definir aún tarifas ni duración exacta.

**Criterio de aceptación:**
- Un concesionario puede activar el plan "Destacado" para uno o más de
  sus anuncios en estado "Publicado".
- Los anuncios con plan "Destacado" activo se muestran con una etiqueta
  visual distintiva y tienen prioridad de posición en los resultados de
  búsqueda y en los grupos comparativos (REQ-07) frente a anuncios sin el
  plan.
- Si el plan destacado expira o se desactiva, el anuncio vuelve a
  ordenarse de forma estándar (sin prioridad).

## Preguntas pendientes de la entrevista

Ninguna. A partir de aquí, los puntos sin definición explícita del usuario
quedaron resueltos como supuestos (marcados con *(supuesto)*) y deben
confirmarse en la revisión.
