import { describe, it, expect, afterEach } from 'vitest';
import { getSupabaseEnv } from '@/lib/env';

describe('getSupabaseEnv', () => {
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    afterEach(() => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
    });

    it('devuelve url y anonKey cuando están definidas', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://demo.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-123';
        expect(getSupabaseEnv()).toEqual({
            url: 'https://demo.supabase.co',
            anonKey: 'anon-key-123',
        });
    });

    it('lanza un error claro mencionando la variable faltante', () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-123';
        expect(() => getSupabaseEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    });

    it('lanza un error si falta la anon key', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://demo.supabase.co';
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        expect(() => getSupabaseEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    });
});
