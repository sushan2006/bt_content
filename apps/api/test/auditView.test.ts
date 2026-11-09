import { describe, expect, it } from 'vitest';
import { AREAS, actionLabel, areaOf, areaWhere, csvCell, csvRow, detailText, isFailed, itemText } from '../src/lib/auditView.js';

describe('audit view', () => {
  it('puts every known action in an area, publishing before studio', () => {
    expect(areaOf('studio.publish').key).toBe('publishing');
    expect(areaOf('studio.job.create').key).toBe('studio');
    expect(areaOf('auth.login').key).toBe('users');
    expect(areaOf('sync.manual').key).toBe('accounts');
    expect(areaOf('data.export').key).toBe('content');
    expect(areaOf('something.new').key).toBe('other');
  });
  it('area filter excludes earlier areas (studio tab does not show publishing)', () => {
    expect(areaWhere('studio')).toContain("NOT a.action LIKE ANY (ARRAY['studio.publish%','publication.%'])");
    expect(areaWhere('publishing')).not.toContain('NOT');
    expect(areaWhere('nope')).toBeNull();
    expect(AREAS.every((a) => areaWhere(a.key))).toBe(true);
  });
  it('writes readable action names and falls back to the code', () => {
    expect(actionLabel('auth.login')).toBe('Signed in');
    expect(actionLabel('studio.style_pack.add')).toBe('Added a style pack');
    expect(actionLabel('thing.did_stuff')).toBe('Thing did stuff');
  });
  it('knows failed actions', () => {
    expect(isFailed('auth.login_failed')).toBe(true);
    expect(isFailed('auth.login')).toBe(false);
  });
  it('summarises details and hides secrets', () => {
    expect(detailText(null)).toBe('');
    expect(detailText({ email: 'a@b.c', role: 'viewer', password: 'x' })).toBe('email: a@b.c · role: viewer');
    expect(detailText({ password: '***', token: 'abc' })).toBe('');
    expect(detailText({ items: [1, 2, 3], nested: { a: 1 } })).toBe('items: 3 items · nested: …');
    expect(detailText({ a: 1, b: 2, c: 3, d: 4, e: 5 }).split(' · ')).toHaveLength(4);
  });
  it('shows a job code, a short id or the plain id', () => {
    expect(itemText('production_job', '3f2c1a9e-0000-4000-8000-000000000000', 'JOB-012')).toBe('JOB-012');
    expect(itemText('user', '3f2c1a9e-0000-4000-8000-000000000000')).toBe('User 3f2c1a9e');
    expect(itemText('user', 'a@b.c')).toBe('a@b.c');
    expect(itemText('workspace', null)).toBe('Google Drive');
  });
  it('escapes CSV and blocks spreadsheet formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('-1+2')).toBe("'-1+2");
    expect(csvCell(null)).toBe('');
    expect(csvRow(['a', 1, null])).toBe('a,1,');
  });
});
