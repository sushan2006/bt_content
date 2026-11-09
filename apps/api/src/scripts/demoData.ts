/**
 * DEMO DATA generator (pure: no database). seedDemo.ts writes it; the engine tests run the analysis on it directly.
 * "True" effects are baked in so the engine has something to find — and things it must NOT find (random traits).
 */
import { rng } from '../intelligence/stats.js';

export const OPENINGS: Record<string, { ret3: number; subject: number; narr: number; cuts: number }> = {
  product_demo_first: { ret3: 0.8, subject: 0.8, narr: 0.6, cuts: 1.6 },
  problem_first: { ret3: 0.74, subject: 1.8, narr: 0.95, cuts: 1.0 },
  question: { ret3: 0.7, subject: 2.2, narr: 0.95, cuts: 0.8 },
  company_intro: { ret3: 0.56, subject: 3.6, narr: 0.7, cuts: 0.4 },
  slow_cinematic: { ret3: 0.43, subject: 4.5, narr: 0.1, cuts: 0.1 },
};
/** Studio styles: how fast viewers leave after the opening (lower = they stay longer). Kinetic Typography holds best. */
export const DEMO_STYLES: Record<string, number> = { kinetic_type: 0.4, paper_cutout: 1, flat_vector: 1, simple_edit: 1.6 };
const PRODUCTS = ['ACSR Conductor', 'AL59 Alloy Conductor', 'XLPE Power Cable', 'Solar DC Cable', 'Covered Conductor'];
const CATEGORIES = ['product_demo', 'manufacturing', 'educational', 'company_intro', 'testimonial'];
const SCRIPTS: Record<string, (p: string) => string[]> = {
  product_demo_first: (p) => [`This is the ${p} carrying full load.`, 'Watch what happens when we push it to twice the rated current.', `Here is why: the ${p} uses a high-conductivity alloy core.`, 'Long technical specification: strand count, diameter, tensile strength, lay ratio and resistance at twenty degrees.', 'Every reel is tested before it leaves the plant.', 'Visit our website to request a quote.'],
  problem_first: (p) => ['Tired of conductors that sag and fail every summer?', `That is the problem the ${p} was built to solve.`, 'Our engineers redesigned the core from the inside.', 'Long technical specification: strand count, diameter, tensile strength, lay ratio and resistance at twenty degrees.', 'The result is a line that lasts decades.', 'Contact us for a quote today.'],
  question: (p) => ['What decides how long a power line really lasts?', 'Most people think it is the thickness. It is not.', `With the ${p}, it is the alloy and the stranding.`, 'Long technical specification: strand count, diameter, tensile strength, lay ratio and resistance at twenty degrees.', 'That is why utilities choose it.', 'Follow us for more.'],
  company_intro: () => ['Welcome to our company.', 'We have been manufacturing conductors for over thirty years.', 'Our plant runs around the clock with modern equipment.', 'Long technical specification: strand count, diameter, tensile strength, lay ratio and resistance at twenty degrees.', 'We serve customers in many countries.', 'Visit our website to learn more.'],
  slow_cinematic: (p) => ['', '', `The ${p}. Built for the grid.`, 'Long technical specification: strand count, diameter, tensile strength, lay ratio and resistance at twenty degrees.', 'Quality you can trust.', 'Visit our website.'],
};

export interface DemoPost {
  platform: 'instagram' | 'facebook' | 'youtube'; post_id: string; video_id: string; code: string; format: string; title: string | null; caption: string;
  duration: number; published_at: string; metrics: [string, number | null, string?][]; retention: { r: number; v: number }[] | null;
  growth: { at: string; views: number }[];
}
export interface DemoItem {
  code: string; title: string; category: string; product: string; objective: string; campaign: boolean;
  features: [string, string | null, number | null][]; analysis: { duration: number; transcript: any[]; scenes: any[]; silences: any[] }; posts: DemoPost[];
}

