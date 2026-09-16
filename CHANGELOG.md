# Changelog

Todos los cambios relevantes de este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

## [Unreleased]

### Agregado

- **T-01: Inicialización del proyecto Next.js + TypeScript.** Se creó la
  aplicación base del marketplace de autos usados con `create-next-app`
  (Next.js, App Router, TypeScript, Tailwind CSS v4, ESLint), en la raíz del
  repositorio. El proyecto compila correctamente (`npm run build`) y sirve
  en desarrollo local (`npm run dev`) en `http://localhost:3000`.
- **T-02: Proyecto Supabase conectado.** Se creó el proyecto Supabase
  (Postgres, Auth, Storage, tier gratuito) y se agregó `lib/supabase/client.ts`,
  un cliente reutilizable que falla rápido con un error claro si faltan las
  variables de entorno requeridas. Se agregó el endpoint de salud
  `app/api/health/supabase/route.ts`, que verifica conectividad real con
  Supabase. Las credenciales se configuran en `.env.local` (no versionado),
  documentado en `.env.local.example` con las variables
  `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **T-06: Validador local de RUT (dígito verificador).** Se agregó
  `validarRut(rut: string): boolean` en `lib/rut.ts`, que implementa el
  algoritmo de módulo 11 para validar el dígito verificador de un RUT
  chileno, aceptando entradas con o sin puntos, con guión, y con 'k'/'K'.
  Se incluye una suite de pruebas con Vitest (`lib/rut.test.ts`) y el script
  `npm run test` para ejecutarlas.
