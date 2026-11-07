-- Simplification (Nov 2026):
--  1. Only two roles: Admin (everything) and Viewer (sees everything, can add suggestions to a video, changes nothing).
--  2. A video can show several of the company's machines (machine_ids), each modelled in 3D from its photos.
--  3. A failed delivery of the final video to Google Drive is stored on the job and shown in the dashboard.

INSERT INTO permissions (code, description) VALUES ('studio.suggest', 'Add suggestions to a video before or during review')
ON CONFLICT (code) DO NOTHING;

-- everyone who could change something becomes Admin; read-only people stay Viewer
UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'admin')
 WHERE role_id IN (SELECT id FROM roles WHERE code NOT IN ('admin', 'viewer'));
DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code NOT IN ('admin', 'viewer'));
DELETE FROM roles WHERE code NOT IN ('admin', 'viewer');

UPDATE roles SET name = 'Admin', description = 'Everything: create and approve videos, publish, connect accounts, run the analysis, manage users and settings' WHERE code = 'admin';
UPDATE roles SET name = 'Viewer', description = 'Sees every page and video and can add suggestions to a video. Cannot approve, publish or change settings' WHERE code = 'viewer';

DELETE FROM role_permissions;
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'admin';
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p
 WHERE r.code = 'viewer' AND p.code IN ('analytics.view', 'content.view_all', 'insights.view', 'reports.view', 'studio.view', 'studio.suggest');

ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS machine_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS final_error TEXT;
UPDATE production_jobs SET machine_ids = ARRAY[machine_id] WHERE machine_id IS NOT NULL AND machine_ids = '{}';
