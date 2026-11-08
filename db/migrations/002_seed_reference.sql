-- Reference data: roles, permissions, platforms, metric definitions, categories, segment template

INSERT INTO roles (code, name, description) VALUES
 ('admin','Administrator','Manage users, integrations, analytics configuration and settings'),
 ('marketing_manager','Marketing Manager','All analytics, categories, campaigns, AI recommendation review'),
 ('content_creator','Content Creator','Assigned content, metadata, video analytics'),
 ('viewer','Management / Viewer','Read-only dashboards, reports and insights');

INSERT INTO permissions (code, description) VALUES
 ('users.manage','Create, edit and deactivate users'),
 ('integrations.manage','Connect and disconnect social and analytics accounts'),
 ('settings.manage','Change platform settings, segment templates'),
 ('analytics.view','View dashboards and analytics'),
 ('content.view_all','View all content items'),
 ('content.view_assigned','View content assigned to self'),
 ('content.edit','Create and edit content metadata, link publications, correct AI features'),
 ('categories.manage','Create and edit content categories'),
 ('campaigns.manage','Create and edit campaigns'),
 ('insights.view','View AI insights'),
 ('analysis.run','Trigger video analysis and intelligence runs'),
 ('recommendations.review','Accept/reject AI recommendations, manage experiments'),
 ('reports.view','View reports'),
 ('leads.view','View business leads (contains personal data)'),
 ('data.export','Export data'),
 ('audit.view','View audit log'),
 ('sync.run','Trigger manual synchronization');

-- admin: everything
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p WHERE r.code='admin';
-- marketing manager
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p WHERE r.code='marketing_manager'
  AND p.code IN ('analytics.view','content.view_all','content.edit','categories.manage','campaigns.manage','insights.view',
                 'analysis.run','recommendations.review','reports.view','leads.view','data.export','sync.run');
-- content creator
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p WHERE r.code='content_creator'
  AND p.code IN ('analytics.view','content.view_assigned','content.edit','insights.view','analysis.run');
-- viewer
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p WHERE r.code='viewer'
  AND p.code IN ('analytics.view','content.view_all','insights.view','reports.view');

INSERT INTO platforms (code, name, kind, is_enabled, capabilities) VALUES
 ('instagram','Instagram','social',TRUE,'{"retention_curve":false,"avg_watch_time":true,"demographics":true,"impressions":false,"publishing":true}'),
 ('facebook','Facebook','social',TRUE,'{"retention_curve":true,"avg_watch_time":true,"demographics":true,"impressions":false,"publishing":true}'),
 ('youtube','YouTube','social',TRUE,'{"retention_curve":true,"avg_watch_time":true,"demographics":true,"impressions":true,"impressions_via":"reporting_api","publishing":true}'),
 ('linkedin','LinkedIn','social',FALSE,'{"retention_curve":false,"note":"future integration - adapter slot reserved"}'),
 ('ga4','Google Analytics 4','web_analytics',TRUE,'{}');

