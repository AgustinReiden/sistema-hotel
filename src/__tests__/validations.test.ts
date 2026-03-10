import { describe, it, expect } from 'vitest';
import { assignWalkInSchema, createReservationSchema, publicBookingSchema, hotelSettingsSchema } from '@/lib/validations';

// ─── assignWalkInSchema ───────────────────────────────────────────────────────

describe('assignWalkInSchema', () => {
    it('accepts valid input', () => {
        const result = assignWalkInSchema.parse({ roomId: 1, clientName: 'Juan Pérez', nights: 3 });
        expect(result.roomId).toBe(1);
        expect(result.clientName).toBe('Juan Pérez');
        expect(result.nights).toBe(3);
    });

    it('trims client name', () => {
        const result = assignWalkInSchema.parse({ roomId: 1, clientName: '  María  ', nights: 1 });
        expect(result.clientName).toBe('María');
    });

    it('rejects empty client name', () => {
        expect(() => assignWalkInSchema.parse({ roomId: 1, clientName: '', nights: 1 })).toThrow();
    });

    it('rejects single character client name', () => {
        expect(() => assignWalkInSchema.parse({ roomId: 1, clientName: 'A', nights: 1 })).toThrow();
    });

    it('rejects 0 nights', () => {
        expect(() => assignWalkInSchema.parse({ roomId: 1, clientName: 'Test', nights: 0 })).toThrow();
    });

    it('rejects more than 30 nights', () => {
        expect(() => assignWalkInSchema.parse({ roomId: 1, clientName: 'Test', nights: 31 })).toThrow();
    });

    it('rejects negative room ID', () => {
        expect(() => assignWalkInSchema.parse({ roomId: -1, clientName: 'Test', nights: 1 })).toThrow();
    });

    it('accepts exactly 30 nights', () => {
        const result = assignWalkInSchema.parse({ roomId: 1, clientName: 'Test User', nights: 30 });
        expect(result.nights).toBe(30);
    });
});

// ─── createReservationSchema ──────────────────────────────────────────────────

describe('createReservationSchema', () => {
    const validInput = {
        roomId: 1,
        clientName: 'Carlos López',
        checkIn: '2026-04-01T14:00:00.000Z',
        checkOut: '2026-04-03T10:00:00.000Z',
    };

    it('accepts valid reservation data', () => {
        const result = createReservationSchema.parse(validInput);
        expect(result.roomId).toBe(1);
        expect(result.clientName).toBe('Carlos López');
    });

    it('rejects checkOut before checkIn', () => {
        expect(() =>
            createReservationSchema.parse({
                ...validInput,
                checkIn: '2026-04-05T14:00:00.000Z',
                checkOut: '2026-04-03T10:00:00.000Z',
            })
        ).toThrow();
    });

    it('rejects checkOut equal to checkIn', () => {
        expect(() =>
            createReservationSchema.parse({
                ...validInput,
                checkIn: '2026-04-03T10:00:00.000Z',
                checkOut: '2026-04-03T10:00:00.000Z',
            })
        ).toThrow();
    });

    it('rejects short client name', () => {
        expect(() => createReservationSchema.parse({ ...validInput, clientName: 'A' })).toThrow();
    });

    it('rejects invalid date format', () => {
        expect(() =>
            createReservationSchema.parse({ ...validInput, checkIn: 'not-a-date' })
        ).toThrow();
    });
});

// ─── publicBookingSchema ──────────────────────────────────────────────────────

describe('publicBookingSchema', () => {
    const validInput = {
        roomId: 2,
        clientName: 'Ana García',
        clientDni: '12345678',
        clientPhone: '+54 381 4123456',
        checkIn: '2026-05-01',
        checkOut: '2026-05-03',
    };

    it('accepts valid public booking data', () => {
        const result = publicBookingSchema.parse(validInput);
        expect(result.clientName).toBe('Ana García');
        expect(result.clientDni).toBe('12345678');
    });

    it('rejects short DNI', () => {
        expect(() => publicBookingSchema.parse({ ...validInput, clientDni: '123' })).toThrow();
    });

    it('rejects short phone', () => {
        expect(() => publicBookingSchema.parse({ ...validInput, clientPhone: '123' })).toThrow();
    });

    it('rejects phone with letters', () => {
        expect(() =>
            publicBookingSchema.parse({ ...validInput, clientPhone: 'abc12345678' })
        ).toThrow();
    });

    it('accepts phone with dashes and parentheses', () => {
        const result = publicBookingSchema.parse({
            ...validInput,
            clientPhone: '+54 (381) 412-3456',
        });
        expect(result.clientPhone).toBe('+54 (381) 412-3456');
    });
});

// ─── hotelSettingsSchema ──────────────────────────────────────────────────────

describe('hotelSettingsSchema', () => {
    const validSettings = {
        name: 'El Refugio',
        standard_check_in_time: '14:00',
        standard_check_out_time: '10:00',
        late_check_out_time: '18:00',
        timezone: 'America/Argentina/Tucuman',
        currency: 'ars',
        contact_email: 'info@hotel.com',
        contact_phone: '+54 381 4000000',
        address: 'Ruta Nacional 16, Taco Pozo',
        hero_title: 'Tu refugio en el camino',
        hero_subtitle: 'Descanso y servicios de ruta',
    };

    it('accepts valid settings and uppercases currency', () => {
        const result = hotelSettingsSchema.parse(validSettings);
        expect(result.currency).toBe('ARS');
        expect(result.name).toBe('El Refugio');
    });

    it('rejects invalid currency format', () => {
        expect(() =>
            hotelSettingsSchema.parse({ ...validSettings, currency: 'PESOS' })
        ).toThrow();
    });

    it('rejects invalid time format', () => {
        expect(() =>
            hotelSettingsSchema.parse({ ...validSettings, standard_check_in_time: '25:00' })
        ).toThrow();
    });

    it('accepts HH:MM:SS time format', () => {
        const result = hotelSettingsSchema.parse({
            ...validSettings,
            standard_check_in_time: '14:00:00',
        });
        expect(result.standard_check_in_time).toBe('14:00:00');
    });

    it('allows null optional fields', () => {
        const result = hotelSettingsSchema.parse({
            ...validSettings,
            contact_instagram: null,
            logo_url: null,
            hero_image_url: null,
        });
        expect(result.contact_instagram).toBeNull();
    });

    it('accepts valid image URLs', () => {
        const result = hotelSettingsSchema.parse({
            ...validSettings,
            hero_image_url: 'https://images.unsplash.com/photo-123',
            logo_url: '/images/logo.png',
        });
        expect(result.hero_image_url).toBe('https://images.unsplash.com/photo-123');
        expect(result.logo_url).toBe('/images/logo.png');
    });
});
