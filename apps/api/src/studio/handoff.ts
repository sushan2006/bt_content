/**
 * The hand-off to Claude Code: the prompt the dashboard copies, the name of the finished file, and the captions file
 * Claude delivers next to it. Pure functions only (no database), so they are easy to test.
 */
import { PRESET_BY_KEY, type Preset } from './presets.js';

export type Kind = 'footage' | 'voiceover' | 'animation';
export interface Options { length_sec?: number | null; format?: '9:16' | '16:9'; storyboard?: boolean; music?: boolean; sfx?: boolean; subtitles?: boolean }
export interface FileRef { name: string; link?: string | null; size?: number | null; tags?: string[]; take_id?: string | null }
export interface PromptContext {
  job: { code: string; title: string; kind: Kind; options: Options; platforms: string[]; brief: any; publish_at?: string | null };
  style: { preset?: Preset | null; reference?: { name: string; summary?: string | null; report?: string[]; notes?: string | null; link?: string | null } | null; legacy?: string | null };
  brand: { company_name?: string; handle?: string; tagline?: string; cta?: string; colors?: Record<string, string>; logo_link?: string | null };
  glossary: string[];
  takes: FileRef[];
  images: FileRef[];
  voiceover?: FileRef | null;
  machines: { name: string; notes?: string | null; keywords?: string[]; photo_links: string[] }[];
  music?: { title: string; artist?: string | null; source?: string | null; link?: string | null; license?: string | null } | null;
  suggestions: { from: string; text: string }[];
  findings: string[];
  final_folder?: { where: string; link?: string | null } | null;
  job_folder_link?: string | null;
  /** The style's full prompt template (apps/api/templates/studio/<key>.md), when the style has one. */
  template?: string | null;
}

export const FORMATS = {
  '9:16': { label: 'Vertical 9:16', w: 1080, h: 1920 },
  '16:9': { label: 'Horizontal 16:9', w: 1920, h: 1080 },
} as const;

const PLATFORM_NAMES: Record<string, string> = { instagram: 'Instagram Reel', facebook: 'Facebook Reel', youtube: 'YouTube (Short when vertical and under 3 min)' };

