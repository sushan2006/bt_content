-- Instagram Reels skip rate (Graph API metric reels_skip_rate): share of views skipped in the first 3 seconds.
-- Instagram exposes no retention curve, so this is its only "hook" number; the analysis engine uses 1 − skip rate
-- as "viewers who stay past the first 3 seconds" for Instagram.
INSERT INTO metric_definitions (platform_code, metric_key, platform_metric, scope, unit, description, valid_from)
VALUES ('instagram', 'skip_rate', 'reels_skip_rate', 'publication', 'percent',
        'Share of views skipped in the first 3 seconds of the reel (Meta: estimated, in development)', '2025-08-01')
ON CONFLICT (platform_code, metric_key, scope, version) DO NOTHING;
