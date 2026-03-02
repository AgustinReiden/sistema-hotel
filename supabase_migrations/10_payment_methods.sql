-- Migration 10: Add New Payment Methods

-- Drop the old validation constraint
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;

-- Add the new constraint with the requested methods
ALTER TABLE payments ADD CONSTRAINT payments_payment_method_check 
CHECK (payment_method IN ('cash', 'credit_card', 'debit_card', 'bank_transfer', 'other', 'mercado_pago', 'vale_blanco', 'cuenta_corriente'));
