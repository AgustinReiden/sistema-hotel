import { describe, it, expect, vi } from 'vitest';
import { DNI_INVALIDO_MSG } from '@/lib/arca/amounts';
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

    it('conserva el "Acceso denegado" de las RPC del sistema (42501)', () => {
        const result = parseActionError({ message: 'Acceso denegado', code: '42501' }, 'Fallback');
        expect(result.error).toBe('Acceso denegado');
        expect(result.code).toBe('42501');
    });

    it('enmascara la denegacion cruda de RLS (42501 con "row-level security")', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const rlsError = {
            message:
                'new row violates row-level security policy for table "guests"',
            code: '42501',
        };
        const result = parseActionError(rlsError, 'Fallback');
        expect(result.error).toBe('No tenés permiso para hacer esta operación.');
        expect(result.error).not.toContain('guests');
        expect(result.code).toBe('42501');
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('enmascara tambien el UPDATE bloqueado por RLS de otra tabla', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const rlsError = {
            message:
                'permission denied: RLS policy violated (row-level security) for table "associated_clients"',
            code: '42501',
        };
        const result = parseActionError(rlsError, 'Fallback');
        expect(result.error).toBe('No tenés permiso para hacer esta operación.');
        expect(result.error).not.toContain('associated_clients');
        spy.mockRestore();
    });
});

// P0022 lo usan varias validaciones fiscales. Solo el del DNI de la reserva se
// traduce: el texto viejo de la base manda a "corregirlo en la reserva", y con la
// estadía cerrada recepción no tiene dónde. Los demás dicen lo que hay que hacer.
describe('parseActionError: el P0022 del DNI de la reserva', () => {
    const DNI_VIEJO =
        'El DNI de la reserva no es valido para facturar (7 u 8 digitos). Corregilo en la reserva y reintenta.';

    it('un P0022 con el texto viejo del DNI devuelve DNI_INVALIDO_MSG', () => {
        const result = parseActionError({ message: DNI_VIEJO, code: 'P0022' }, 'Fallback');
        expect(result.error).toBe(DNI_INVALIDO_MSG);
        expect(result.code).toBe('P0022');
        expect(result.error).not.toMatch(/en la reserva/i);
    });

    it('también cuando llega como Error (PostgrestError extiende Error)', () => {
        const pgError = Object.assign(new Error(DNI_VIEJO), { code: 'P0022' });
        const result = parseActionError(pgError, 'Fallback');
        expect(result.error).toBe(DNI_INVALIDO_MSG);
        expect(result.code).toBe('P0022');
    });

    it('un P0022 con mensaje de CUIT devuelve el mensaje original', () => {
        const cuit =
            'El CUIT del receptor no es valido (11 digitos con digito verificador). Corregilo y reintenta.';
        const result = parseActionError({ message: cuit, code: 'P0022' }, 'Fallback');
        expect(result.error).toBe(cuit);
        expect(result.code).toBe('P0022');
    });

    it('la condición de IVA faltante y el documento de la consolidada quedan como vienen', () => {
        for (const message of [
            'Carga la condicion frente al IVA de la empresa (responsable inscripto, monotributo o exento) para poder facturar.',
            'El DNI del huesped no es valido para facturar (7 u 8 digitos). Corregilo en la ficha.',
            'El DNI del receptor no es valido. Corregilo en la ficha y volve a generar el comprobante.',
        ]) {
            const result = parseActionError({ message, code: 'P0022' }, 'Fallback');
            expect(result.error).toBe(message);
        }
    });

    it('el texto del DNI con otro código no se toca', () => {
        const result = parseActionError({ message: DNI_VIEJO, code: 'P0001' }, 'Fallback');
        expect(result.error).toBe(DNI_VIEJO);
    });
});
