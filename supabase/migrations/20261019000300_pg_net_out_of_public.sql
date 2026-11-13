-- pg_net does not support ALTER EXTENSION ... SET SCHEMA: reinstall it in the extensions schema.
-- Its functions stay in the "net" schema, so the scheduled call is unchanged.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
