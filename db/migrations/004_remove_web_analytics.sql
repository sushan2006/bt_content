-- Scope decision (Nov 2026): the platform measures social media performance only.
-- Website analytics (Google Analytics 4), UTM attribution and enquiry/lead tracking are removed.
DROP TABLE IF EXISTS website_traffic CASCADE;
DROP TABLE IF EXISTS website_conversions CASCADE;
DROP TABLE IF EXISTS business_leads CASCADE;
DELETE FROM social_accounts WHERE platform_code = 'ga4';
DELETE FROM metric_definitions WHERE platform_code = 'ga4';
DELETE FROM platforms WHERE code = 'ga4';
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'leads.view');
DELETE FROM permissions WHERE code = 'leads.view';
-- Old findings / recommendations that talked about website visits or enquiries
UPDATE ai_insights SET status = 'superseded' WHERE status = 'active' AND (insight_type = 'business_value' OR metrics->>'outcome' = 'sessions_per_1k_views' OR metrics->>'metric' = 'sessions_per_1k_views');
UPDATE ai_recommendations SET status = 'rejected', feedback = 'removed: website analytics out of scope' WHERE status = 'proposed' AND (body ILIKE '%website visit%' OR body ILIKE '%enquir%');
DELETE FROM ai_briefs;
