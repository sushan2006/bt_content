/** Email texts for the Content Studio. Plain, short, and readable on a phone. */

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wrap = (title: string, body: string) => `<!doctype html><html><body style="margin:0;padding:0;background:#f3f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1b2631">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#1b2631;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:700">${esc(title)}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">${body}</td></tr>
<tr><td style="padding:14px 24px;background:#f3f5f7;color:#5b6b7b;font-size:12px">Sent by the Content Studio. Reply to this email to answer.</td></tr>
</table></td></tr></table></body></html>`;

export function suggestionEmail(o: { title: string; code: string; takes: number; deadline: Date; brief: any }) {
  const subject = `[${o.code}] Any suggestions for "${o.title}"?`;
  const due = o.deadline.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const briefLines = [o.brief?.headline && `Headline: ${o.brief.headline}`, o.brief?.notes && `Notes: ${o.brief.notes}`].filter(Boolean) as string[];
  const text = `New video coming up: ${o.title} (${o.code})
${o.takes} take(s) of the footage have arrived.

Do you have suggestions for the edit? Just reply to this email in plain words, for example:
- "Show the product in the first 2 seconds"
- "Keep it under 30 seconds"
- "Highlight 'wireless sensors'"
- "No music"

Reply "none" if you have no suggestions. The edit starts after everyone has replied, or at ${due}.
${briefLines.length ? '\n' + briefLines.join('\n') : ''}`;
  const html = wrap(`Suggestions for "${o.title}"`, `
<p>New video coming up: <b>${esc(o.title)}</b> (${esc(o.code)}). ${o.takes} take(s) of the footage have arrived.</p>
<p><b>Do you have suggestions for the edit?</b> Just reply to this email in plain words, for example:</p>
<ul style="padding-left:18px;color:#33475b">
<li>Show the product in the first 2 seconds</li><li>Keep it under 30 seconds</li><li>Highlight "wireless sensors"</li><li>No music</li></ul>
<p>Reply <b>none</b> if you have no suggestions. The edit starts after everyone has replied, or at <b>${esc(due)}</b>.</p>
${briefLines.length ? `<p style="color:#5b6b7b">${briefLines.map(esc).join('<br>')}</p>` : ''}`);
  return { subject, text, html };
}

export interface VersionCard { label: string; name: string; length: number; link: string | null; cid: string | null; highlights: string[]; recommended: boolean }

export function approvalEmail(o: { title: string; code: string; revision: number; versions: VersionCard[]; changes: string[]; suggestions: string[]; rulesUsed: string[] }) {
  const rec = o.versions.find((v) => v.recommended) ?? o.versions[o.versions.length - 1];
  const subject = `[${o.code}] Please review: "${o.title}"${o.revision > 1 ? ` (revision ${o.revision})` : ''}`;
  const lines = o.versions.map((v) => `Version ${v.label}: ${v.name} (${v.length.toFixed(0)} s)${v.recommended ? '  <- recommended' : ''}\n  ${v.link ?? 'open the Content Studio to watch'}\n  ${v.highlights.slice(0, 3).join('; ')}`);
  const text = `${o.title} (${o.code}) is ready for review${o.revision > 1 ? ` (revision ${o.revision})` : ''}.

${lines.join('\n\n')}
${o.changes.length ? `\nChanges made since the last version: ${o.changes.join('; ')}\n` : ''}${o.suggestions.length ? `\nTeam suggestions used: ${o.suggestions.join('; ')}\n` : ''}${o.rulesUsed.length ? `\nWhat the data told us to do: ${o.rulesUsed.join('; ')}\n` : ''}
How to answer - just reply to this email:
- "Approved"            publishes version ${rec.label} (${rec.name})
- "Approve A" / "B" / "C" / "D"   publishes that version
- "Not approved"        stops this video
- Or describe the changes, e.g. "make the logo bigger and cut the first 2 seconds"
One approval is enough.`;
  const cards = o.versions.map((v) => `
<td valign="top" width="${Math.floor(100 / o.versions.length)}%" style="padding:6px">
 <div style="border:${v.recommended ? '2px solid #f29c13' : '1px solid #dde3e9'};border-radius:10px;overflow:hidden">
  ${v.cid ? `<a href="${esc(v.link ?? '#')}"><img src="cid:${v.cid}" width="170" style="display:block;width:100%;height:auto" alt="Version ${esc(v.label)}"></a>` : ''}
  <div style="padding:10px">
   <div style="font-weight:700">Version ${esc(v.label)}${v.recommended ? ' <span style="color:#f29c13">★</span>' : ''}</div>
   <div style="font-size:13px;color:#33475b">${esc(v.name)} · ${v.length.toFixed(0)} s</div>
   ${v.link ? `<div style="margin-top:8px"><a href="${esc(v.link)}" style="display:inline-block;background:#19a287;color:#fff;text-decoration:none;padding:6px 12px;border-radius:6px;font-size:13px">Watch</a></div>` : ''}
  </div>
 </div>
</td>`).join('');
  const html = wrap(`Review: ${o.title}`, `
<p><b>${esc(o.title)}</b> (${esc(o.code)}) is ready${o.revision > 1 ? ` — revision ${o.revision}` : ''}. ${o.versions.length} versions were made from the same footage:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cards}</tr></table>
${o.changes.length ? `<p><b>Changes since the last version:</b> ${o.changes.map(esc).join('; ')}</p>` : ''}
${o.suggestions.length ? `<p><b>Team suggestions used:</b> ${o.suggestions.map(esc).join('; ')}</p>` : ''}
${o.rulesUsed.length ? `<p><b>What our data told us to do:</b> ${o.rulesUsed.map(esc).join('; ')}</p>` : ''}
<div style="background:#f3f5f7;border-radius:10px;padding:14px 16px;margin-top:14px">
<b>How to answer — just reply to this email:</b><br>
• <b>Approved</b> — publishes version ${esc(rec.label)} (${esc(rec.name)})<br>
• <b>Approve A</b>, <b>B</b>, <b>C</b> or <b>D</b> — publishes that version<br>
• <b>Not approved</b> — stops this video<br>
• Or describe the changes, e.g. <i>"make the logo bigger and cut the first 2 seconds"</i><br>
<span style="color:#5b6b7b">One approval is enough.</span></div>`);
  return { subject, text, html };
}

export function clarifyEmail(o: { code: string; title: string }) {
  const text = `Thanks for your reply about ${o.title} (${o.code}). I could not tell what you would like. Please reply with "Approved", "Approve A" (or the letter of the version you like), "Not approved", or describe the changes.`;
  return { subject: `Re: [${o.code}] ${o.title}`, text, html: wrap('One quick question', `<p>${esc(text)}</p>`) };
}

export function publishedEmail(o: { code: string; title: string; links: { platform: string; url: string | null; status: string }[] }) {
  const rows = o.links.map((l) => `${l.platform}: ${l.status === 'published' ? l.url ?? 'published' : l.status}`);
  const text = `${o.title} (${o.code}) has been published.\n\n${rows.join('\n')}`;
  return { subject: `[${o.code}] Published: "${o.title}"`, text, html: wrap(`Published: ${o.title}`, `<p>${rows.map(esc).join('<br>')}</p>`) };
}
