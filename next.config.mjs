// Host de Supabase para el CSP y para images.remotePatterns. Sale SOLO de
// NEXT_PUBLIC_SUPABASE_URL: el repo es público y el host del proyecto no se
// escribe acá. Si la variable falta, ninguno de los dos suma un host de Supabase
// y se avisa por consola.
// Ojo: Next lee este archivo dos veces. En `next build` queda fijo el CSP (los
// headers salen del build), y en `next start` se vuelve a leer para next/image
// (remotePatterns se toma al arrancar). La variable tiene que estar en los dos
// momentos: si falta al arrancar, las imágenes de Supabase que pasan por
// next/image dejan de cargar aunque el build haya salido limpio.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
    : null;

if (!supabaseHost) {
    console.warn(
        '[next.config] Falta NEXT_PUBLIC_SUPABASE_URL: el CSP y next/image quedan sin el host de Supabase. Definila en el entorno del build y también en el del arranque (next start).',
    );
}

// Fuente del CSP para Supabase: vacía si no hay host.
const supabaseSource = supabaseHost ? ` https://${supabaseHost}` : '';

// Content-Security-Policy en modo SOLO REPORTE por ahora (auditoría B1): registra
// violaciones en la consola sin romper nada. Cuando confirmemos que impresión, QR
// e imágenes andan bien, se pasa la key a 'Content-Security-Policy' (enforcing).
// 'unsafe-inline' en script-src es necesario porque Next 16 (App Router) inyecta
// scripts inline de hidratación y no hay infra de nonce; en style-src por las
// páginas de impresión, recharts y next/font.
const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: https://images.unsplash.com https://postimg.cc https://i.postimg.cc https://imgur.com https://i.imgur.com${supabaseSource}`,
    "font-src 'self'",
    `connect-src 'self'${supabaseSource}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
].join('; ');

// Headers de seguridad para todas las rutas. Los primeros 4 van enforcing (riesgo
// cero, cierran clickjacking/sniffing/downgrade). El CSP va en Report-Only (ver arriba).
const securityHeaders = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
    poweredByHeader: false,
    async headers() {
        return [
            {
                source: '/:path*',
                headers: securityHeaders,
            },
        ];
    },
    allowedDevOrigins: ['127.0.0.1', 'localhost'],
    // El repo se trabaja desde git worktrees (varios checkouts bajo .claude/worktrees/),
    // cada uno con su propio lockfile, anidados bajo el lockfile del checkout principal.
    // Turbopack ya no avisa "multiple lockfiles" en un worktree real (detecta el borde
    // del worktree solo), pero fijar la raíz explícita evita depender de esa detección
    // y protege un build desde un clone plano (ej. Coolify) que termine anidado bajo
    // otro directorio con lockfile propio.
    turbopack: {
        root: import.meta.dirname,
    },
    experimental: {
        serverActions: {
            allowedOrigins: ['hotelelrefugio.com.ar'],
        },
    },
    reactCompiler: true,
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'images.unsplash.com',
            },
            {
                protocol: 'https',
                hostname: 'postimg.cc',
            },
            {
                protocol: 'https',
                hostname: 'i.postimg.cc',
            },
            {
                protocol: 'https',
                hostname: 'imgur.com', // In case you use imgur as well
            },
            {
                protocol: 'https',
                hostname: 'i.imgur.com',
            },
            // Solo si la variable existe: un hostname null o vacío no se admite.
            ...(supabaseHost ? [{ protocol: 'https', hostname: supabaseHost }] : []),
        ],
    },
};

export default nextConfig;
