import { describe, it, expect } from 'vitest';
import { formatMoney, localToISO } from '@/lib/format';

// ─── formatMoney ──────────────────────────────────────────────────────────────

describe('formatMoney', () => {
    it('formats ARS correctly', () => {
        const result = formatMoney(1500.5, 'ARS');
        // Should contain the number formatted with 2 decimals
        expect(result).toContain('1.500,50');
    });

    it('formats USD correctly', () => {
        const result = formatMoney(99.99, 'USD');
        expect(result).toContain('99,99');
    });

    it('formats zero', () => {
        const result = formatMoney(0, 'ARS');
        expect(result).toContain('0,00');
    });

    it('handles large numbers', () => {
        const result = formatMoney(1000000, 'ARS');
        expect(result).toContain('1.000.000');
    });

    it('falls back to USD for invalid currency', () => {
        const result = formatMoney(100, 'INVALID_CURRENCY');
        // Should not throw, should fallback to USD
        expect(result).toBeTruthy();
        expect(result).toContain('100');
    });
});

// ─── localToISO ───────────────────────────────────────────────────────────────

describe('localToISO', () => {
    it('creates correct ISO string for Argentina timezone', () => {
        const result = localToISO('2026-03-15', '14:00', 'America/Argentina/Buenos_Aires');
        expect(result).toMatch(/^2026-03-15T14:00:00/);
        // Argentina is UTC-3
        expect(result).toMatch(/-03:00$/);
    });

    it('pads single-digit months and days', () => {
        const result = localToISO('2026-01-05', '09:30', 'America/Argentina/Buenos_Aires');
        expect(result).toMatch(/^2026-01-05T09:30:00/);
    });

    it('handles UTC timezone', () => {
        const result = localToISO('2026-06-15', '12:00', 'UTC');
        expect(result).toBe('2026-06-15T12:00:00+00:00');
    });
});