export function generateDemo(opts: { now?: number; seed?: number; n?: number } = {}): DemoItem[] {
  const r = rng(opts.seed ?? 7), now = opts.now ?? Date.now(), N = opts.n ?? 18;
  const gauss = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
  const events = (style: string, product: string, duration: number) => {
    const lines = SCRIPTS[style](product);
    const slots = [[0, 0.12], [0.12, 0.25], [0.25, 0.4], [0.4, 0.62], [0.62, 0.85], [0.86, 0.99]];
    const transcript = lines.map((text, i) => ({ start: +(slots[i][0] * duration + (style === 'slow_cinematic' && i < 2 ? 0 : 0.3)).toFixed(2), end: +(slots[i][1] * duration).toFixed(2), text })).filter((t) => t.text);
    const nScenes = style === 'slow_cinematic' ? 3 : style === 'company_intro' ? 4 : 7;
    const scenes = Array.from({ length: nScenes }, (_, i) => ({ start: +((i * duration) / nScenes).toFixed(2), end: +(((i + 1) * duration) / nScenes).toFixed(2) }));
    return { transcript, scenes, silences: style === 'slow_cinematic' ? [{ start: 0, end: +(0.25 * duration).toFixed(2) }] : [] };
  };
  const curve = (ret3: number, duration: number, points: number, pace: number, midDrop: number, styleK: number) => {
    // fast initial drop to ret3 at 3 s, then exponential decay; slower decay for faster-paced edits and better-holding styles
    const k = ((0.9 - pace * 0.15) / Math.max(20, duration)) * styleK;
    const out: { r: number; v: number }[] = [];
    for (let i = 0; i < points; i++) {
      const ratio = points === 100 ? (i + 1) / 100 : i / (points - 1), t = ratio * duration;
      let v = t <= 3 ? 1 - (1 - ret3) * (t / 3) ** 0.7 : ret3 * Math.exp(-k * (t - 3) * 1.6);
      if (t > duration * 0.85) v *= 0.93;                    // ending drop
      // viewers leave during the long technical explanation (40–62% of the video): part at its start, the rest while it goes on
      if (midDrop) v *= 1 - midDrop * (0.4 * (ratio > 0.42 ? 1 : 0) + 0.6 * clamp((ratio - 0.42) / 0.2, 0, 1));
      out.push({ r: ratio, v: clamp(v + gauss() * 0.008, 0.01, 1.2) });
    }
    return out;
  };
  const styles = Object.keys(OPENINGS), editStyles = Object.keys(DEMO_STYLES);
  const items: DemoItem[] = [];
  for (let i = 0; i < N; i++) {
    const style = styles[i % styles.length], o = OPENINGS[style], editStyle = editStyles[i % editStyles.length];
    const product = pick(PRODUCTS);
    const category = style === 'company_intro' ? 'company_intro' : pick(CATEGORIES.filter((c) => c !== 'company_intro'));
    const duration = Math.round(clamp(25 + gauss() * 15 + (style === 'slow_cinematic' ? 15 : 0), 12, 90));
    const pace = clamp(o.cuts + gauss() * 0.4, 0, 4);
    const cta = r() < 0.6 ? pick(['website', 'website', 'enquiry']) : r() < 0.5 ? 'follow' : 'none';
    const subject = clamp(o.subject + gauss() * 0.4, 0.2, 6);
    const features: DemoItem['features'] = [
      ['opening_style', style, null], ['hook_type', style === 'question' ? 'question' : style === 'problem_first' ? 'problem' : style === 'product_demo_first' ? 'demo' : style === 'company_intro' ? 'company_intro' : 'none', null],
      ['subject_visible_by_sec', null, Math.round(subject * 10) / 10], ['opening_has_narration', r() < o.narr ? 'yes' : 'no', null],
      ['opening_scene_changes', null, Math.round(clamp(o.cuts + gauss() * 0.5, 0, 4))], ['product_shown_in_opening', subject <= 2 ? 'yes' : 'no', null],
      ['editing_pace', pace > 3 ? 'fast' : pace >= 1 ? 'medium' : 'slow', null], ['cuts_per_10s', null, Math.round(pace * 100) / 100],
      ['cta_type', cta, null], ['duration_sec', null, duration], ['edit_style', editStyle, null], ['ai_edited', 'yes', null],
    ];
    const midDrop = style === 'question' || style === 'company_intro' ? 0.25 + r() * 0.1 : r() < 0.75 ? 0.1 + r() * 0.1 : 0; // long spec sheets lose viewers
    const published = new Date(now - (120 - i * 6.5) * 864e5 - r() * 864e5 * 2);
    const posts: DemoPost[] = [];
    for (const platform of ['instagram', 'facebook', 'youtube'] as const) {
      if (platform === 'youtube' && r() < 0.2) continue;
      const pubDate = new Date(published.getTime() + (platform === 'youtube' ? 864e5 : 0) + r() * 6 * 36e5);
      const platformBias = platform === 'instagram' ? 0.03 : platform === 'facebook' ? -0.05 : 0;
      const ret3 = clamp(o.ret3 + platformBias + gauss() * 0.04, 0.2, 0.97);
      const pts = curve(ret3, duration, platform === 'youtube' ? 100 : 41, pace, midDrop, DEMO_STYLES[editStyle]);
      const avgRatio = pts.reduce((s, p) => s + p.v, 0) / pts.length;
      const baseViews = { instagram: 5200, facebook: 2400, youtube: 1800 }[platform];
      const views = Math.round(baseViews * Math.exp(gauss() * 0.5) * (0.5 + ret3));
      const reach = Math.round(views * clamp(0.72 + gauss() * 0.05, 0.4, 0.95));
      const eng = clamp(0.035 + (ret3 - 0.6) * 0.06 + gauss() * 0.006, 0.004, 0.2);
      const likes = Math.round(reach * eng * 0.7), comments = Math.round(reach * eng * 0.08), shares = Math.round(reach * eng * 0.12), saves = Math.round(reach * eng * 0.1);
      const m: DemoPost['metrics'] = [['views', views], [platform === 'facebook' ? 'reactions' : 'likes', likes], ['comments', comments], ['shares', shares]];
      if (platform === 'instagram') m.push(['saves', saves], ['skip_rate', Math.round(clamp(1 - ret3 + gauss() * 0.02, 0.02, 0.95) * 1000) / 10]); // percent, like the API
      if (platform !== 'youtube') m.push(['reach', reach]);
      else m.push(['reach', null, 'not_supported'], ['impressions', Math.round(views * 9 * Math.exp(gauss() * 0.3))], ['ctr', clamp(0.045 + gauss() * 0.01, 0.005, 0.2)]);
      m.push(['avg_watch_time_sec', Math.round(avgRatio * duration * 10) / 10], ['total_watch_time_sec', Math.round(avgRatio * duration * views)]);
      if (platform === 'instagram') m.push(['retention_curve', null, 'not_supported']);
      const growth = [0.35, 0.6, 0.82, 1].map((g, k) => ({ at: new Date(pubDate.getTime() + [1, 3, 7, 30][k] * 864e5).toISOString(), views: Math.round(views * g) })).filter((g) => Date.parse(g.at) <= now);
      posts.push({
        platform, post_id: `demo-${platform}-${i}`, video_id: `demo-v-${platform}-${i}`, code: `${platform === 'instagram' ? 'INST' : platform === 'facebook' ? 'FB' : 'YT'}-D${String(i + 1).padStart(2, '0')}`,
        format: platform === 'youtube' ? 'short_or_video' : 'reel', title: platform === 'youtube' ? `DEMO ${product}: ${style.replace(/_/g, ' ')}` : null,
        caption: `DEMO caption for ${product} #demo #${product.split(' ')[0].toLowerCase()}`, duration, published_at: pubDate.toISOString(),
        metrics: m, retention: platform === 'instagram' ? null : pts, growth,
      });
    }
    items.push({
      code: `DEMO-${String(i + 1).padStart(3, '0')}`, title: `DEMO ${product} — ${style.replace(/_/g, ' ')} #${i + 1}`, category, product,
      objective: cta === 'website' || cta === 'enquiry' ? 'lead_generation' : 'product_awareness', campaign: i % 3 === 0, features, analysis: { duration, ...events(style, product, duration) }, posts,
    });
  }
  return items;
}
