-- Migration 09: Finance Module and Room Pricing

-- 1. Add base_price to rooms
ALTER TABLE rooms
ADD COLUMN IF NOT EXISTS base_price DECIMAL(10,2) NOT NULL DEFAULT 50.00;

-- 2. Add financial tracking to reservations
ALTER TABLE reservations
ADD COLUMN IF NOT EXISTS total_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- 3. Create payments table for the cash register
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'credit_card', 'debit_card', 'bank_transfer', 'other')),
    reference_code TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    created_by UUID REFERENCES auth.users(id) -- Assuming you want to trace which staff member took the payment
);

-- Enable RLS on payments
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Admins and receptionists can manage payments
CREATE POLICY "Staff can view all payments" ON payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert payments" ON payments FOR INSERT TO authenticated WITH CHECK (true);
