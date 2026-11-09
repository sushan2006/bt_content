# Analysis engine: research, design and how ours compares

Written November 2026. Scope is social media only (Instagram, Facebook, YouTube). No paid APIs or LLM calls: every
sentence the engine writes comes from templates filled with measured numbers.

## 1. What the research says

**Video performance (per video)**
- The retention curve is the main diagnostic. Analysts read it by *shape*: a cliff in the opening seconds, a steady
  leak, a sharp drop at one moment, a drop before the end, or a healthy gradual decline. Spikes mean rewatching.
- Short-form platforms each have a "hook" number: Instagram's skip rate (share of views skipped in the first 3 seconds,
  `reels_skip_rate` in the Graph API), YouTube Shorts' "viewed vs swiped away", Facebook's 3-second views. Average
  percentage viewed is the "hold" number. Hook and hold must be read together: a bad hook and a bad middle need different fixes.
- There are no reliable universal benchmarks: watch time depends on length and niche. Every respected guide says to compare a
  video with your own similar videos (same platform, similar length), using the median, not the mean.

**Popularity**
- Views are long-tailed. Tools score each video as *views ÷ the account's median views* (the "outlier score"; 2× = breakout,
  hold off until there are ~10 posts). Compare videos at the same age: most views arrive in the first week, so a
  4-day-old video must not be judged against 30-day-old ones.
- Academic popularity models (gradient boosting, multimodal networks) need thousands of videos. With tens of videos, the
  honest approach is a small, regularised model plus "what do the breakouts have in common".

**What makes videos work (drivers)**
- Creative-analytics tools (Motion, VidMob, Segwise) tag each video's attributes — hook type, format, pace, call to action,
  style — and compare performance by attribute. Tag quality matters more than model sophistication.
- With few videos: shrink small groups toward the average (empirical Bayes), use resampling instead of normal-theory p-values,
  control the false-discovery rate when testing many attributes at once, count a video posted on three platforms as one
  video, and judge practical size, not just significance.

**Trends**
- For short, noisy series the standard is the Mann–Kendall test (is there a steady rise or fall?) with the Theil–Sen slope
  (how big is it?), both rank-based and robust to outliers.

**Explaining results to non-analysts**
- Executive dashboards should lead with the decision: one headline, a few numbers, what to do next, details on demand.
- People read "3 in 10" more accurately than "30%" (natural frequencies). Words like "likely" are read very differently by
  different people, so a certainty word should always come with a count ("early signal, 7 videos").
- Every number shown must be internally consistent: two values that round to the same words must not be presented as a difference.

## 2. The engine we should have

| Layer | What it does |
| --- | --- |
| 1 Collect | Per-platform metrics with their own definitions (views differ by platform), the hook number of each platform, retention curves where offered, the video's tags, and a maturity rule: posts younger than 2 days are left out of comparisons, younger than 7 days out of view comparisons. |
| 2 Normalise | Every number compared with the same platform and similar length; medians; rates per viewer; outlier score for views. |
| 3 Diagnose each video | Hook, hold, curve shape, the moments people left matched to what was said or shown, grade against what was expected. |
| 4 Drivers | Tag-by-tag effects from one regularised model per outcome with controls (platform, length, date, paid), cluster bootstrap over original videos, false-discovery control, each tag compared with *the rest of your videos*, plus "avoid" findings. |
| 5 Popularity | Breakout videos (≥ 2× usual views at a mature age) and the traits they share. |
| 6 Trends | Mann–Kendall + Theil–Sen on each video's score and on each outcome: what is getting better or worse, by how much. |
| 7 Act | One action per finding, ranked by size × certainty, conflicts removed, a test plan with the number of videos needed, accept/reject feedback. |
| 8 Explain | A brief (headline, numbers, three actions, best/weakest videos, trend), natural frequencies, certainty words with counts, statistics behind a click. |
| 9 Feed forward | "Learnings for the next video" on the New video page: the top do's and avoid's for the chosen style and platforms, copyable for Claude, and the same list inside the edit prompt. |

## 3. How our engine compared (before this change)

