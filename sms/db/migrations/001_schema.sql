-- 001_schema.sql — app-owned database bootstrap.
-- Runs against OUR SQL Express instance (APP_DB_NAME), never IFL's.
-- Idempotent: safe to run repeatedly.

IF SCHEMA_ID('sms') IS NULL
    EXEC('CREATE SCHEMA sms');
GO
