import type { Metadata } from "next";
import { Geist_Mono, Inter, Plus_Jakarta_Sans } from "next/font/google";
import { SiteHeader } from "./components/site-header";
import "./globals.css";

/**
 * Fuentes del sistema de diseño (T-22). Son variables (un solo archivo cubre
 * todos los pesos), así que agregar pesos en el futuro no cuesta descargas
 * extra. Cada una expone una CSS variable que `globals.css` mapea a un token:
 * Inter -> --font-sans (texto y fichas técnicas),
 * Plus Jakarta Sans -> --font-display (títulos y precios),
 * Geist Mono -> --font-mono (datos tabulares/códigos).
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Metadata del sitio. El `template` hace que cada página que exporte su propio
 * título quede como "Buscar autos | Autos Usados Chile" sin repetir la marca.
 */
export const metadata: Metadata = {
  title: {
    default: "Autos Usados Chile — Compra y vende con vendedores verificados",
    template: "%s | Autos Usados Chile",
  },
  description:
    "Marketplace de autos usados en Chile. Compara precio, año, kilometraje y estado entre anuncios de vendedores verificados con RUT, o publica tu auto y véndelo con confianza.",
  applicationName: "Autos Usados Chile",
  openGraph: {
    type: "website",
    locale: "es_CL",
    siteName: "Autos Usados Chile",
    title: "Autos Usados Chile — Compra y vende con vendedores verificados",
    description:
      "Compara autos usados por precio, año, kilometraje y estado. Todos los vendedores están verificados con RUT.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      // El contenido del sitio está en español de Chile: importa para
      // lectores de pantalla, corrección ortográfica y SEO local.
      lang="es-CL"
      className={`${inter.variable} ${plusJakarta.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Header/navegación global (T-23): se renderiza una sola vez acá
         * para que todas las páginas lo compartan sin repetirlo. */}
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
