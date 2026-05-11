-- Seed: default admin user (change password before production)
INSERT INTO users (email, password, first_name, last_name, role)
VALUES ('admin@lendershub.com', 'CHANGE_ME', 'Admin', 'User', 'admin')
ON CONFLICT (email) DO NOTHING;
