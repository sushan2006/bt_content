-- Review happens in the dashboard: colleagues log in and approve or ask for changes (no emails).
-- Videos are kept in Google Drive; this computer only caches them while editing.
INSERT INTO roles (code, name, description) VALUES
 ('approver', 'Approver', 'Watches the edited versions in the dashboard and approves one or asks for changes')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p
 WHERE r.code = 'approver' AND p.code IN ('studio.view', 'studio.approve', 'analytics.view', 'insights.view') ON CONFLICT DO NOTHING;

UPDATE app_settings SET value = value || '{"review_mode": "dashboard", "storage_mode": "drive", "suggestion_window_hours": 0}'::jsonb
 WHERE key = 'studio' AND NOT (value ? 'review_mode');