| Layer | Status | Gap |
| --- | --- | --- |
| 1 Collect | Mostly there | Instagram's skip rate was not synced, so Instagram had **no hook number at all**. No maturity rule. |
| 2 Normalise | There | Expected-vs-actual per platform and length; medians. |
| 3 Diagnose | Strong | Curve shapes, drop moments matched to transcript/scenes, grades. |
| 4 Drivers | Strong method | Each tag was compared with the *most common* other tag, not with the rest of the videos, which reads oddly ("product demo vs slow cinematic"). No "avoid" findings. |
| 5 Popularity | Missing | Views were not analysed at all. |
| 6 Trends | Weak | Oldest third vs newest third on one combined score; no size, no per-metric view. |
| 7 Act | There | Recommendations and experiments. |
| 8 Explain | Good, with errors | Contradictions in demo output: "on Instagram people watch about two fifths … on Facebook about two fifths" presented as a difference; "28 of 34 videos" counted posts, not videos; best/weakest video lines showed trivial differences ("6 in 1,000 vs usually 5") and mixed a curve label with an unrelated metric. Finding cards showed five text blocks at once. |
| 9 Feed forward | Partial | The edit prompt had terse rule bullets; no box on the New video page, nothing tailored to the chosen style or platforms. |

## 4. Changes (this release)

**Data**
- Instagram skip rate (`reels_skip_rate`) is synced as `skip_rate` (migration 015); for Instagram, "stayed past the first 3 seconds" = 1 − skip rate.
  Instagram now takes part in every hook comparison.
- Posts younger than 2 days are left out of comparisons (the brief says how many); views are compared only from day 7.
- `buildRows()` (dataset.ts) is the pure part of loading, so the whole analysis can run without a database (`analyse()` in engine.ts).

**Drivers (what makes videos work)**
- Each tag is compared with *the rest of your videos* (count-weighted contrast from the same model), not with the most common other tag.
- "Avoid" findings for tags with three or more values (e.g. "avoid videos that open with a slow cinematic shot").
- p-values come from a **permutation test**: the tag is shuffled between whole videos 300 times and the model refitted. Checked on pure
  noise: 4.2% of p-values below 0.05 and 1.0% below 0.01 (correct is 5% and 1%). Then Benjamini–Hochberg across every pattern tested.
- Certainty follows the corrected value: strong ≤ 0.05 (15+ videos, 5+ on each side), good ≤ 0.10 (8+ videos, 3+ each side), early signal
  ≤ 0.15, otherwise not shown. Before, a bootstrap "share of re-samples agreeing" decided the label and called chance patterns "good evidence".
- Effects under 0.3 standard deviations are not shown. Medium effects that need many videos to prove are shown with that caveat.

**New analyses**
- Breakout videos (popularity): views ÷ same-platform median at ≥ 7 days; ≥ 2× is a breakout; the traits breakouts share are tested with
  Fisher's exact test, corrected for the number of traits checked (without the correction, a random trait "explained" the demo breakouts).
- Trend: Mann–Kendall + Theil–Sen per outcome ("people now watch about half of each video, up from about two fifths 4 months ago"), or
  "Steady" in the brief.

**Plain language**
- `twoValues()`: two numbers are never shown in words that look equal or distort the ratio; it switches to "in 100" or percentages, or the
  finding is dropped. Headlines use the same rounding as the sentence below them.
- Counts are videos, not posts, everywhere. Best/weakest videos: one line per video with its one or two clearest differences.
- Findings page: headline, *what to do* and certainty first; the story and the statistics behind "Why we think this". Certainty legend on top.

**Feed forward**
- Every finding that can guide the next video carries a `learning` line (do/avoid, why with numbers, editing or planning advice).
- New video page: "Learnings from your past videos" for the chosen style and platforms, a style check ("Good choice" / "Careful" /
  "Not measured yet"), and **Copy for Claude**. The edit prompt contains the same list (`learningLine`), so both always agree.

**Tests**: `apps/api/test/analysis.test.ts` (21 tests) runs the whole analysis on the demo data (`scripts/demoData.ts`, also used by
`npm run seed:demo`) and checks what it must find, what it must not claim, wording consistency, calibration and the learnings.
