/** Usage: npm run seed:admin -- admin@company.com "Full Name" "StrongPassword123" */
import { migrate } from '../db/migrate.js';
import { one, pool } from '../db/pool.js';
import { hashPassword } from '../auth/auth.js';

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password || password.length < 10) {
  console.error('Usage: npm run seed:admin -- <email> "<full name>" "<password, 10+ chars>"');
  process.exit(1);
}
await migrate();
const role = await one<any>(`SELECT id FROM roles WHERE code='admin'`);
const u = await one<any>(
  `INSERT INTO users (email, full_name, password_hash, role_id) VALUES (lower($1),$2,$3,$4)
   ON CONFLICT (email) DO UPDATE SET full_name=EXCLUDED.full_name, password_hash=EXCLUDED.password_hash, role_id=EXCLUDED.role_id, is_active=TRUE
   RETURNING id, email`, [email, name, await hashPassword(password), role.id]);
console.log(`Admin ready: ${u.email}`);
await pool.end();
