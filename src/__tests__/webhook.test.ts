import { describe, it, expect } from 'vitest';
import { formatPhoneForWhatsapp } from '@/lib/webhook';

describe('formatPhoneForWhatsapp', () => {
    it('returns null for null input', () => {
        expect(formatPhoneForWhatsapp(null)).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(formatPhoneForWhatsapp('')).toBeNull();
    });

    it('returns null for string with only non-digit characters', () => {
        expect(formatPhoneForWhatsapp('---')).toBeNull();
    });

    it('adds 549 prefix to a local Argentine number', () => {
        expect(formatPhoneForWhatsapp('3814123456')).toBe('5493814123456');
    });

    it('preserves a number that already starts with 549', () => {
        expect(formatPhoneForWhatsapp('5493814123456')).toBe('5493814123456');
    });

    it('adds 9 when number starts with 54 but not 549', () => {
        expect(formatPhoneForWhatsapp('543814123456')).toBe('5493814123456');
    });

    it('strips non-digit characters before processing', () => {
        expect(formatPhoneForWhatsapp('+54 (381) 412-3456')).toBe('5493814123456');
    });

    it('handles a number with leading +', () => {
        expect(formatPhoneForWhatsapp('+5493814123456')).toBe('5493814123456');
    });

    it('handles short local numbers by adding 549 prefix', () => {
        expect(formatPhoneForWhatsapp('4123456')).toBe('5494123456');
    });
});
