-- Bootstrap default super-admin account (change password after first login in production).
-- Password: admin (argon2id, fixed salt for reproducible migration)

INSERT INTO users (username, email, password_hash, display_name, is_super_admin)
VALUES (
    'admin',
    'admin@pertisk.local',
    '$argon2id$v=19$m=19456,t=2,p=1$cGVydGlzay1hZG1pbi1zYWx0MQ$FVmvIr3PyQMYpgvbD2lY6yLAIUtmaBSJxJShkNj4+mw',
    'Administrator',
    TRUE
)
ON CONFLICT (username) DO UPDATE
SET is_super_admin = TRUE;
