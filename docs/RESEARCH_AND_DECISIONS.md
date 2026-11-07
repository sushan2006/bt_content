# Research findings and design decisions

## How others build this

| Project | What it does | What we took / did differently |
|---|---|---|
| **Postiz** (open source, self-hosted) | Scheduling to 30+ networks, AI captions, basic analytics (reach, impressions, engagement) from official APIs | Same principle of per-platform adapters on official APIs. Its analytics are totals only: no content understanding, no segments. |
| **Mixpost** (open source, Laravel/Vue) | Self-hosted publishing + analytics charts per account | Same account-level charts. No cross-platform content identity, no history model. |
| **Supermetrics / Windsor / Improvado** (commercial connectors) | Pull Meta/YouTube metrics into BI tools | Their changelogs confirm the 2025–26 metric deprecations used here. They store data but do not explain it. |
| **Reelyze, vidIQ retention skill, shortform-analyzer, claude-watch** (2025–26 tools) | "Watch" a video (frames + transcript), predict or explain hook strength and drop-offs | Same idea of frames + transcript + LLM. **Difference:** they *predict* drop-off from the video alone. This platform aligns the video to the **real retention curve** from the platform and compares **across your own videos** with statistics. |

**Conclusion:** no open-source project combines (1) one content identity across platforms, (2) append-only metric history, (3) video understanding tied to real retention data, and (4) statistically gated, evidence-backed findings. The blueprint's core requirement is genuinely novel, so the analysis engine is custom-built.

## Platform facts that changed the blueprint

| Blueprint assumed | Reality (verified Nov 2026) | Decision |
|---|---|---|
| Instagram impressions, plays | Deprecated **21 Apr 2025**; replaced by `views`. Missing data is returned as an empty set, not 0. | Use `views`; store missing as `unavailable`. |
| Instagram audience retention per segment | **Not exposed** by the API. Reels give only average & total watch time (ms). | Instagram segment analysis uses average watch share. Retention curves come from YouTube & Facebook. Shown as "n/a (API)". |
| Facebook reach / impressions | Many Page & Post `*_unique` / impressions metrics **deprecated 15 Jun 2026**; replacements `page_total_media_view_unique`, `post_total_media_view_unique`, `*_media_view`. | Use the replacements. The adapter falls back **metric by metric**, so a future deprecation marks one metric `not_supported` instead of failing the sync. |
| Facebook retention | `total_video_retention_graph` (~41 buckets) still available; video insights only for the last 2 years. | Used. |
| YouTube impressions & CTR via Analytics API | **Not in the Analytics API.** Only in the **YouTube Reporting API** bulk report `channel_reach_basic_a1` (daily CSV, ~48 h delay). | Reporting job created automatically; daily rows imported and rolled up (CTR impression-weighted). |
| YouTube retention | `elapsedVideoTimeRatio` × `audienceWatchRatio` (100 points, can exceed 1 with rewatches) + `relativeRetentionPerformance`. | Curves normalised to the first point; rewatch detected when the curve rises. |
| YouTube "new vs returning viewers" | Not available as a public Analytics API dimension for channels. | Not collected; shown as unavailable. |
| Google OAuth | Apps in **Testing** status get refresh tokens that **expire after 7 days**. | Setup guide: publish the consent screen (or use Internal). The platform flags `token_expired` with this exact explanation. |

## Additions beyond the blueprint
1. **Demo data mode**: clearly labelled synthetic dataset to test the UI and engine before keys exist. It is kept apart from live data in every query, insight and recommendation (blueprint principle 2).
2. **Multiple-comparison correction**: picking the best of many groups inflates false findings, so p-values are Bonferroni-adjusted.
3. **Feature-overlap confounder warning**: e.g. all "product demo first" videos also have a medium editing pace, so the two effects cannot be separated.
4. **Per-video pooling**: the pooled analysis counts each original video once, not once per platform.
5. **Segment comparison per second**: segments of different lengths are compared by loss rate, not raw loss.
6. **Grounded LLM narratives**: an LLM may rephrase, but any number not present in the evidence makes the system fall back to the template.
7. **Human corrections are sticky**: re-analysis never overwrites a feature an employee corrected.
8. **Experiments loop**: preliminary findings automatically create a planned A/B experiment that can be evaluated with the same statistics.
9. **Works without Redis**: an in-process scheduler is used when `REDIS_URL` is empty. This is useful on Windows.
10. **Subtitle upload**: SRT/VTT can replace automatic speech recognition (for example YouTube captions).

## Deliberately not done in Phase 1
- **Competitor / trend intelligence** (blueprint § 5 "later within Phase 1"): official APIs do not expose other accounts' insights, and scraping breaks platform terms. It is planned as a separate module after the core is validated with real data: hashtag search (IG `ig_hashtag_search`, 30 hashtags/week limit) and YouTube public search.
- **Exact algorithm claims**: the engine only reports observable associations (principle 4).
- **Website analytics**: out of scope (see the scope decision below).
- **Paid-ads analytics**: needs the Marketing API. `is_paid` is stored where known; the filter exists.

## Engine v2 (Nov 2026): why it was rebuilt and what changed

