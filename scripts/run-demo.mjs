// One-click local runner: embedded PostgreSQL (inside .pgdata) + migrations + demo data + API/dashboard on :4000
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5433;
const DB_URL = `postgres://postgres:postgres@localhost:${PORT}/content_bt`;
const env = { ...process.env, NODE_ENV: 'development', DATABASE_URL: DB_URL, REDIS_URL: '' };
const log = (m) => console.log(`\n=== ${m}`);
const run = (cmd, cwd = root) => {
  const r = spawnSync(cmd, { cwd, env, shell: true, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`Command failed: ${cmd}`);
};

if (!fs.existsSync(path.join(root, '.env'))) { log('Creating .env with random secrets'); run('node scripts/setup.mjs'); }

log('Starting database (embedded PostgreSQL on port 5433)');
const dataDir = path.join(root, '.pgdata');
const db = new EmbeddedPostgres({
  databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORT, persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {},
});
if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) await db.initialise();
// A window closed abruptly can leave the database running: stop it first, then start cleanly
if (fs.existsSync(path.join(dataDir, 'postmaster.pid'))) {
  const bin = path.join(root, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin', 'pg_ctl.exe');
  if (fs.existsSync(bin)) spawnSync(`"${bin}" -D "${dataDir}" stop -m fast`, { shell: true, stdio: 'ignore' });
  try { fs.unlinkSync(path.join(dataDir, 'postmaster.pid')); } catch { /* removed by stop */ }
}
// Closing the window can kill the runner but leave its child processes alive on Windows (database workers, the video
// service, the API), and a second double-click finds the first copy still running. Both keep ports 5433 / 8001 / 4000
// busy. Stop the earlier copy: everything started from this folder, plus whatever postgres/python/node owns our ports.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function clearLeftovers() {
  if (process.platform !== 'win32') return;
  const marker = root.replace(/'/g, "''");
  const script = [
    `$me = ${process.pid}; $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$me").ParentProcessId`,
    `$ids = @()`,
    `$ids += Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $me -and $_.ProcessId -ne $parent -and $_.CommandLine -and ($_.Name -in 'postgres.exe','python.exe','node.exe','esbuild.exe') -and $_.CommandLine.Replace('/', '\\').ToLower().Contains('${marker}'.ToLower()) -and ($_.CommandLine -match 'embedded-postgres|uvicorn|server\.ts|tsx|run-demo') } | ForEach-Object { $_.ProcessId }`,
    `$ids += Get-NetTCPConnection -LocalPort 5433,8001,4000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess } | Where-Object { $_ -ne $me -and (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName -in 'postgres','python','node' }`,
    `$ids | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`,
  ].join('; ');
  spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
}
async function portBusy(port) {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: '127.0.0.1' });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}
clearLeftovers();
for (let i = 0; i < 10 && (await portBusy(PORT)); i++) await sleep(500);
// embedded-postgres can report a failed start as an unhandled rejection with no message: catch it here
let startError = null;
const onRejection = (e) => { startError = e ?? new Error('the database process exited'); };
process.on('unhandledRejection', onRejection);
let reused = false;
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    startError = null;
    await db.start();
    await sleep(300);
    if (!startError) break;
    throw startError;
  } catch (e) {
    // a copy of the database we cannot stop (e.g. started by another window) may still be fine to use
    try {
      const c = new pg.Client({ connectionString: `postgres://postgres:postgres@localhost:${PORT}/postgres` });
      await c.connect(); await c.end();
      reused = true;
      console.log('  The database was already running: using it.');
      break;
    } catch { /* not usable */ }
    if (attempt === 3) {
      console.error(`\nThe database could not start (${e?.message || 'port 5433 is busy'}).`);
      console.error('Close any other "Content Intelligence Platform" window (or restart the computer), then run RUN_DEMO.bat again.');
      process.exit(1);
    }
    console.log(`  Database start attempt ${attempt} failed, clearing old processes and retrying...`);
    clearLeftovers();
    try { fs.unlinkSync(path.join(dataDir, 'postmaster.pid')); } catch { /* none */ }
    await sleep(2000);
  }
}
process.off('unhandledRejection', onRejection);
process.on('unhandledRejection', (e) => console.error('  (background error)', e?.message || e));
let api = null;
const stop = async (code = 0) => { try { api?.kill(); } catch {} try { analyzer?.kill(); } catch {} if (!reused) { try { await db.stop(); } catch {} } process.exit(code); };
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

