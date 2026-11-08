import { describe, expect, it } from 'vitest';
import { buildPrompt, captionsName, finalName, isThumbnailName, jobCodeFromName, parseCaptions, thumbnailName, type PromptContext } from '../src/studio/handoff.js';
import { styleTemplate } from '../src/studio/templates.js';
import { PRESET_BY_KEY, PRESETS } from '../src/studio/presets.js';
import { lengthFromText, parseBrief, styleFromText } from '../src/studio/intake.js';

const base = (over: Partial<PromptContext> = {}): PromptContext => ({
  job: { code: 'JOB-012', title: 'How the water motor works', kind: 'footage', platforms: ['instagram', 'youtube'],
    options: { length_sec: 45, format: '9:16', storyboard: true, music: true, sfx: true },
    brief: { topic: 'This video explains how the water motor works and its principle', speaker_name: 'Ravi', cta: 'Follow for more', keywords: ['impeller'], hashtags: ['IoT'] } },
  style: { preset: PRESET_BY_KEY.flat_vector },
  brand: { company_name: 'BridgeThings', handle: '@bridgethings', colors: { primary: '#19a287', bad: 'red' }, logo_link: 'https://drive.google.com/file/d/LOGO/view' },
  glossary: ['TankSync'],
  takes: [{ take_id: 'T1', name: 'take1.mp4', link: 'https://drive.google.com/file/d/T1/view', size: 52_000_000 }, { take_id: 'T2', name: 'take2.mp4', link: null }],
  images: [{ name: 'pump.jpg', tags: ['pump', 'motor'], link: 'https://drive.google.com/file/d/IMG/view' }],
  voiceover: null,
  machines: [{ name: 'TankSync controller', notes: 'blue box with a display', keywords: ['tanksync'], photo_links: ['https://drive.google.com/file/d/M1/view'] }],
  music: null,
  suggestions: [{ from: 'priya@company.com', text: 'Show the impeller spinning  when he says suction' }],
  findings: ['Start talking straight away — Videos that start talking keep more viewers'],
  final_folder: { where: 'content_final', link: 'https://drive.google.com/drive/folders/FINAL' },
  job_folder_link: 'https://drive.google.com/drive/folders/JOBF',
  ...over,
});

