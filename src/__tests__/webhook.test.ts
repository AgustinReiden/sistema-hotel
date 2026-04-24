import { describe, it, expect } from 'vitest';
import { formatPhoneForWhatsapp } from '@/lib/webhook';

describe('formatPhoneForWhatsapp', () => {
    it('returns null for null input', () => {
        expect(formatPhoneForWhatsapp(null, '54')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(formatPhoneForWhatsapp('', '54')).toBeNull();
    });

    it('returns null for string with only non-digit characters', () => {
        expect(formatPhoneForWhatsapp('---', '54')).toBeNull();
    });

    it('adds 549 prefix to a local Argentine number', () => {
        expect(formatPhoneForWhatsapp('3814123456', '54')).toBe('5493814123456');
    });

    it('preserves a number that already starts with 549', () => {
        expect(formatPhoneForWhatsapp('5493814123456', '54')).toBe('5493814123456');
    });

    it('adds 9 when number starts with 54 but not 549', () => {
        expect(formatPhoneForWhatsapp('543814123456', '54')).toBe('5493814123456');
    });

    it('strips non-digit characters before processing', () => {
        expect(formatPhoneForWhatsapp('+54 (381) 412-3456', '54')).toBe('5493814123456');
    });

    it('adds 55 prefix to a Brazilian local number without inserting extra 9', () => {
        expect(formatPhoneForWhatsapp('11987654321', '55')).toBe('5511987654321');
    });

    it('preserves a Brazilian number that already starts with 55', () => {
        expect(formatPhoneForWhatsapp('5511987654321', '55')).toBe('5511987654321');
    });

    it('adds 598 prefix to a Uruguayan local number', () => {
        expect(formatPhoneForWhatsapp('94123456', '598')).toBe('59894123456');
    });

    it('strips multi-digit country prefix (598) before re-prefixing', () => {
        expect(formatPhoneForWhatsapp('59894123456', '598')).toBe('59894123456');
    });
});
