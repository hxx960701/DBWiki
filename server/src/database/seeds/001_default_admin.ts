import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';

export async function seed(knex: Knex) {
  let admin = await knex('users').where({ username: 'admin' }).first();
  if (!admin) {
    const password_hash = await bcrypt.hash('admin123', 10);
    const [adminId] = await knex('users').insert({
      username: 'admin',
      email: 'admin@dbwiki.local',
      password_hash,
      role: 'admin',
    });
    admin = await knex('users').where({ id: adminId }).first();
  }

  // Ensure admin is bound to system-admin role.
  // Skipped silently if RBAC tables haven't been created yet (older migrations
  // would have already failed in that case).
  const sysAdminRole = await knex('roles').where({ name: 'system-admin' }).first().catch(() => null);
  if (admin && sysAdminRole) {
    const exists = await knex('user_roles')
      .where({ user_id: admin.id, role_id: sysAdminRole.id })
      .first();
    if (!exists) {
      await knex('user_roles').insert({ user_id: admin.id, role_id: sysAdminRole.id });
    }
  }
}
