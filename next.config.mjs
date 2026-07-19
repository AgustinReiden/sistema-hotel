// Host de Supabase (mismo patrón que images.remotePatterns): para el CSP.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
    : 'xoqxbtlpppsyzccljjxp.supabase.co';

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
    `img-src 'self' data: https://images.unsplash.com https://postimg.cc https://i.postimg.cc https://imgur.com https://i.imgur.com https://${supabaseHost}`,
    "font-src 'self'",
    `connect-src 'self' https://${supabaseHost}`,
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
            {
                protocol: 'https',
                hostname: process.env.NEXT_PUBLIC_SUPABASE_URL
                    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
                    : 'xoqxbtlpppsyzccljjxp.supabase.co',
            },
        ],
    },
};

export default nextConfig;
