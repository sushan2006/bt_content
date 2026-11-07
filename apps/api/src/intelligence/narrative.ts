import { env } from '../config.js';
import type { Finding } from './engine.js';

/** Every number in the LLM text must already appear in the evidence, otherwise the deterministic story is kept. */
export function numbersAreGrounded(text: string, evidence: string) {
  const nums = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return nums.every((n) => evidence.includes(n.replace(',', '.')) || evidence.includes(n));
}

/**
 * Optional: an LLM rewrites the plain-language story so it reads naturally for a CEO or content head.
 * It may not add numbers, videos, causes or certainty that are not in the deterministic story.
 */
export async function polishStory(f: Finding) {
  f.narrative_source = 'template';
  if (!env.ANTHROPIC_API_KEY || f.insight_type === 'data_coverage') return;
  try {
    const evidence = JSON.stringify({ headline: f.headline, story: f.story, certainty: f.certainty });
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL, max_tokens: 800,
        system: 'You edit analytics findings for a company\'s CEO and content head. Rewrite the JSON so it reads as clear, direct business English: short sentences, no jargon, no statistics terms (no p-values, percentiles, z-scores, coefficients). ' +
          'Keep every fact, keep the certainty exactly as strong or weak as given, keep "likely reason" framing for causes, never claim to know platform algorithms. Use ONLY numbers that appear in the input. ' +
          'Return JSON only with the same keys: {"headline":"","story":{"what_happened":"","why":"","what_to_do":"","how_sure":"","impact":""}}.',
        messages: [{ role: 'user', content: evidence }],
      }),
    });
    if (!res.ok) return;
    const body: any = await res.json();
    const text = body.content?.[0]?.text ?? '';
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const all = `${json.headline} ${Object.values(json.story ?? {}).join(' ')}`;
    if (!json.headline || !json.story?.what_happened || !numbersAreGrounded(all, evidence)) return;
    f.headline = json.headline;
    f.story = { ...f.story, ...Object.fromEntries(Object.entries(json.story).filter(([, v]) => typeof v === 'string' && v)) } as Finding['story'];
    f.narrative_source = 'llm';
  } catch {
    /* keep the deterministic story */
  }
}
