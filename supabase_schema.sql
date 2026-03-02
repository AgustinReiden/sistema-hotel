-- Esquema de Base de Datos para Sistema de Hotel (Time-based Availability)
-- Diseñado para funcionar en Supabase (PostgreSQL)
-- IMPORTANTE:
-- Este archivo representa el esquema base inicial del MVP.
-- Luego debes aplicar las migraciones de /supabase_migrations (02+)
-- para habilitar:
-- - RLS por rol (staff/admin)
-- - constraints anti-colision
-- - RPCs transaccionales de reservas
-- - hardening de funciones financieras

-- 1. Extensiones requeridas
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. ENUMS para tipos y estados
CREATE TYPE user_role AS ENUM ('admin', 'receptionist', 'client');
CREATE TYPE room_status AS ENUM ('available', 'occupied', 'maintenance', 'cleaning');
CREATE TYPE reservation_status AS ENUM ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled');

-- 3. Tabla de Usuarios (Se apoya en auth.users de Supabase, aquí guardamos los roles y perfíles)
CREATE TABLE profiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    role user_role DEFAULT 'client',
    full_name TEXT NOT NULL,
    phone TEXT,
    document_id TEXT, -- DNI/Pasaporte
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabla de Ajustes del Hotel
CREATE TABLE hotel_settings (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    standard_check_in_time TIME NOT NULL DEFAULT '14:00:00',
    standard_check_out_time TIME NOT NULL DEFAULT '10:00:00',
    late_check_out_time TIME NOT NULL DEFAULT '18:00:00', -- Para el cobro de medio día
    currency TEXT DEFAULT 'USD'
);

-- Inserción de Ajustes Básicos
INSERT INTO hotel_settings (name) VALUES ('Mi Hotel');

-- 5. Tabla de Habitaciones
CREATE TABLE rooms (
    id SERIAL PRIMARY KEY,
    room_number TEXT NOT NULL UNIQUE,
    room_type TEXT NOT NULL, -- Ej: 'Doble', 'Simple', 'Matrimonial'
    capacity INT NOT NULL,
    base_price_per_night NUMERIC(10, 2) NOT NULL,
    half_day_price NUMERIC(10, 2) NOT NULL, -- Precio a cobrar si se pasa de las 10am
    status room_status DEFAULT 'available',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabla de Reservas (El núcleo del sistema de "Time-based Availability")
CREATE TABLE reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id INT REFERENCES rooms(id) NOT NULL,
    client_id UUID REFERENCES profiles(id), -- Puede ser NULL si la crea recepción rápido sin cuenta web
    client_name TEXT NOT NULL, -- En caso de que no tenga profile creado (walking client)
    
    -- El secreto está aquí: Usamos TIMESTAMPTZ y NO Dates exactos.
    check_in_target TIMESTAMPTZ NOT NULL,   -- Ej: 2023-10-01T14:00:00
    check_out_target TIMESTAMPTZ NOT NULL,  -- Ej: 2023-10-10T10:00:00
    
    actual_check_in TIMESTAMPTZ, -- Cuando realmente entró
    actual_check_out TIMESTAMPTZ, -- Cuando realmente salió
    
    total_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    amount_paid NUMERIC(10, 2) NOT NULL DEFAULT 0,
    
    status reservation_status DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Tabla de Recargos / Pagos extra (Half-day)
CREATE TABLE extra_charges (
    id SERIAL PRIMARY KEY,
    reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,
    charge_type TEXT NOT NULL, -- Ej: 'half_day', 'minibar', 'damage'
    amount NUMERIC(10, 2) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. RLS (Row Level Security) para Supabase
-- Habilitamos RLS en todas las tablas
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE extra_charges ENABLE ROW LEVEL SECURITY;

-- Políticas Básicas (Restringidas a usuarios autenticados)
-- Permitimos lectura a los usuarios autenticados. En un futuro se podría restringir por rol 'admin' o 'receptionist'.
CREATE POLICY "Auth read profiles" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth read hotel_settings" ON hotel_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth read rooms" ON rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth read reservations" ON reservations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth read extra_charges" ON extra_charges FOR SELECT TO authenticated USING (true);

-- Políticas de escritura básicas para usuarios autenticados
CREATE POLICY "Auth insert reservations" ON reservations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update reservations" ON reservations FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth update rooms" ON rooms FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth insert extra_charges" ON extra_charges FOR INSERT TO authenticated WITH CHECK (true);
