import type { Knex } from 'knex';

/**
 * Migrate project_members.role (string enum) to role_id FK.
 *
 * Strategy (SQLite-friendly): add nullable role_id column, backfill from
 * existing role string by matching against built-in role names, leave the
 * old `role` column in place as deprecated for backward compatibility.
 *
 * Built-in roles are seeded inside migration 009 (so they exist before
 * this migration runs), which makes the backfill safe on both fresh
 * installs (no project_members rows) and existing installs.
 */
export async function up(knex: Knex) {
  // 1. Add role_id column (nullable so we can backfill existing rows)
  const hasColumn = await knex.schema.hasColumn('project_members', 'role_id');
  if (!hasColumn) {
    await knex.schema.alterTable('project_members', (table) => {
      table
        .integer('role_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('roles')
        .onDelete('RESTRICT');
    });
  }

  // 2. Backfill role_id from role string for existing rows.
  //    Map: 'admin' -> project-admin, 'editor' -> project-editor, 'viewer' -> project-viewer.
  //    Skip if no roles exist yet (fresh install — seeds run after migrations
  //    and there are no project_members rows yet anyway).
  const projectAdmin = await knex('roles').where({ name: 'project-admin' }).first();
  const projectEditor = await knex('roles').where({ name: 'project-editor' }).first();
  const projectViewer = await knex('roles').where({ name: 'project-viewer' }).first();

  if (projectAdmin && projectEditor && projectViewer) {
    await knex('project_members')
      .where({ role: 'admin' })
      .whereNull('role_id')
      .update({ role_id: projectAdmin.id });
    await knex('project_members')
      .where({ role: 'editor' })
      .whereNull('role_id')
      .update({ role_id: projectEditor.id });
    await knex('project_members')
      .where({ role: 'viewer' })
      .whereNull('role_id')
      .update({ role_id: projectViewer.id });
  }
}

export async function down(knex: Knex) {
  const hasColumn = await knex.schema.hasColumn('project_members', 'role_id');
  if (hasColumn) {
    await knex.schema.alterTable('project_members', (table) => {
      table.dropColumn('role_id');
    });
  }
}
