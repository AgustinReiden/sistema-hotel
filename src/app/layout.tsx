import type { Metadata } from 'next';
import { DM_Sans, Playfair_Display } from 'next/font/google';
import './globals.css';
import { Toaster } from 'sonner';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-body' });
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-display' });

export const metadata: Metadata = {
  title: 'El Refugio | Hotel & Servicios de Ruta',
  description: 'Hotel, comedor regional, repuestera y combustibles en Taco Pozo, Chaco. Tu parada segura en la ruta.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className={`${dmSans.variable} ${playfair.variable} font-sans bg-slate-50 text-slate-900 min-h-screen antialiased selection:bg-brand-500 selection:text-white`}>
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
