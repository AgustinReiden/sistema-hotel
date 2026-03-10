import { describe, it, expect } from 'vitest';
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
});
