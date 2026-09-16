import Link from "next/link";

/**
 * Layout compartido de la sección de moderador (T-08, T-12): agrega una
 * navegación simple entre los dos paneles (vendedores y anuncios).
 *
 * No hace ninguna verificación de sesión/rol aquí: cada página
 * (`app/moderador/vendedores/page.tsx`, `app/moderador/anuncios/page.tsx`)
 * ya exige sesión activa y `profiles.role === 'moderador'`, redirigiendo
 * en caso contrario. Este layout es solo una envoltura de navegación.
 */
export default function ModeradorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <nav className="flex justify-center gap-6 border-b border-black/[.15] bg-white px-6 py-3 text-sm dark:border-white/[.2] dark:bg-black">
        <Link href="/moderador/vendedores" className="font-medium underline">
          Vendedores
        </Link>
        <Link href="/moderador/anuncios" className="font-medium underline">
          Anuncios
        </Link>
      </nav>
      {children}
    </div>
  );
}
