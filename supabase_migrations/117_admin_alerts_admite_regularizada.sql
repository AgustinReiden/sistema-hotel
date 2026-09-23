-- ─────────────────────────────────────────────────────────────────────────────
-- 117: admin_alerts acepta decision = regularizada.
--
-- POR QUE. Desde la mig 105, rpc_regularize_occupied_room cierra el aviso de pieza
-- ocupada sin estadia sellando decision = regularizada, y la 106 lo mantuvo: es la
-- marca con la que el banner de la Home dice se cargo la estadia. Pero el CHECK
-- admin_alerts_decision_check es de la mig 69 y solo conoce las dos decisiones de
-- la tarifa vieja, authorized y rejected. El UPDATE lo viola, la funcion se
-- revierte entera y el aviso no se cierra nunca.
--
-- QUE VE EL ADMIN MIENTRAS TANTO. La estadia se carga ANTES y en otra llamada
-- (rpc_staff_assign_walk_in), asi que esa si queda. Lo que falla es cerrar el
-- aviso: la accion lo informa como exito parcial, el cartel sigue abierto con el
-- boton de cargar la estadia sobre una pieza que ya se cobro, y cada reintento
-- vuelve a chocar con el CHECK.
--
-- POR QUE NO SE VIO. Los avisos de este tipo que habia se cerraron todos antes de
-- que existiera el boton, asi que nadie llego a apretarlo. El primero que lo
-- apretara se lo iba a encontrar.
--
-- Se amplia el CHECK y no se cambia la marca: regularizada ya la escribe la funcion
-- que esta en PROD y ya la lee el front. Las decisiones viejas siguen valiendo, y
-- como el conjunto nuevo contiene al viejo, ninguna fila existente queda afuera.
--
-- Idempotente: DROP IF EXISTS + ADD, se puede correr dos veces. La tabla es chica y
-- el lock dura lo que tarda en revisarla.
--
-- Aplicar ANTES del deploy. Por exec_ddl va lo que esta entre BEGIN y COMMIT, sin
-- ellos y sin punto y coma final en la llamada.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.admin_alerts
  DROP CONSTRAINT IF EXISTS admin_alerts_decision_check;

ALTER TABLE public.admin_alerts
  ADD CONSTRAINT admin_alerts_decision_check
  CHECK (decision IS NULL OR decision IN ('authorized', 'rejected', 'regularizada'));

DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('117_admin_alerts_admite_regularizada.sql');
  END IF;
END
$do$;

COMMIT;