-- Canonical metric map. Adapters look these up; adding a platform = adding rows here + an adapter.
INSERT INTO metric_definitions (platform_code, metric_key, platform_metric, scope, unit, description, valid_from) VALUES
 -- Instagram media (Graph API v22+; impressions/plays deprecated 2025-04-21, replaced by views)
 ('instagram','views','views','publication','count','Times the media was displayed/played (IG "views")','2025-01-21'),
 ('instagram','reach','reach','publication','count','Unique accounts that saw the media (estimated)',NULL),
 ('instagram','likes','likes','publication','count','Likes (organic only)',NULL),
 ('instagram','comments','comments','publication','count','Comments (organic only)',NULL),
 ('instagram','shares','shares','publication','count','Shares',NULL),
 ('instagram','saves','saved','publication','count','Saves',NULL),
 ('instagram','total_interactions','total_interactions','publication','count','Likes+comments+saves+shares (organic)',NULL),
 ('instagram','avg_watch_time_sec','ig_reels_avg_watch_time','publication','seconds','Average time spent playing the reel (API returns ms; stored as seconds)',NULL),
 ('instagram','total_watch_time_sec','ig_reels_video_view_total_time','publication','seconds','Total play time incl. replays (API returns ms; stored as seconds)',NULL),
 ('instagram','profile_visits','profile_visits','publication','count','Profile visits from this post (FEED only)',NULL),
 ('instagram','follows','follows','publication','count','Follows from this post (FEED only)',NULL),
 -- Instagram account
 ('instagram','followers','followers_count','account','count','Followers (field on IG user)',NULL),
 ('instagram','views','views','account','count','Account views (total_value)',NULL),
 ('instagram','reach','reach','account','count','Accounts reached (per day)',NULL),
 ('instagram','accounts_engaged','accounts_engaged','account','count','Accounts engaged',NULL),
 ('instagram','total_interactions','total_interactions','account','count','Total interactions',NULL),
 ('instagram','profile_links_taps','profile_links_taps','account','count','Taps on contact/website links in profile',NULL),
 ('instagram','follows_and_unfollows','follows_and_unfollows','account','count','Follows minus unfollows (breakdown follow_type)',NULL),
 -- Facebook post / video / reel (Page metrics deprecated 2026-06-15 replaced by *_media_view*)
 ('facebook','views','post_media_view','publication','count','Times the post was viewed (replacement for impressions)','2025-11-15'),
 ('facebook','reach','post_total_media_view_unique','publication','count','Unique viewers (replacement for post_impressions_unique)','2025-11-15'),
 ('facebook','reactions','post_reactions_by_type_total','publication','count','Reactions (sum over types)',NULL),
 ('facebook','clicks','post_clicks','publication','count','Clicks on the post',NULL),
 ('facebook','comments','comments.summary.total_count','publication','count','Comments (post field)',NULL),
 ('facebook','shares','shares.count','publication','count','Shares (post field)',NULL),
 ('facebook','video_views','total_video_views','publication','count','3-second video views',NULL),
 ('facebook','complete_views','total_video_complete_views','publication','count','Views to 95% completion',NULL),
 ('facebook','avg_watch_time_sec','total_video_avg_time_watched','publication','seconds','Average watch time (API ms -> seconds)',NULL),
 ('facebook','total_watch_time_sec','total_video_view_total_time','publication','seconds','Total watch time (API ms -> seconds)',NULL),
 ('facebook','reel_plays','blue_reels_play_count','publication','count','Reel plays',NULL),
 ('facebook','reel_avg_watch_time_sec','post_video_avg_time_watched','publication','seconds','Reel average watch time (ms -> s)',NULL),
 -- Facebook page
 ('facebook','followers','followers_count','account','count','Page followers (field)',NULL),
 ('facebook','views','page_media_view','account','count','Page content views','2025-11-15'),
 ('facebook','reach','page_total_media_view_unique','account','count','Unique viewers (replaces page_impressions_unique)','2025-11-15'),
 ('facebook','post_engagements','page_post_engagements','account','count','Engagements with page posts',NULL),
 ('facebook','new_follows','page_daily_follows_unique','account','count','New follows per day',NULL),
 ('facebook','page_actions','page_total_actions','account','count','Clicks on contact info and CTA button',NULL),
 -- YouTube video (Analytics API v2)
 ('youtube','views','views','publication','count','Views',NULL),
 ('youtube','likes','likes','publication','count','Likes',NULL),
 ('youtube','comments','comments','publication','count','Comments',NULL),
 ('youtube','shares','shares','publication','count','Shares',NULL),
 ('youtube','total_watch_time_sec','estimatedMinutesWatched','publication','seconds','Watch time (minutes -> seconds)',NULL),
 ('youtube','avg_watch_time_sec','averageViewDuration','publication','seconds','Average view duration',NULL),
 ('youtube','avg_view_percentage','averageViewPercentage','publication','percent','Average percentage viewed',NULL),
 ('youtube','subscribers_gained','subscribersGained','publication','count','Subscribers gained from video',NULL),
 ('youtube','subscribers_lost','subscribersLost','publication','count','Subscribers lost from video',NULL),
 ('youtube','impressions','video_thumbnail_impressions','publication','count','Thumbnail impressions (Reporting API channel_reach_basic_a1)',NULL),
 ('youtube','ctr','video_thumbnail_impressions_ctr','publication','ratio','Impressions click-through rate (Reporting API)',NULL),
 -- YouTube channel
 ('youtube','followers','subscriberCount','account','count','Channel subscribers (Data API)',NULL),
 ('youtube','views','views','account','count','Channel views per day',NULL),
 ('youtube','total_watch_time_sec','estimatedMinutesWatched','account','seconds','Channel watch time per day',NULL),
 ('youtube','subscribers_gained','subscribersGained','account','count','Subscribers gained per day',NULL),
 ('youtube','subscribers_lost','subscribersLost','account','count','Subscribers lost per day',NULL);

INSERT INTO content_categories (group_code, code, name) VALUES
 ('purpose','product_awareness','Product awareness'),
 ('purpose','product_demo','Product demonstration'),
 ('purpose','educational','Educational content'),
 ('purpose','manufacturing','Manufacturing / process demonstration'),
 ('purpose','company_intro','Company introduction'),
 ('purpose','brand_story','Brand storytelling'),
 ('purpose','testimonial','Customer testimonial'),
 ('purpose','promotional','Promotional content'),
 ('purpose','announcement','Company announcement'),
 ('purpose','behind_scenes','Behind-the-scenes');

INSERT INTO segment_templates (name, is_default, segments) VALUES
 ('Short-form default', TRUE,
  '[{"code":"opening","label":"Opening","start":0,"end":3},
    {"code":"hook","label":"Hook continuation","start":3,"end":8},
    {"code":"main","label":"Main content","start":8,"end":20},
    {"code":"demo","label":"Explanation / demo","start":20,"end":40},
    {"code":"ending","label":"Ending & CTA","start":"-15%","end":"100%"}]'::jsonb);

INSERT INTO app_settings (key, value) VALUES
 ('analysis', '{"min_sample_preliminary":4,"min_sample_moderate":8,"min_sample_strong":15,"alpha":0.05,"bootstrap_iterations":2000}'),
 ('sync', '{"interval_minutes":360,"backfill_days":90,"max_media_per_sync":500,"stale_after_hours":26}'),
 ('company', '{"name":"Your Company","website":"https://example.com","intro_keywords":["welcome to","we are","our company","hi, i am","hello everyone"]}');