export function fmtLength(sec?: number | null): string {
  if (!sec || sec <= 0) return 'as long as the content needs';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** File name of the finished video. It starts with the job code, which is how the dashboard finds it in content_final. */
export function finalName(code: string, title: string, ext = '.mp4'): string {
  const clean = title.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
  return `${code} ${clean}${ext}`.trim();
}
export const captionsName = (code: string) => `${code} captions.txt`;
export const thumbnailName = (code: string) => `${code} thumbnail.jpg`;
/** "JOB-012 thumbnail.jpg", "JOB-012 cover.png", "job_12 thumb.jpeg" */
export const isThumbnailName = (name: string) => /\.(jpe?g|png|webp)$/i.test(name) && /thumb|cover|poster/i.test(name);

/** "JOB-012 Water motor.mp4" -> "JOB-012" (also "job_12", "JOB-12 - final.mov"). */
export function jobCodeFromName(name: string): string | null {
  const m = name.match(/\bjob[\s_-]?(\d{1,6})\b/i);
  return m ? `JOB-${m[1].padStart(3, '0')}` : null;
}

export interface Captions { instagram?: string; facebook?: string; youtube_title?: string; youtube_description?: string; youtube_tags?: string[]; hashtags?: string[] }
const HEADINGS: [RegExp, keyof Captions][] = [
  [/^instagram( caption)?$/i, 'instagram'],
  [/^facebook( (description|caption|text))?$/i, 'facebook'],
  [/^youtube title$/i, 'youtube_title'],
  [/^youtube (description|text)$/i, 'youtube_description'],
  [/^youtube tags$/i, 'youtube_tags'],
  [/^hashtags$/i, 'hashtags'],
];

/** Reads "<JOB> captions.txt": sections start with a heading line such as "INSTAGRAM CAPTION:". */
export function parseCaptions(text: string): Captions {
  const out: Record<string, string[]> = {};
  let cur: keyof Captions | null = null;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const m = raw.match(/^\s*#{0,3}\s*([A-Za-z ]{4,40}?)\s*:\s*(.*)$/);
    const key = m ? HEADINGS.find(([re]) => re.test(m[1].trim()))?.[1] ?? null : null;
    if (key) { cur = key; out[key] = m![2] ? [m![2]] : []; continue; }
    if (cur) out[cur].push(raw);
  }
  const txt = (k: string) => (out[k] ? out[k].join('\n').trim() : undefined);
  const list = (k: string) => (out[k] ? out[k].join(' ').split(/[,\n]|\s(?=#)/).map((x) => x.trim().replace(/^#/, '')).filter(Boolean) : undefined);
  const c: Captions = { instagram: txt('instagram'), facebook: txt('facebook'), youtube_title: txt('youtube_title')?.split('\n')[0].slice(0, 100),
    youtube_description: txt('youtube_description'), youtube_tags: list('youtube_tags'), hashtags: list('hashtags') };
  for (const k of Object.keys(c) as (keyof Captions)[]) if (c[k] === undefined || (Array.isArray(c[k]) && !(c[k] as string[]).length) || c[k] === '') delete c[k];
  return c;
}

const bullet = (s: string) => `- ${s}`;
const link = (f: { link?: string | null }) => (f.link ? ` — ${f.link}` : '');

/** The prompt for styles without a template (styles from a reference video, and older styles). */
export function buildBriefPrompt(c: PromptContext): string {
  const { job } = c;
  const b = job.brief ?? {};
  const fmt = FORMATS[job.options.format ?? '9:16'] ?? FORMATS['9:16'];
  const vertical = (job.options.format ?? '9:16') === '9:16';
  const company = c.brand.company_name || 'our company';
  const L: string[] = [];
  const h = (t: string) => { L.push('', `## ${t}`); };

  L.push(`# Video edit — ${job.code} · ${job.title}`, '');
  L.push(`You are the video editor for ${company}${c.brand.handle ? ` (${c.brand.handle})` : ''}. Make this video here in this chat with your own tools ` +
    `(code, FFmpeg, headless Chromium, Python). Do not use any paid API. Work with me until I approve it, then deliver the files described at the end.`);
  L.push('If this chat has the project doc `docs/EDITING_GUIDE.md`, follow it: it is our house guide for how to build these edits.');

  h('The video');
  L.push(bullet(`Title: ${job.title}`));
  if (b.topic) L.push(bullet(`What it is about: ${String(b.topic).trim()}`));
  if (b.headline) L.push(bullet(`Headline for the first seconds: "${b.headline}"`));
  L.push(bullet(`Length: ${fmtLength(job.options.length_sec)}${job.options.length_sec ? ' (stay within about 10 % of this)' : ''}`));
  L.push(bullet(`Format: ${fmt.label}, ${fmt.w} × ${fmt.h}, 30 fps, H.264 (yuv420p) + AAC 48 kHz, loudness about −14 LUFS, true peak ≤ −1 dB`));
  if (job.platforms.length) L.push(bullet(`Where it will be posted: ${job.platforms.map((p) => PLATFORM_NAMES[p] ?? p).join(', ')}`));
  if (b.speaker_name) L.push(bullet(`Speaker: ${b.speaker_name}${b.speaker_role ? `, ${b.speaker_role}` : ''}`));
  const cta = b.cta || c.brand.cta;
  if (cta) L.push(bullet(`Call to action at the end: "${cta}"`));
  if (b.language && b.language !== 'en') L.push(bullet(`Language of the video: ${b.language}`));

  h('Material');
  if (job.kind === 'footage') {
    if (c.takes.length) {
      L.push(`Camera footage: ${c.takes.length} take${c.takes.length > 1 ? 's' : ''} of the same content. I will attach ${c.takes.length > 1 ? 'them' : 'it'} to this chat; if not, download from Google Drive:`);
      for (const t of c.takes) L.push(bullet(`${t.take_id ? `${t.take_id}: ` : ''}${t.name}${t.size ? ` (${(t.size / 1e6).toFixed(0)} MB)` : ''}${link(t)}`));
    } else {
      L.push('Camera footage: I will attach the takes to this chat (2–3 takes of the same content).');
    }
    L.push('Use the best take for every line (clearest delivery, no stumbles, eyes on camera), cut false starts, long pauses and filler words, and keep the speaker in sync. ' +
      'The speaker stays the backbone of the video; the motion graphics in the style below explain what is being said: cut between the speaker and full-screen graphics, or place graphics around the speaker.');
  } else if (job.kind === 'voiceover') {
    L.push(c.voiceover ? `Voiceover: ${c.voiceover.name}. I will attach it; if not, download it${link(c.voiceover)}.` : 'Voiceover: I will attach the voiceover MP3 to this chat.');
    L.push('The video is fully animated in the style below, timed to the voiceover word by word. Its length follows the voiceover.');
  } else {
    L.push('No footage and no voiceover: the whole video is animated from the topic in the style below.');
    L.push('Write a short script first (on-screen text, and narration only if I ask for it), research the topic so every fact is correct, and show me the script with the storyboard.');
  }
  if (b.script) L.push('', 'Script (the takes were recorded from this; use it to match lines and spell captions):', '```', String(b.script).trim(), '```');
  if (c.images.length) {
    L.push('', 'Pictures to use (show each one when its words are spoken):');
    for (const im of c.images) L.push(bullet(`${im.name}${im.tags?.length ? ` — when talking about: ${im.tags.join(', ')}` : ''}${link(im)}`));
  }
  if (c.machines.length) {
    L.push('', 'Our machines in this video. Draw them faithfully in the style (shape, colours, parts) from their photos:');
    for (const m of c.machines) {
      L.push(bullet(`${m.name}${m.notes ? ` — ${m.notes}` : ''}${m.keywords?.length ? ` (comes up when we say: ${m.keywords.join(', ')})` : ''}`));
      for (const p of m.photo_links) L.push(`  - photo: ${p}`);
    }
  }
  if (c.job_folder_link) L.push('', `Everything for this video is also in its Drive folder: ${c.job_folder_link}`);

  h(c.style.preset ? `Style: ${c.style.preset.name} (${c.style.preset.tagline})` : c.style.reference ? `Style: ${c.style.reference.name} (learned from a reference video)` : `Style: ${c.style.legacy ?? 'your choice'}`);
  if (c.style.preset) {
    const p = c.style.preset;
    L.push(`Technique: ${p.technique}.`, '', p.looks, '', 'Style spec:');
    for (const s of p.spec) L.push(bullet(s));
    if (p.good_to_know) L.push('', `Good to know: ${p.good_to_know}`);
    L.push('', `Best for: ${p.best_for}`);
  } else if (c.style.reference) {
    const r = c.style.reference;
    L.push(`Copy the editing style of our reference video${r.link ? ` (${r.link})` : ' (I will attach it)'}: watch it first and match its pacing, how graphics enter and leave, the captions, colour and sound. ` +
      'Only the style is copied; do not reuse any of its footage, music or text.');
    if (r.summary) L.push('', `Summary: ${r.summary}`);
    if (r.report?.length) { L.push('', 'Measured from the reference video:'); for (const x of r.report) L.push(bullet(x)); }
    if (r.notes) L.push('', `What we like about it: ${r.notes}`);
  }

  h('Brand');
  L.push(bullet(`Company: ${company}${c.brand.handle ? `, handle ${c.brand.handle}` : ''}${c.brand.tagline ? `, tagline "${c.brand.tagline}"` : ''}`));
  const colors = Object.entries(c.brand.colors ?? {}).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v));
  if (colors.length) L.push(bullet(`Colours: ${colors.map(([k, v]) => `${k} ${v}`).join(', ')}. Use them as accents within the style.`));
  L.push(bullet(`Logo: ${c.brand.logo_link ? c.brand.logo_link : 'I will attach it if you need it'}. Put it on the end card${vertical ? '' : ' and small in a corner'}; never stretch or recolour it.`));
  L.push(bullet('Fonts: free licences only (Montserrat, Inter, or the open fonts named in the style).'));

  const words = [...new Set([...(c.glossary ?? []), ...(b.keywords ?? [])])].filter(Boolean);
  if (words.length || b.spellings) {
    h('Words and spellings');
    if (words.length) L.push(bullet(`Product names and key terms (spell exactly like this, highlight when spoken): ${words.join(', ')}`));
    if (b.spellings) L.push(bullet(`Fix these in captions and on screen (heard = correct): ${b.spellings}`));
  }

  h('Captions');
  if (c.style.preset?.key === 'kinetic_type') L.push('The type is the caption in this style: on-screen words must match the voice word for word.');
  else L.push(`Burned-in captions from the transcript, 1–2 short lines, the spoken word highlighted, in a font that suits the style${vertical ? ', inside the safe zone: keep all text out of the top 220 px and the bottom 420 px (platform buttons) and 60 px from the sides' : ''}.`);

  h('Sound');
  if (job.options.music) {
    if (c.music) L.push(bullet(`Music: "${c.music.title}"${c.music.artist ? ` by ${c.music.artist}` : ''} (${c.music.source ?? 'licensed'})${link(c.music)}. Duck it under speech (about −18 dB below the voice).`));
    else L.push(bullet('Music: generate an original background bed in code that fits the style (no copyrighted or library music), ducked under speech.'));
  } else L.push(bullet('No background music.'));
  L.push(bullet(job.options.sfx ? 'Sound effects: yes — subtle whooshes, pops and clicks on the key motions, made in code or from free licences (CC0), never louder than the voice.' : 'No sound effects.'));
  L.push(bullet('Never use commercial songs or Instagram/TikTok library music.'));

  if (c.suggestions.length) {
    h('Suggestions from colleagues (follow them unless they conflict with the brief; tell me if they do)');
    for (const s of c.suggestions) L.push(bullet(`${s.from}: ${s.text.replace(/\s+/g, ' ').trim()}`));
  }
  if (c.findings.length) {
    h('What our own analytics say works (apply where it fits)');
    for (const f of c.findings) L.push(bullet(f));
  }
  if (b.notes) { h('Notes from me'); L.push(String(b.notes).trim()); }

  h('How to work');
  const steps: string[] = [];
  steps.push(job.kind === 'footage'
    ? 'Get the takes (attachments or the Drive links), transcribe them with word timestamps (faster-whisper works offline), pick the best take for each line and make a clean speech cut.'
    : job.kind === 'voiceover' ? 'Get the voiceover and transcribe it with word timestamps, so the animation is timed to every word.'
      : 'Research the topic and write the script, scene by scene.');
  if (job.options.storyboard) steps.push('Storyboard first: before animating, show me 6–10 still frames in the style with the timing and the words for each scene. Wait for my OK before you animate.');
  steps.push('Build the motion graphics as code in the style above (HTML Canvas / SVG / Three.js rendered frame by frame with headless Chromium at 30 fps, or Python), deterministic and timed to the words. Composite with the footage and audio using FFmpeg.');
  steps.push('Check your own work before showing me: look at frames from every scene, check lip sync, spelling of names, the safe zones, that nothing is cut off, and the loudness.');
  steps.push('Show me the draft (the MP4, plus a few frames). Change what I ask and show me again. Keep earlier versions so we can go back.');
  steps.forEach((s, i) => L.push(`${i + 1}. ${s}`));
  L.push('', 'Rules: do not invent claims, numbers or features that are not in the footage, the script or this brief; every fact on screen must be correct. Keep it original: copy no footage, music or artwork from anyone else.');

  h('Deliver (when I say it is approved)');
  L.push(...deliverLines(c));
  L.push('', 'Start now. If something I said is unclear or a file is missing, ask me first.');
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** What Claude hands back: the video, its captions file and its thumbnail, named with the job code. */
function deliverLines(c: PromptContext): string[] {
  const { job } = c;
  const b = job.brief ?? {};
  const vertical = (job.options.format ?? '9:16') === '9:16';
  const L: string[] = [];
  L.push(`1. **The video:** \`${finalName(job.code, job.title)}\`. Use exactly this name: the dashboard finds the video by the code ${job.code} at the start.`);
  L.push(`2. **The thumbnail:** \`${thumbnailName(job.code)}\`, a JPEG under 2 MB, ${vertical ? '1080 × 1920 (9:16; keep the subject and title inside the centre 1080 × 1080 too, because feeds crop it square)' : '1280 × 720 (16:9)'}. ` +
    'Make it a designed frame in the same style as the video: the clearest picture of the subject plus a 2–5 word title that reads on a phone. Use no small text and no claims that are not in the video. It is used as the cover on Instagram, Facebook and YouTube and in the dashboard.');
  L.push(`3. **The captions:** \`${captionsName(job.code)}\`, in exactly this format:`);
  L.push('```', 'INSTAGRAM CAPTION:', '<caption with 3–6 hashtags>', '', 'FACEBOOK DESCRIPTION:', '<text>', '', 'YOUTUBE TITLE:', '<max 100 characters>', '',
    'YOUTUBE DESCRIPTION:', '<text>', '', 'YOUTUBE TAGS:', '<tag, tag, tag>', '```');
  if (b.hashtags?.length) L.push(`Use these hashtags: ${b.hashtags.map((x: string) => `#${String(x).replace(/^#/, '')}`).join(' ')}`);
  L.push(`4. Put all three files in Google Drive › ${c.final_folder?.where ?? 'content_final'}${c.final_folder?.link ? ` (${c.final_folder.link})` : ''} if you can reach my Drive. Otherwise send them to me here and I will put them there.`);
  return L;
}

/** Section 1 of a style template, filled in from the job. */
export function templateSettings(c: PromptContext): { topic: string; settings: string; audio: string } {
  const { job } = c;
  const o = job.options ?? {};
  const b = job.brief ?? {};
  const fmt = FORMATS[o.format ?? '9:16'] ?? FORMATS['9:16'];
  const vertical = (o.format ?? '9:16') === '9:16';
  const on = (v: unknown) => (v ? 'Enabled' : 'Disabled');
  const voice = job.kind === 'voiceover' ? 'Enabled — the voiceover MP3 named in section 0 (I attach it to this chat)'
    : job.kind === 'footage' ? (c.style.preset?.key === 'simple_edit' || c.style.preset?.footage_only ? 'Disabled — any speech is part of the camera footage (see section 0)' : 'Enabled — the narration is the speech in the camera takes, cut into one clean track (see section 0)')
      : 'Disabled';
  const duration = o.length_sec ? `${o.length_sec} seconds` : job.kind === 'footage' ? 'as long as the footage needs (keep it tight)' : '30 seconds';
  const topic = [String(b.topic ?? job.title).trim(), b.headline ? `Opening headline: "${b.headline}".` : ''].filter(Boolean).join(' ');
  const settings = [
    `- Storyboard: ${on(o.storyboard)}`,
    `- Voiceover: ${voice}`,
    `- Voiceover transcript (optional): "${String(b.script ?? '').replace(/\s+/g, ' ').trim()}"`,
    `- Subtitles: ${on(o.subtitles)}`,
    `- Duration without voiceover: ${duration}`,
    `- Format: ${vertical ? 'Vertical, 9:16' : 'Horizontal, 16:9'}`,
    `- Native resolution: ${fmt.w} × ${fmt.h}`,
    '- Target export frame rate: 30 fps',
    '- Preview: Smooth, ideally 60 fps where supported',
  ].join('\n');
  const audio = [`- Sound effects: ${on(o.sfx)}`, `- Background music: ${on(o.music)}`, '- Final video format: MP4'].join('\n');
  return { topic, settings, audio };
}

/** The prompt for a preset style: section 0 (this job, how to work here), the style template with its configuration filled in, then the hand-off. */
export function buildTemplatePrompt(c: PromptContext): string {
  const { job } = c;
  const b = job.brief ?? {};
  const simple = c.style.preset?.key === 'simple_edit' || !!c.style.preset?.footage_only;
  const company = c.brand.company_name || 'our company';
  const { topic, settings, audio } = templateSettings(c);
  const body = String(c.template).replace('{{TOPIC}}', () => topic).replace('{{SETTINGS}}', () => settings).replace('{{AUDIO_SETTINGS}}', () => audio).trim();
  const L: string[] = [];
  const h = (t: string) => { L.push('', `## ${t}`); };

  L.push(`# 0. CONTENT STUDIO JOB ${job.code} · ${job.title} — READ THIS FIRST`, '');
  L.push(`You are making this video for ${company}${c.brand.handle ? ` (${c.brand.handle})` : ''} in a Claude Code chat. ` +
    'The style template below (from "# TASK") sets the look, motion, quality bar and workflow, and its section 1 was filled in by our dashboard for this video. ' +
    'This section and the hand-off at the end add what the template cannot know: our material, our brand and how to deliver. Where they differ from the template, they win.');
  L.push('If this chat has the project doc `docs/EDITING_GUIDE.md`, follow it too.');

  h('How to build it here');
  if (simple) {
    L.push(bullet('Edit the footage with FFmpeg and Python in this chat\'s shell. No paid API.'));
  } else {
    L.push(bullet('Build the animation as the template describes: one self-contained HTML page with a deterministic `renderAt(seconds)` and the template\'s playback and export controls. Show it as an Artifact for preview when this chat can.'));
    L.push(bullet('**Render the final MP4 here with the shell, frame-exact.** Load the page in headless Chromium at the native resolution, call `renderAt(n / 30)` for every frame, capture the canvas and pipe the frames into FFmpeg (H.264 yuv420p, 30 fps, CRF 18, `+faststart`). Render the enabled audio with an `OfflineAudioContext` using the same audio graph and event timeline, write a WAV, and mux it as AAC 48 kHz. ' +
      'This is the delivery route. The in-page Export button is a convenience, not the deliverable.'));
    L.push(bullet('Check the file with ffprobe: resolution, 30 fps, duration, and an audio stream whenever audio is enabled.'));
    L.push(bullet('The template\'s rules against terminals, local servers or build steps apply to the HTML page itself: it must run standalone in a browser. Using the shell to process footage and render the MP4 is expected. No paid API anywhere.'));
  }
  L.push(bullet('**Our own brand:** the logo in the hand-off is our authentic logo. Use it as it is (no redrawing or recolouring) and do not research other logos for us.'));

  if (job.kind === 'footage' && !simple) {
    h('Camera footage');
    L.push('This video is built on camera footage, linked in the hand-off and attached to the chat.');
    L.push(bullet('**The speaker is the backbone of the video.** The style\'s graphics carry the explanatory beats:'));
    L.push('  - full-screen cutaways while the speaker explains *how* something works');
    L.push('  - overlays that never cover the face');
    L.push('  - back to the speaker for opinions, strong statements and the call to action');
    L.push(bullet('**Cut the speech:** transcribe every take with word timestamps (faster-whisper). Pick the best take of every line and cut false starts, filler and long pauses. That cut speech is the narration and the master clock, as "Voiceover: Enabled" in section 1 describes.'));
    L.push(bullet('**Time and composite the graphics:** time them to the words and composite them with the footage in FFmpeg (alpha PNG frames for overlays).'));
    L.push(bullet('**Length:** if the useful speech is longer than the target length, tell me before cutting meaning.'));
  }
  if (job.kind === 'footage' && simple) {
    h('Camera footage');
    L.push('The footage is linked in the hand-off and attached to the chat. Follow the template: cuts, picture and sound only.');
  }
  if (job.kind === 'voiceover') {
    h('Voiceover');
    L.push(c.voiceover ? `The voiceover is "${c.voiceover.name}". I will attach it; if not, download it${link(c.voiceover)}. Its decoded length is the duration.` : 'I will attach the voiceover MP3 to this chat. Its decoded length is the duration.');
  }

  L.push('', '---', '', body, '', '---', '');
  L.push(`# CONTENT STUDIO HAND-OFF FOR ${job.code}`);

  h('Material');
  if (c.takes.length) {
    L.push(`Camera takes (I will attach ${c.takes.length > 1 ? 'them' : 'it'}; otherwise download from Google Drive):`);
    for (const t of c.takes) L.push(bullet(`${t.take_id ? `${t.take_id}: ` : ''}${t.name}${t.size ? ` (${(t.size / 1e6).toFixed(0)} MB)` : ''}${link(t)}`));
  } else if (job.kind === 'footage') L.push('Camera takes: I will attach them to this chat.');
  if (b.script) L.push('', 'Script (what the takes were recorded from; use it to match lines and spell words):', '```', String(b.script).trim(), '```');
  if (c.images.length) {
    L.push('', 'Pictures to use (show each one when its words come up):');
    for (const im of c.images) L.push(bullet(`${im.name}${im.tags?.length ? ` — for: ${im.tags.join(', ')}` : ''}${link(im)}`));
  }
  if (c.machines.length) {
    L.push('', 'Our machines in this video. Show them faithfully (shape, colours, parts) from their photos:');
    for (const m of c.machines) {
      L.push(bullet(`${m.name}${m.notes ? ` — ${m.notes}` : ''}${m.keywords?.length ? ` (comes up when we say: ${m.keywords.join(', ')})` : ''}`));
      for (const p of m.photo_links) L.push(`  - photo: ${p}`);
    }
  }
  if (c.job_folder_link) L.push('', `Everything for this video is in its Drive folder: ${c.job_folder_link}`);
  if (job.options.music && c.music) L.push('', `Background music: use our licensed track "${c.music.title}"${c.music.artist ? ` by ${c.music.artist}` : ''}${link(c.music)} instead of generating one. Duck it under speech.`);

  h('Brand');
  L.push(bullet(`Company: ${company}${c.brand.handle ? `, handle ${c.brand.handle}` : ''}${c.brand.tagline ? `, tagline "${c.brand.tagline}"` : ''}`));
  const colors = Object.entries(c.brand.colors ?? {}).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v));
  if (colors.length) L.push(bullet(`Brand colours: ${colors.map(([k, v]) => `${k} ${v}`).join(', ')}. Use them as accents where they sit well in the style's palette.`));
  if (!simple) L.push(bullet(`Logo: ${c.brand.logo_link ?? 'I will attach it if you need it'}. Use it on the closing frame.`));
  if (b.speaker_name) L.push(bullet(`Speaker: ${b.speaker_name}${b.speaker_role ? `, ${b.speaker_role}` : ''}`));
  const cta = b.cta || c.brand.cta;
  if (cta && !simple) L.push(bullet(`Call to action at the end: "${cta}"`));
  if (job.platforms.length) L.push(bullet(`It will be posted on: ${job.platforms.map((p) => PLATFORM_NAMES[p] ?? p).join(', ')}`));

  const words = [...new Set([...(c.glossary ?? []), ...(b.keywords ?? [])])].filter(Boolean);
  if (words.length || b.spellings) {
    h('Words and spellings');
    if (words.length) L.push(bullet(`Spell exactly like this: ${words.join(', ')}`));
    if (b.spellings) L.push(bullet(`Fix these if heard wrong (heard = correct): ${b.spellings}`));
  }
  if (c.suggestions.length) {
    h('Suggestions from colleagues (follow them unless they conflict with the brief; tell me if they do)');
    for (const s of c.suggestions) L.push(bullet(`${s.from}: ${s.text.replace(/\s+/g, ' ').trim()}`));
  }
  if (c.findings.length) {
    h('What our own analytics say works (apply where it fits)');
    for (const f of c.findings) L.push(bullet(f));
  }
  if (b.notes) { h('Notes from me'); L.push(String(b.notes).trim()); }

  h('Deliver (when I say it is approved)');
  L.push(...deliverLines(c));
  L.push('', 'Rules: every fact on screen must be correct, with no invented numbers or claims. Copy no footage, music or artwork from anyone else.');
  return L.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

/** The prompt that is copied from the dashboard. */
export function buildPrompt(c: PromptContext): string {
  return c.template && c.style.preset ? buildTemplatePrompt(c) : buildBriefPrompt(c);
}
