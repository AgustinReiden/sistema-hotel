import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from 'sonner';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Mi Hotel | Recepción e Interfaz de Reservas',
  description: 'Sistema avanzado de gestión de disponibilidad por horas para hoteles.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className={`${inter.className} bg-slate-50 text-slate-900 min-h-screen antialiased selection:bg-brand-500 selection:text-white`}>
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