**Problem with v1:** findings were statistically careful but unreadable for decision-makers ("33% 3-second retention, 0th percentile, p=0.139"). They were also mostly one-feature-at-a-time comparisons.

**What research said**
- *Creative analytics practice* (hook rate / hold rate tools, 2026): read hook and hold **together**. A strong hook with weak hold means the middle breaks the opening's promise. Map metrics to creative elements ("product-shot opener vs talking-head opener"), because that is what turns a number into a brief.
- *Retention-curve reading*: name the curve's shape (intro cliff / hook failure, slow bleed, mid-video collapse, ending drop) and find the 50% point. Check what was on screen at each sharp drop, and place the call to action before most viewers have gone.
- *Small samples*: hierarchical / partial pooling shrinks small groups toward the overall average in proportion to how little data they have. This beats both "every group alone" and "one average for all".
- *Communicating to managers*: natural frequencies ("1 in 4") are understood more reliably than percentages or probabilities, by experts and non-experts alike.

**What v2 does differently**
1. **Multivariate model** with controls (platform, length, publish date, paid). Each original video counts once in the uncertainty estimate (cluster bootstrap), with false-discovery-rate control across all findings. A feature that only looks good because it sits on the stronger platform gets no credit; this is covered by a unit test.
2. **Curve diagnostics**: hook, hold rate per 10 s, halfway point, ending loss, named shape, and drop moments matched to transcript, pauses and cuts.
3. **Content-risk analysis**: each video is compared with itself to measure how much faster people leave during long explanations, silences or after cuts.
4. **Expected vs actual grade (A–E)** per video for its platform and length, so "weak" means weak for that kind of video, not just few views.
5. **Plain-language layer** everywhere: headline, what happened, likely reason, what to do, what it could be worth, how sure we are ("early signal — 7 videos; publish about 6 each way to confirm"). Statistics move to "show the evidence".
6. **Executive brief** for management, plus a **report card** for every video.

## Scope decision (Nov 2026): social media analytics only
Website analytics are **out of scope**. Removed: Google Analytics 4 integration, UTM attribution, website-visit measures, enquiry and lead tracking with its webhook, and the related tables, permissions, findings and pages (migration `004_remove_web_analytics.sql`). The engine's outcomes are now:
- viewers staying past the first 3 seconds
- how much of each video people watch
- likes, comments, shares and saves per viewer
- shares and saves per viewer
- viewers reaching the call to action

Profile visits and follows reported by the social platforms themselves are kept. A call to action is still recorded as a content feature (what the video asks viewers to do), but it is measured by its effect on social behaviour only.

## Phase 2 decisions (Nov 2026)
Plan: `docs/PHASE2_PLAN.md`. It has 7 milestones: Drive intake → footage understanding → AI edit plan (JSON, validated) → FFmpeg + Remotion render → human approval → publishing → closing the loop.

Verified constraints:
- Instagram allows 100 API posts per rolling 24 hours (check `content_publishing_limit`), and containers expire after 24 hours, so scheduling lives in our database.
- YouTube uploads from unaudited projects are locked to private, so the audit has to be requested early.
- One YouTube upload costs about 1,600 of the 10,000 daily quota units.
- Remotion is free up to 3 employees; above that a Company License is needed.

Phase 1 findings become editing rules, and Phase 2 measures whether each rule actually helped.

## Simplification (8 Nov 2026)
Asked for: fewer pages, a dashboard that only shows where each video is, and fewer roles.
- **Studio dashboard**: five stage counts (Raw footage, Suggestions, Editing, Waiting for approval, Completed) and three short lists (waiting for approval, in suggestions, recently completed). Clicking a count lists that stage.
- **Machines** moved onto the New video form. A video can show several machines, each with a name and photos (`production_jobs.machine_ids`, migration `011_simplify.sql`). A named company machine replaces a generic built-in model of the same thing. In a Claude direction, `machine:1`, `machine:2` … pick one.
- **Styles & music** are one page with two tabs. The Machine library, Executive brief and Publications pages are gone. The brief is part of the Overview, and linking posts to videos is at the bottom of the Content library.
- **Overview** adds "The same video on every platform": a grouped bar chart of views, watched share or engagement rate, one bar per platform.
- **Roles**: only Admin (all permissions) and Viewer (view everything plus `studio.suggest`). Other roles were merged into Admin.
- **Drive fix**: finals approved before Google Drive was connected stayed in `drive_local`. `deliverFinal` now uploads when the version is not in Google and stores a failure on the job (`final_error`). `syncFinalsToDrive` runs every 10 minutes, and the Completed page has "Send to Drive". Publishing and video analysis fetch a cleaned-up local copy back from Drive (`ensureVersionLocal`).
- Other fixes: the Overview period filter compared `Date.toString()` with ISO dates (every post counted as in-period); experiments mixed live and demo data; `edit_style` findings for reference-video styles are now readable (`ref_<name>`).
- Verified: typecheck, 32 API tests, 12 Python tests, and an end-to-end run with 47/47 checks: two machines, two styles, viewer permissions, approval, Google Drive content_final, streaming.
