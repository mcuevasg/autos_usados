import { ChatAsistente } from "./chat";

/**
 * Página pública del Asistente de Compra con IA (T-29).
 *
 * Accesible sin sesión (mismo criterio de visibilidad pública que
 * `/buscar`, T-13): no hay ningún control de acceso ni redirección acá.
 *
 * `AsistentePage` NO es `async`, no lee `cookies()`/sesión ni
 * `searchParams` al tope: es un shell puramente estático que delega toda
 * la interacción a `ChatAsistente` (Client Component), que a su vez llama a
 * `POST /api/asistente/chat` -el único lugar que toca `GROQ_API_KEY`,
 * exclusivamente server-side-. Por eso esta página no necesita
 * `export const instant = false` (a diferencia de `/buscar` o `/cuenta`,
 * T-28): puede prerenderizarse igual que la Home o `/login`.
 */
export default function AsistentePage() {
  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-background px-6 py-16">
      <div className="flex w-full max-w-2xl flex-col gap-2 text-center">
        <h1 className="font-display text-heading-1 text-foreground">
          Asistente de compra
        </h1>
        <p className="text-body text-foreground-muted">
          Cuéntale en tus palabras qué auto buscas -marca, modelo, año,
          ubicación, presupuesto- y te va a recomendar anuncios publicados
          reales que calcen, o te va a preguntar lo que le falte saber.
        </p>
      </div>

      <ChatAsistente />
    </div>
  );
}
