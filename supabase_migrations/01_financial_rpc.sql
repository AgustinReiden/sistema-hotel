-- Fase 3: Gestión Financiera
-- Ejecuta este script manualmente en el SQL Editor de Supabase.

-- 1. Crear una función RPC (Remote Procedure Call) para obtener los ingresos extras de hoy
CREATE OR REPLACE FUNCTION get_today_extra_income() 
RETURNS numeric AS $$
DECLARE
    total numeric;
BEGIN
    SELECT COALESCE(SUM(amount), 0)
    INTO total
    FROM extra_charges
    WHERE charge_type = 'half_day'
      AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE;

    RETURN total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Nota: SECURITY DEFINER permite que la función lea la tabla aunque las políticas RLS sean restrictivas.
