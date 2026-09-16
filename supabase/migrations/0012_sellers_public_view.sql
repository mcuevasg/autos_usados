-- T-14: Vista pública acotada de `sellers` para mostrar el vendedor en
-- resultados de búsqueda (REQ-07) sin exponer datos sensibles.
--
-- Contexto / por qué existe esta vista:
--   `public.sellers` NO es públicamente legible: sus políticas RLS
--   (0002_rls_policies.sql, 0006_moderator_seller_review.sql) solo
--   permiten leer una fila al propio dueño (`auth.uid() = user_id`) o a
--   un moderador. Eso es intencional, porque `sellers.rut` es un dato
--   sensible (equivalente a un RUN/SSN chileno) y `verification_
--   document_url` referencia un documento de respaldo privado; ninguno
--   de los dos debe quedar accesible a cualquier visitante anónimo.
--
--   T-14 (búsqueda pública con agrupación comparativa) pide mostrar,
--   por cada anuncio, el "vendedor". Mostrar solo el TIPO de vendedor
--   (persona_natural / concesionario) es suficiente para el criterio de
--   aceptación y no compromete PII. La forma correcta de lograrlo NO es
--   "no mostrar el rut en la UI": RLS opera a nivel de FILA, no de
--   columna, así que otorgar `select` sobre `sellers` a `anon` (aunque
--   la UI solo lea dos columnas) expondría igualmente `rut` y
--   `verification_document_url` a cualquiera que llame directamente a la
--   API REST de Supabase (PostgREST) sin pasar por esta app.
--
--   La solución es esta vista `sellers_public_info`, que solo proyecta
--   `id` y `seller_type`. En Postgres, una vista creada de forma normal
--   (sin la opción `security_invoker`, disponible desde Postgres 15) se
--   ejecuta con los privilegios de su DUEÑO (el rol que la crea, no el
--   rol que hace el `select`), por lo que NO hereda las políticas RLS
--   restrictivas de `sellers` para quien consulta la vista. Como la
--   vista en sí misma nunca selecciona `rut` ni `verification_document_
--   url`, no hay forma de obtener esas columnas a través de ella, así
--   que es seguro otorgar `select` sobre la vista a `anon` y
--   `authenticated`.
--
-- IMPORTANTE: si en el futuro se agregan columnas a `sellers`, esta
-- vista debe revisarse para no proyectarlas por accidente (ej. evitar
-- un `select *`).

create view public.sellers_public_info as
  select
    id,
    seller_type
  from public.sellers;

comment on view public.sellers_public_info is
  'Vista pública acotada de sellers: expone únicamente id y seller_type '
  '(persona_natural / concesionario) para mostrar el "vendedor" en '
  'búsquedas públicas (T-14, REQ-07) sin exponer rut ni '
  'verification_document_url. Se ejecuta con los privilegios del dueño '
  'de la vista (sin security_invoker), por lo que no hereda la RLS '
  'restrictiva de sellers para quien la consulta.';

-- Otorga lectura de la vista a usuarios anónimos y autenticados: es
-- segura porque solo expone id + seller_type, ninguna columna sensible.
grant select on public.sellers_public_info to anon, authenticated;