describe('the nine preset styles', () => {
  it('are complete and numbered 1–9', () => {
    expect(PRESETS.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(PRESETS.map((p) => p.name)).toEqual(['Paper Cut-Out', 'Generative Particles', 'Liquid Glass', 'Kinetic Typography', 'Isometric Line Art', 'Flat Vector', 'Risograph Print', '8-Bit Pixel Art', 'Simple Edit']);
    for (const p of PRESETS) {
      expect(p.spec.length).toBeGreaterThanOrEqual(5);
      expect(p.looks.length).toBeGreaterThan(40);
      expect(p.best_for.length).toBeGreaterThan(20);
    }
    expect(PRESET_BY_KEY.paper_cutout.storyboard_first).toBe(true);
    expect(PRESET_BY_KEY.simple_edit.footage_only).toBe(true);
    expect(PRESET_BY_KEY.simple_edit.defaults).toEqual({ music: false, sfx: false, subtitles: false });
  });
  it('each has a full prompt template with the dashboard placeholders', () => {
    for (const p of PRESETS) {
      const t = styleTemplate(p.key)!;
      expect(t, p.key).toBeTruthy();
      expect(t).toContain('# 1. PROJECT CONFIGURATION — FILLED IN BY THE CONTENT STUDIO DASHBOARD');
      for (const ph of ['{{TOPIC}}', '{{SETTINGS}}', '{{AUDIO_SETTINGS}}']) expect(t, `${p.key} ${ph}`).toContain(ph);
      expect(t).not.toMatch(/Claude Code,/);
    }
  });
});

describe('the template prompt (preset styles)', () => {
  const withTemplate = (key: string, over: Partial<PromptContext> = {}) => buildPrompt(base({ style: { preset: PRESET_BY_KEY[key] }, template: styleTemplate(key), ...over }));
  it('fills the template and wraps it with the job and the hand-off', () => {
    const p = withTemplate('flat_vector');
    expect(p).not.toContain('{{');
    expect(p.indexOf('# 0. CONTENT STUDIO JOB JOB-012')).toBe(0);
    expect(p).toContain('**Topic:** This video explains how the water motor works and its principle');
    expect(p).toContain('Format: Vertical, 9:16');
    expect(p).toContain('Voiceover: Enabled — the narration is the speech in the camera takes');
    expect(p).toContain('# CONTENT STUDIO HAND-OFF FOR JOB-012');
    expect(p).toContain('T1: take1.mp4 (52 MB) — https://drive.google.com/file/d/T1/view');
    expect(p).toContain('priya@company.com: Show the impeller spinning when he says suction');
    expect(p).toContain('`JOB-012 How the water motor works.mp4`');
    expect(p).toContain('`JOB-012 thumbnail.jpg`');
    expect(p).toContain('`JOB-012 captions.txt`');
    expect(p.indexOf('# 0.')).toBeLessThan(p.indexOf('# 1. PROJECT CONFIGURATION'));
    expect(p.indexOf('# 1. PROJECT CONFIGURATION')).toBeLessThan(p.indexOf('# CONTENT STUDIO HAND-OFF'));
  });
  it('every preset builds a complete prompt', () => {
    for (const k of Object.keys(PRESET_BY_KEY)) {
      const p = withTemplate(k);
      expect(p, k).not.toContain('{{');
      expect(p, k).toContain('thumbnail.jpg');
      expect(p, k).toMatch(/No paid API/i);
    }
  });
  it('Simple Edit: footage only, no graphics, subtitles and length as set', () => {
    const job = { ...base().job, title: 'Factory walk', options: { length_sec: null, format: '16:9', music: false, sfx: false, subtitles: false } };
    const p = withTemplate('simple_edit', { job });
    expect(p).toContain('no motion graphics');
    expect(p).toContain('Subtitles: Disabled');
    expect(p).toContain('Duration without voiceover: as long as the footage needs');
    expect(p).toContain('Background music: Disabled');
    expect(p).toContain('1280 × 720 (16:9)');
    const s = withTemplate('simple_edit', { job: { ...job, options: { ...job.options, subtitles: true } } });
    expect(s).toContain('Subtitles: Enabled');
  });
  it('reference styles keep the brief prompt', () => {
    const r = buildPrompt(base({ style: { reference: { name: 'Tharun explainer', summary: 's', report: [], notes: null, link: null } }, template: null }));
    expect(r).toContain('## Style: Tharun explainer (learned from a reference video)');
    expect(r).toContain('`JOB-012 thumbnail.jpg`');
  });
});

describe('the prompt for Claude Code', () => {
  const p = buildPrompt(base());
  it('carries the brief, the format and the style spec', () => {
    expect(p).toContain('# Video edit — JOB-012 · How the water motor works');
    expect(p).toContain('This video explains how the water motor works and its principle');
    expect(p).toContain('Length: 0:45');
    expect(p).toContain('Vertical 9:16, 1080 × 1920, 30 fps');
    expect(p).toContain('## Style: Flat Vector (clean 2D studio)');
    for (const line of PRESET_BY_KEY.flat_vector.spec) expect(p).toContain(line);
    expect(p).toContain('keep all text out of the top 220 px');
  });
  it('links the material in Drive and only real web links', () => {
    expect(p).toContain('T1: take1.mp4 (52 MB) — https://drive.google.com/file/d/T1/view');
    expect(p).toContain('T2: take2.mp4\n');
    expect(p).toContain('pump.jpg — when talking about: pump, motor');
    expect(p).toContain('TankSync controller — blue box with a display');
    expect(p).toContain('photo: https://drive.google.com/file/d/M1/view');
    expect(p).toContain('https://drive.google.com/drive/folders/JOBF');
  });
  it('has the brand, words, suggestions, findings and options', () => {
    expect(p).toContain('Company: BridgeThings, handle @bridgethings');
    expect(p).toContain('primary #19a287');
    expect(p).not.toContain('bad red');
    expect(p).toContain('TankSync, impeller');
    expect(p).toContain('priya@company.com: Show the impeller spinning when he says suction');
    expect(p).toContain('Start talking straight away');
    expect(p).toContain('Storyboard first');
    expect(p).toContain('generate an original background bed in code');
    expect(p).toContain('Sound effects: yes');
  });
  it('says exactly what to deliver and where', () => {
    expect(p).toContain('`JOB-012 How the water motor works.mp4`');
    expect(p).toContain('`JOB-012 captions.txt`');
    expect(p).toContain('INSTAGRAM CAPTION:');
    expect(p).toContain('content_final (https://drive.google.com/drive/folders/FINAL)');
    expect(p).toContain('#IoT');
    expect(p).toMatch(/Do not use any paid API/);
  });
  it('adapts to a voiceover, an animation, a reference style and no options', () => {
    const v = buildPrompt(base({ job: { ...base().job, kind: 'voiceover', options: { format: '16:9', music: false, sfx: false } }, voiceover: { name: 'vo.mp3', link: null } }));
    expect(v).toContain('Voiceover: vo.mp3');
    expect(v).toContain('Horizontal 16:9, 1920 × 1080');
    expect(v).toContain('No background music.');
    expect(v).toContain('No sound effects.');
    expect(v).not.toContain('Storyboard first');
    const a = buildPrompt(base({ job: { ...base().job, kind: 'animation' } }));
    expect(a).toContain('the whole video is animated from the topic');
    const r = buildPrompt(base({ style: { reference: { name: 'Tharun explainer', summary: 'Cuts every 2.1 s', report: ['Cuts every 2.1 s (20 cuts in 42 s)'], notes: '3D rising behind him', link: 'https://drive.google.com/file/d/REF/view' } } }));
    expect(r).toContain('## Style: Tharun explainer (learned from a reference video)');
    expect(r).toContain('https://drive.google.com/file/d/REF/view');
    expect(r).toContain('What we like about it: 3D rising behind him');
    expect(r).toContain('Only the style is copied');
  });
});

describe('finding the finished video and its captions', () => {
  it('names and recognises the thumbnail', () => {
    expect(thumbnailName('JOB-012')).toBe('JOB-012 thumbnail.jpg');
    expect(isThumbnailName('JOB-012 thumbnail.jpg')).toBe(true);
    expect(isThumbnailName('JOB-012 cover.PNG')).toBe(true);
    expect(isThumbnailName('JOB-012 Factory walk.mp4')).toBe(false);
    expect(isThumbnailName('JOB-012 pump photo.jpg')).toBe(false);
  });
  it('names files with the job code and reads the code back', () => {
    expect(finalName('JOB-007', 'Water: motor / pump?')).toBe('JOB-007 Water motor pump.mp4');
    expect(captionsName('JOB-007')).toBe('JOB-007 captions.txt');
    expect(jobCodeFromName('JOB-007 Water motor.mp4')).toBe('JOB-007');
    expect(jobCodeFromName('job_7 final v2.mov')).toBe('JOB-007');
    expect(jobCodeFromName('JOB-1234 x.mp4')).toBe('JOB-1234');
    expect(jobCodeFromName('Launch teaser.mp4')).toBeNull();
  });
  it('parses the captions file', () => {
    const c = parseCaptions('INSTAGRAM CAPTION:\nHow does it pull water up? 👇\n#IoT #pumps\n\nFACEBOOK DESCRIPTION:\nThe water motor, explained.\n\nYOUTUBE TITLE:\nHow a water motor works\n\nYOUTUBE DESCRIPTION:\nLine one\nLine two: with a colon\n\nYOUTUBE TAGS:\nwater motor, pump, #iot\n');
    expect(c.instagram).toBe('How does it pull water up? 👇\n#IoT #pumps');
    expect(c.facebook).toBe('The water motor, explained.');
    expect(c.youtube_title).toBe('How a water motor works');
    expect(c.youtube_description).toBe('Line one\nLine two: with a colon');
    expect(c.youtube_tags).toEqual(['water motor', 'pump', 'iot']);
    expect(parseCaptions('nothing useful here')).toEqual({});
  });
});

describe('Drive intake brief', () => {
  it('reads style, length and topic', () => {
    const b = parseBrief('Title: Water motor\nAbout: how the motor lifts water\nStyle: Flat vector\nLength: 0:45\nFormat: 9:16\nHashtags: IoT, #pumps');
    expect(b).toMatchObject({ title: 'Water motor', topic: 'how the motor lifts water', style: 'Flat vector', length: '0:45', hashtags: ['IoT', 'pumps'] });
    expect(styleFromText('Flat vector')).toBe('flat_vector');
    expect(styleFromText('8-bit pixel art')).toBe('pixel_art');
    expect(styleFromText('3')).toBe('liquid_glass');
    expect(styleFromText('unknown')).toBeNull();
    expect(lengthFromText('0:45')).toBe(45);
    expect(lengthFromText('1.5 min')).toBe(90);
    expect(lengthFromText('30s')).toBe(30);
  });
});
