-- 011_auth.sql — fresh auth (ARCHITECTURE §11). NEVER reuses IFL's plaintext
-- Users. Hashed passwords (argon2, in app code), server-side sessions, RBAC.

IF OBJECT_ID('sms.role', 'U') IS NULL
BEGIN
    CREATE TABLE sms.role (
        role_id INT NOT NULL CONSTRAINT PK_role PRIMARY KEY,
        name    VARCHAR(20) NOT NULL UNIQUE,
        rank    INT NOT NULL   -- higher = more privilege
    );
    INSERT INTO sms.role (role_id, name, rank) VALUES
        (1, 'operator', 1), (2, 'supervisor', 2), (3, 'manager', 3), (4, 'admin', 4);
END
GO

IF OBJECT_ID('sms.app_user', 'U') IS NULL
BEGIN
    CREATE TABLE sms.app_user (
        user_id       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_app_user PRIMARY KEY,
        username      NVARCHAR(64) NOT NULL UNIQUE,
        password_hash NVARCHAR(256) NOT NULL,   -- argon2
        display_name  NVARCHAR(128) NULL,
        role_id       INT NOT NULL CONSTRAINT FK_app_user_role REFERENCES sms.role(role_id),
        active        BIT NOT NULL CONSTRAINT DF_app_user_active DEFAULT 1,
        created_at_utc DATETIME2(3) NOT NULL CONSTRAINT DF_app_user_created DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID('sms.session', 'U') IS NULL
BEGIN
    CREATE TABLE sms.session (
        session_id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_session PRIMARY KEY,
        user_id      INT NOT NULL CONSTRAINT FK_session_user REFERENCES sms.app_user(user_id),
        created_at_utc DATETIME2(3) NOT NULL CONSTRAINT DF_session_created DEFAULT SYSUTCDATETIME(),
        expires_at_utc DATETIME2(3) NOT NULL
    );
    CREATE INDEX IX_session_user ON sms.session (user_id);
END
GO
