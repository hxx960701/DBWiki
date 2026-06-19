import type { Knex } from 'knex';

/**
 * Create the RBAC tables and seed built-in permissions and roles.
 *
 * Seed data lives inside this migration (not as a separate seed file)
 * because subsequent migrations (e.g. 011_alter_project_members_add_role_id)
 * depend on the built-in roles already existing — knex runs all migrations
 * before any seeds.
 *
 * Tables:
 *   permissions        — permission code dictionary
 *   roles              — role definitions (system roles cannot be deleted)
 *   role_permissions   — role -> permission mapping (many-to-many)
 *   user_roles         — user -> role mapping (many-to-many, global)
 *   project_role_bindings — project -> role binding (a project can grant
 *                           access to all users holding a given role)
 */
export async function up(knex: Knex) {
  await knex.schema.createTable('permissions', (table) => {
    table.string('code', 64).primary();
    table.string('name', 100).notNullable();
    table.string('description', 255).defaultTo('');
    // 'global' | 'project'
    table.string('scope', 20).notNullable().defaultTo('global');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('roles', (table) => {
    table.increments('id').primary();
    table.string('name', 64).notNullable().unique();
    table.string('description', 255).defaultTo('');
    table.boolean('is_system').notNullable().defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('role_permissions', (table) => {
    table
      .integer('role_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('roles')
      .onDelete('CASCADE');
    table
      .string('permission_code', 64)
      .notNullable()
      .references('code')
      .inTable('permissions')
      .onDelete('CASCADE');
    table.primary(['role_id', 'permission_code']);
  });

  await knex.schema.createTable('user_roles', (table) => {
    table
      .integer('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    table
      .integer('role_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('roles')
      .onDelete('CASCADE');
    table.primary(['user_id', 'role_id']);
  });

  await knex.schema.createTable('project_role_bindings', (table) => {
    table.increments('id').primary();
    table
      .integer('project_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('projects')
      .onDelete('CASCADE');
    table
      .integer('role_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('roles')
      .onDelete('CASCADE');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.unique(['project_id', 'role_id']);
  });

  // ---- Seed built-in permissions ----
  const permissions: Array<{ code: string; name: string; scope: 'global' | 'project'; description: string }> = [
    // Global
    { code: 'user:manage', name: '用户管理', scope: 'global', description: '增删用户、改密、绑定角色' },
    { code: 'role:manage', name: '角色管理', scope: 'global', description: '增删改角色与权限分配' },
    { code: 'project:create', name: '创建项目', scope: 'global', description: '允许创建新项目' },
    // Project
    { code: 'project:read', name: '查看项目', scope: 'project', description: '访问项目详情' },
    { code: 'project:update', name: '修改项目', scope: 'project', description: '修改项目名称/描述' },
    { code: 'project:delete', name: '删除项目', scope: 'project', description: '删除整个项目' },
    { code: 'project:member:manage', name: '管理项目成员', scope: 'project', description: '增删项目成员、修改成员角色' },
    { code: 'connection:manage', name: '管理数据库连接', scope: 'project', description: '增删改连接、测试连接' },
    { code: 'connection:sync', name: '同步数据库结构', scope: 'project', description: '从数据库拉取最新 schema' },
    { code: 'dictionary:read', name: '查看字典', scope: 'project', description: '查看数据字典内容、导出' },
    { code: 'dictionary:edit', name: '编辑字典', scope: 'project', description: '编辑字段注释、显示名、标签' },
    { code: 'dictionary:save', name: '保存字典草稿', scope: 'project', description: '提交字典草稿' },
    { code: 'dictionary:publish', name: '发布字典', scope: 'project', description: '将草稿发布为正式版本' },
  ];
  await knex('permissions').insert(permissions);

  // ---- Seed built-in roles ----
  const allCodes = permissions.map((p) => p.code);
  const projectScopeCodes = permissions.filter((p) => p.scope === 'project').map((p) => p.code);

  const roleSpecs: Array<{ name: string; description: string; is_system: boolean; permissions: string[] }> = [
    {
      name: 'system-admin',
      description: '系统管理员（拥有所有权限）',
      is_system: true,
      permissions: allCodes,
    },
    {
      name: 'general-user',
      description: '普通用户（可创建项目）',
      is_system: true,
      permissions: ['project:create'],
    },
    {
      name: 'project-admin',
      description: '项目管理员（项目内全部权限）',
      is_system: true,
      permissions: projectScopeCodes,
    },
    {
      name: 'project-editor',
      description: '项目编辑者（可编辑/保存字典，不可发布、不可改设置）',
      is_system: true,
      permissions: [
        'project:read',
        'connection:sync',
        'dictionary:read',
        'dictionary:edit',
        'dictionary:save',
      ],
    },
    {
      name: 'project-viewer',
      description: '项目查看者（仅可阅读）',
      is_system: true,
      permissions: ['project:read', 'dictionary:read'],
    },
  ];

  for (const spec of roleSpecs) {
    const [roleId] = await knex('roles').insert({
      name: spec.name,
      description: spec.description,
      is_system: spec.is_system,
    });
    if (spec.permissions.length > 0) {
      await knex('role_permissions').insert(
        spec.permissions.map((code) => ({ role_id: roleId, permission_code: code })),
      );
    }
  }

  // ---- Backfill: bind existing users to default roles based on users.role ----
  const systemAdminRole = await knex('roles').where({ name: 'system-admin' }).first();
  const generalUserRole = await knex('roles').where({ name: 'general-user' }).first();
  const adminUsers = await knex('users').where({ role: 'admin' });
  const nonAdminUsers = await knex('users').whereNot({ role: 'admin' });

  if (systemAdminRole) {
    for (const u of adminUsers) {
      await knex('user_roles').insert({ user_id: u.id, role_id: systemAdminRole.id });
    }
  }
  if (generalUserRole) {
    for (const u of nonAdminUsers) {
      await knex('user_roles').insert({ user_id: u.id, role_id: generalUserRole.id });
    }
  }
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('project_role_bindings');
  await knex.schema.dropTableIfExists('user_roles');
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('roles');
  await knex.schema.dropTableIfExists('permissions');
}