try {
  try { await db.createDatabase('content_bt'); } catch { /* already exists */ }

  log('Applying database migrations');
  run('npm run migrate');

  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  const users = (await client.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  const demo = (await client.query(`SELECT count(*)::int AS n FROM content_items WHERE data_origin='demo'`)).rows[0].n;
  // demo data made by an older engine version has no executive brief: regenerate it
  const briefs = (await client.query(`SELECT count(*)::int AS n FROM ai_briefs WHERE data_origin='demo'`)).rows[0].n;
  await client.end();
  if (!users) { log('Creating login  demo@company.local / DemoPass123'); run('npm run seed:admin -- demo@company.local "Demo Admin" "DemoPass123"'); }
  if (!demo || !briefs) { log('Generating demo data and running the analysis engine (about 1 minute)'); run('npm run seed:demo'); }

  // rebuild the dashboard when its source changed since the last build (after an update)
  const crypto = await import('node:crypto');
  const hash = crypto.createHash('sha1');
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else { hash.update(e.name); hash.update(fs.readFileSync(p)); }
  } };
  walk(path.join(root, 'apps/web/src'));
  for (const f of ['index.html', 'package.json']) if (fs.existsSync(path.join(root, 'apps/web', f))) hash.update(fs.readFileSync(path.join(root, 'apps/web', f)));
  const srcHash = hash.digest('hex');
  const stampFile = path.join(root, 'apps/web/dist/.source-hash');
  const built = path.join(root, 'apps/web/dist/index.html');
  if (!fs.existsSync(built) || !fs.existsSync(stampFile) || fs.readFileSync(stampFile, 'utf8') !== srcHash) {
    log('Building the dashboard'); run('npx vite build', path.join(root, 'apps/web'));
    fs.writeFileSync(stampFile, srcHash);
  }
} catch (e) {
  console.error(`\nSetup failed: ${e.message}`);
  await stop(1);
}

// ---------- Video service (Python): video analysis for the analytics + measuring reference styles (no editing happens here)
let analyzer = null;
async function startVideoService() {
  const an = path.join(root, 'services', 'analyzer');
  const isWin = process.platform === 'win32';
  const venvPy = path.join(an, '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
  const ok = (cmd) => spawnSync(cmd, { shell: true, stdio: 'ignore' }).status === 0;
  if (!fs.existsSync(venvPy)) {
    // OpenCV / faster-whisper have wheels for Python 3.10-3.13
    const candidates = isWin ? ['py -3.12', 'py -3.11', 'py -3.13', 'py -3.10', 'python'] : ['python3.12', 'python3.11', 'python3'];
    const py = candidates.find((c) => ok(`${c} -c "import sys; assert (3,10) <= sys.version_info[:2] <= (3,13)"`));
    if (!py) { console.log('  Python 3.10-3.13 not found: video analysis and reference-style measuring are off (everything else works). Install Python 3.12 from python.org and run again.'); return; }
    log(`Creating the video service environment with ${py} (first run only)`);
    run(`${py} -m venv .venv`, an);
  }
  const req = fs.readFileSync(path.join(an, 'requirements.txt'), 'utf8');
  const stamp = path.join(an, '.venv', '.requirements');
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== req) {
    log('Installing the video service packages (first run only, a few minutes)');
    run(`"${venvPy}" -m pip install --upgrade pip -q`, an);
    run(`"${venvPy}" -m pip install -r requirements.txt`, an);
    fs.writeFileSync(stamp, req);
  }
  const { default: ffmpegPath } = await import('ffmpeg-static');
  const { default: ffprobe } = await import('ffprobe-static');
  const venv = { ...env, FFMPEG_BIN: process.env.FFMPEG_BIN || ffmpegPath, FFPROBE_BIN: process.env.FFPROBE_BIN || ffprobe.path, PYTHONIOENCODING: 'utf-8' };
  log('Starting the video service on port 8001');
  analyzer = spawn(`"${venvPy}" -m uvicorn app:app --host 127.0.0.1 --port 8001`, { cwd: an, env: venv, shell: true, stdio: 'inherit' });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try { if ((await fetch('http://127.0.0.1:8001/health')).ok) { console.log('  Video service ready'); return; } } catch { /* not yet */ }
  }
  console.log('  The video service did not start; the analytics still work. See the messages above.');
}
try { await startVideoService(); } catch (e) { console.log(`  Video service could not be prepared: ${e.message}. Analytics still work.`); }

log('Starting the platform');
api = spawn('npx tsx src/server.ts', { cwd: path.join(root, 'apps/api'), env: { ...env, ANALYZER_URL: 'http://127.0.0.1:8001', WEB_ORIGIN: 'http://localhost:4000' }, shell: true, stdio: 'inherit' });
api.on('exit', () => stop(0));

for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { if ((await fetch('http://localhost:4000/api/health')).ok) break; } catch { /* not yet */ }
}
console.log('\n============================================================');
console.log('  Open  http://localhost:4000');
console.log('  Login demo@company.local  /  DemoPass123');
console.log('  Top-right toggle: choose "Demo data"');
console.log('  Close this window to stop everything.');
console.log('============================================================\n');
spawn('cmd', ['/c', 'start', '', 'http://localhost:4000'], { detached: true, stdio: 'ignore' });
