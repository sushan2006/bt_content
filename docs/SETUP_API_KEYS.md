# Connecting Instagram, Facebook and YouTube

This guide explains how to get every credential the platform needs, where to put it, and how to connect each account.

**Security first.** Credentials go into the `.env` file on the computer that runs the platform. You never need to paste them into a chat, email or document. OAuth tokens are encrypted in the database (AES-256-GCM) with `TOKEN_ENCRYPTION_KEY`.

---

## What you need

| # | Credential | Where it comes from | `.env` variable | Needed for |
|---|---|---|---|---|
| 1 | Meta App ID | Meta for Developers app | `META_APP_ID` | Facebook + Instagram |
| 2 | Meta App Secret | Meta for Developers app → App settings → Basic | `META_APP_SECRET` | Facebook + Instagram |
| 3 | Google OAuth Client ID | Google Cloud Console → Credentials | `GOOGLE_CLIENT_ID` | YouTube |
| 4 | Google OAuth Client Secret | same | `GOOGLE_CLIENT_SECRET` | YouTube |
| 5 | Anthropic API key (optional) | console.anthropic.com | `ANTHROPIC_API_KEY` | AI vision analysis of video frames + AI-written insight narratives |

You do **not** need separate "API keys" for Instagram or YouTube data. Access works through **OAuth**: you click *Connect*, sign in with the company account, and approve the permissions. The platform then stores and refreshes the tokens itself.

---

## Part A — Meta (Facebook Page + Instagram)

### Before you start
1. The Instagram account must be a **Professional account** (Business or Creator). In the Instagram app go to Settings → Account type and tools → Switch to professional account.
2. The Instagram account must be **linked to the company Facebook Page**: Facebook Page → Settings → Linked accounts → Instagram → Connect.
3. The person connecting must have **full control (admin)** of the Facebook Page.

### A1. Create the Meta app
1. Go to **https://developers.facebook.com** and sign in with the Facebook account that manages the Page. Click **My Apps → Create app**.
2. Name it, for example *"Company Content Intelligence"*, and enter a contact email.
3. When asked for a **use case**, choose the options that cover managing a Facebook Page and Instagram content/insights. The menu wording changes from time to time. If you are asked for an app type instead, choose **Business**.
4. If asked, connect the app to the company's **Business portfolio** (Meta Business Suite).

### A2. Add Facebook Login and the redirect URI
1. In the app dashboard, add the product **Facebook Login for Business** (or **Facebook Login**).
2. Under its **Settings**, add this **Valid OAuth Redirect URI**:
   ```
   http://localhost:4000/api/integrations/meta/callback
   ```
   (When you deploy to a server later, also add `https://YOUR-DOMAIN/api/integrations/meta/callback` and set `API_PUBLIC_URL` to match.)
3. Go to **App settings → Basic** and copy the **App ID** and **App Secret**.

### A3. Permissions the platform requests
`pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`, `instagram_manage_insights`, `business_management`

While the app is in **Development mode**, these permissions work for **people who have a role on the app** (Admin, Developer or Tester), using their own Pages and Instagram accounts. That is all a company needs for its own accounts. To add a colleague, go to **App roles → Roles → Add people**.

**App Review is only required** if the app must access Pages or Instagram accounts belonging to people *without* a role on the app. Meta may ask for **Business Verification** for some permissions. If it does, complete it in Business Settings → Security Center.

### A4. Put the credentials in `.env`
```
META_APP_ID=123456789012345
META_APP_SECRET=abcdef0123456789abcdef0123456789
META_GRAPH_VERSION=v25.0
```
Restart the API.

### A5. Connect
Open the platform → **Integrations → Connect with Facebook**. Sign in, select the Page(s) **and** the linked Instagram account, and approve all permissions.

The platform then:
1. exchanges the login for a **long-lived user token** (~60 days)
2. gets a **Page access token** for each Page (it does not expire unless you change your password or remove the app)
3. finds the linked Instagram professional account
4. starts a backfill sync

**Alternative (quick test):** open **https://developers.facebook.com/tools/explorer**, select your app, add the six permissions above, click **Generate Access Token**, copy it, and paste it into *Integrations → "Or paste a User access token"*. It is converted to long-lived tokens in the same way.

### What Meta's API provides (2026)
| | Instagram | Facebook |
|---|---|---|
| Views | `views` (impressions/plays were removed in April 2025) | `post_media_view` / `page_media_view` |
| Reach | `reach` | `post_total_media_view_unique` (replaced `*_impressions_unique` in June 2026) |
| Watch time | Reels: average & total (ms → s) | `total_video_avg_time_watched`, `total_video_view_total_time` |
| Retention curve | **Not available** | `total_video_retention_graph` (≈41 points) |
| Demographics | followers by country/city/age/gender (≥100 followers) | fans by country (may be unavailable for small Pages) |

Metrics the API does not return are shown as **unavailable**, never as 0.

---

## Part B — Google (YouTube)

### B1. Create a Google Cloud project
1. Go to **https://console.cloud.google.com** and sign in with the Google account that **owns or manages the YouTube channel**.
2. Click the project selector → **New project** → name it, e.g. *"content-intelligence"* → **Create**.

