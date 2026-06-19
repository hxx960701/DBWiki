import knex from '../database/connection.js';

/**
 * Permission resolution.
 *
 * The user can hold permissions through three independent paths, all unioned:
 *
 *   1. Global user_roles  — grants apply everywhere. A user bound to
 *      `system-admin` gets every permission across every project.
 *
 *   2. project_members.role_id — grants apply only to that project.
 *      This is the "individual account" binding.
 *
 *   3. project_role_bindings — for each role bound to the project, every
 *      user holding that role globally automatically receives that role's
 *      permissions in the project. This is the "project ↔ role" binding
 *      that lets an admin grant access to whole categories of users at once.
 *
 * `getGlobalPermissions` walks path 1 only.
 * `getProjectPermissions` walks all three and merges.
 */

export async function getGlobalPermissions(userId: number): Promise<string[]> {
  const rows = await knex('user_roles as ur')
    .join('role_permissions as rp', 'rp.role_id', 'ur.role_id')
    .where('ur.user_id', userId)
    .select('rp.permission_code');
  return Array.from(new Set(rows.map((r: any) => r.permission_code)));
}

export async function getProjectPermissions(
  userId: number,
  projectId: number,
): Promise<string[]> {
  const codes = new Set<string>();

  // Path 1: global roles.
  const globals = await getGlobalPermissions(userId);
  for (const c of globals) codes.add(c);

  // Path 2: project_members.role_id (this user's individual binding to the project).
  const member = await knex('project_members')
    .where({ project_id: projectId, user_id: userId })
    .first();
  if (member && member.role_id) {
    const memberCodes = await knex('role_permissions')
      .where({ role_id: member.role_id })
      .pluck('permission_code');
    for (const c of memberCodes) codes.add(c);
  }

  // Path 3: project_role_bindings — any role bound to the project that this
  // user also holds globally grants its permissions inside the project.
  const bindingCodes = await knex('project_role_bindings as prb')
    .join('user_roles as ur', function () {
      this.on('ur.role_id', '=', 'prb.role_id');
    })
    .join('role_permissions as rp', 'rp.role_id', 'prb.role_id')
    .where('prb.project_id', projectId)
    .where('ur.user_id', userId)
    .pluck('rp.permission_code');
  for (const c of bindingCodes) codes.add(c);

  return Array.from(codes);
}

/**
 * Resolve the role IDs the user holds globally. Used to evaluate project_role_bindings
 * elsewhere (e.g. to show "you have access via role X" hints).
 */
export async function getUserGlobalRoleIds(userId: number): Promise<number[]> {
  const rows = await knex('user_roles').where({ user_id: userId }).pluck('role_id');
  return rows;
}
