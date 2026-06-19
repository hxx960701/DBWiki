import type { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.schema.createTable('dictionary_tables', (table) => {
    table.increments('id').primary();
    table.integer('version_id').unsigned().notNullable().references('id').inTable('dictionary_versions').onDelete('CASCADE');
    table.string('table_name', 200).notNullable();
    table.text('table_comment').defaultTo('');
    table.text('custom_comment').defaultTo('');
    table.string('engine', 50).defaultTo('');
    table.integer('row_count').defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('dictionary_tables');
}