### B2. Enable the APIs
Go to **APIs & Services → Library**, then search for and **Enable** each of these:
- **YouTube Data API v3**
- **YouTube Analytics API**
- **YouTube Reporting API** (impressions and click-through rate)

### B3. OAuth consent screen
1. **APIs & Services → OAuth consent screen** (also called *Google Auth Platform → Branding / Audience*).
2. **User type:**
   - **Internal**, if the company uses Google Workspace and the channel belongs to a Workspace account. No verification is needed and tokens do not expire.
   - **External** otherwise.
3. Fill in the app name, support email and developer email.
4. **Scopes**: add `youtube.readonly` and `yt-analytics.readonly`.
5. **Important for External apps:** in **Testing** status, Google **expires refresh tokens after 7 days**, and you would have to reconnect every week. To avoid this, go to **Audience → Publish app** (status *In production*). For your own company accounts you can use the app without completing verification. Google shows an "unverified app" warning on the sign-in screen; click **Advanced → Go to … (unsafe)**. This is expected for an internal tool.

### B4. Create OAuth credentials
1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorised redirect URI**:
   ```
   http://localhost:4000/api/integrations/google/callback
   ```
4. Copy the **Client ID** and **Client secret** into `.env`:
```
GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
```
Restart the API.

### B5. Connect
Go to **Integrations → Connect with Google**, choose the account (for a Brand Account channel, choose the channel), and approve.

### What Google's APIs provide
- **YouTube Analytics API:** views, watch time, average view duration and percentage, likes, comments, shares, subscribers gained/lost, traffic sources, geography, age/gender, and the **audience retention curve** (100 points; values can exceed 100% when people rewatch).
- **YouTube Reporting API:** **impressions and impressions CTR**. The platform creates the report job on first sync, and **the first data appears about 48 hours later**.
- Analytics data typically lags 2–3 days. New or very small videos may have no retention curve yet.
- Default quota (10,000 units/day for the Data API) is far more than a daily sync needs.

---

## Part B2 — Content Studio: Google Drive & Gmail

The Content Studio uses one Google account (personal Gmail for testing, the company account later) for Drive and Gmail.

1. In the same Google Cloud project: **APIs & Services → Library**, enable **Google Drive API** and **Gmail API**.
2. **OAuth consent screen → Data access / Scopes**: add `drive`, `gmail.send`, `gmail.readonly`. With a personal Gmail add yourself as a test user (or publish the app) — the same 7-day rule as above applies in Testing.
3. **Credentials → your OAuth client → Authorised redirect URIs**: add `http://localhost:4000/api/integrations/workspace/callback`.
4. Restart, then **Integrations → Connect Google Drive & Gmail**. Tick every permission on Google's screen. A folder **Content Studio** appears in that Drive.
5. **Studio settings**: add the suggestion and approver emails.

Publishing (Phase 2) also needs new permissions on the existing connections: reconnect **Facebook** (adds `instagram_content_publish`, `pages_manage_posts`) and **YouTube** (adds `youtube.upload`). Until Google audits the project, YouTube uploads stay private.

## Part C — Optional AI (Anthropic)
`ANTHROPIC_API_KEY` turns on:
- **Vision analysis** of sampled video frames: whether the product is visible in the first seconds, shot type, on-screen demos, diagrams
- **AI-written insight narratives.** These are constrained: every number in the text must already exist in the computed evidence, otherwise the deterministic template is kept

Without the key, everything still works: statistics, retention, transcript (local Whisper), scene/pause detection and template narratives. Visual features show as *unknown* and can be set by hand.

---

## Checklist

- [ ] Instagram is a Professional account, linked to the Facebook Page
- [ ] Meta app created, redirect URI added, App ID + Secret in `.env`
- [ ] Google project created, 3 YouTube APIs enabled
- [ ] OAuth consent screen **published** (or Internal), redirect URI added, Client ID + Secret in `.env`
- [ ] API restarted → Integrations → Connect with Facebook → Connect with Google
- [ ] First sync finished (Integrations shows *Healthy*)
- [ ] Publications linked to content items (Publications page)
- [ ] Master videos uploaded for analysis (Content → Media & analysis)
- [ ] AI insights → Run analysis

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "No Facebook Pages found" | The logged-in person has no admin role on the Page, or Page access was unticked in the login dialog. Reconnect and select the Page. |
| Instagram missing after Meta connect | The Instagram account is not Professional or not linked to the Page; or the IG account was unticked in the dialog. |
| Google "invalid_grant" after a week | The consent screen is in **Testing**. Publish it, then reconnect. |
| No refresh token from Google | Remove the app at https://myaccount.google.com/permissions and connect again. |
| YouTube impressions "unavailable" | Normal for the first ~48 h after connecting (Reporting API). |
| Retention curve missing | Instagram never provides one; YouTube/Facebook need enough views. |
| Metric shows "n/a (API)" | The platform's API does not expose it for this content type. |
| Sync "partial" | Some metrics were rejected (e.g. deprecated by the platform). See Integrations → Logs. |
