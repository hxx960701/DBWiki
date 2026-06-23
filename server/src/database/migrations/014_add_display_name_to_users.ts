import type { Knex } from 'knex';

/**
 * Add display_name to users so each user can have a human-readable
 * name (e.g. 张三) separate from the login username.
 */
export async function up(knex: Knex) {
  await knex.schema.alterTable('users', (table) => {
    table.string('display_name', 100).defaultTo('');
  });
}

export async function down(knex: Knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('display_name');
  });
}
