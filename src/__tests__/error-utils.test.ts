import { describe, it, expect, vi } from 'vitest';
import { parseActionError } from '@/lib/error-utils';

// We import ZodError to simulate validation failures
import { z } from 'zod';

describe('parseActionError', () => {
    it('returns the first Zod issue message for ZodError', () => {
        try {
            z.string().min(5).parse('ab');
        } catch (error) {
            const result = parseActionError(error, 'Fallback');
            expect(result.code).toBe('VALIDATION_ERROR');
            expect(result.error).toBeTruthy();
            expect(result.error).not.toBe('Fallback');
        }
    });

    it('returns error.message for standard Error', () => {
        const result = parseActionError(new Error('Something broke'), 'Fallback');
        expect(result.error).toBe('Something broke');
    });

    it('returns fallback for Error with empty message', () => {
        const result = parseActionError(new Error(''), 'Fallback');
        expect(result.error).toBe('Fallback');
    });

    it('handles Supabase-like error objects with message', () => {
        const supabaseError = { message: 'Row not found', code: 'PGRST116' };
        const result = parseActionError(supabaseError, 'Fallback');
        expect(result.error).toBe('Row not found');
        expect(result.code).toBe('PGRST116');
    });

    it('handles objects with details and hint but no message', () => {
        const obj = { details: 'Column missing', hint: 'Check schema' };
        const result = parseActionError(obj, 'Fallback');
        expect(result.error).toContain('Column missing');
    });

    it('returns fallback for null', () => {
        const result = parseActionError(null, 'Fallback message');
        expect(result.error).toBe('Fallback message');
    });

    it('returns fallback for undefined', () => {
        const result = parseActionError(undefined, 'Default error');
        expect(result.error).toBe('Default error');
    });

    it('returns fallback for string error', () => {
        const result = parseActionError('just a string', 'Fallback');
        expect(result.error).toBe('Fallback');
    });

    it('returns fallback for number error', () => {
        const result = parseActionError(42, 'Fallback');
        expect(result.error).toBe('Fallback');
    });

    it('genericiza un error técnico de Postgres (unique_violation) sin filtrar el detalle', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const dbError = {
            message: 'duplicate key value violates unique constraint "rooms_room_number_key"',
            code: '23505',
        };
        const result = parseActionError(dbError, 'Fallback');
        expect(result.code).toBe('23505');
        expect(result.error).not.toContain('constraint');
        expect(result.error).toContain('error inesperado');
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('genericiza otros SQLSTATEs técnicos (FK, not-null, check, invalid-text, internal)', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        for (const code of ['23503', '23502', '23514', '22P02', 'XX000']) {
            const result = parseActionError({ message: 'detalle técnico crudo', code }, 'Fallback');
            expect(result.error).toContain('error inesperado');
            expect(result.error).not.toContain('crudo');
            expect(result.code).toBe(code);
        }
        spy.mockRestore();
    });

    it('conserva el mensaje en español de las RPC (exclusion_violation 23P01)', () => {
        const rpcError = {
            message: 'La habitacion no esta disponible para ese rango horario.',
            code: '23P01',
        };
        const result = parseActionError(rpcError, 'Fallback');
        expect(result.error).toBe('La habitacion no esta disponible para ese rango horario.');
        expect(result.code).toBe('23P01');
    });

    it('conserva el mensaje "No autorizado" (42501)', () => {
        const result = parseActionError({ message: 'No autorizado.', code: '42501' }, 'Fallback');
        expect(result.error).toBe('No autorizado.');
    });
});
