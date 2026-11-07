/** Removes the quoted previous message and signature from an email reply. */
export function strip(body: string): string {
  const out: string[] = [];
  for (const ln of body.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*>/.test(ln) || /^\s*On .+wrote:\s*$/.test(ln) || /^-{2,}\s*Original Message/i.test(ln) || /^\s*From:\s/.test(ln) || /^--\s*$/.test(ln)) break;
    out.push(ln);
  }
  return out.join('\n').trim();
}
