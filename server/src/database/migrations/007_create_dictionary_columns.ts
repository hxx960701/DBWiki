import type { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.schema.createTable('dictionary_columns', (table) => {
    table.increments('id').primary();
    table.integer('table_id').unsigned().notNullable().references('id').inTable('dictionary_tables').onDelete('CASCADE');
    table.string('column_name', 200).notNullable();
    table.string('column_type', 100).notNullable();
    table.string('is_nullable', 5).defaultTo('YES');
    table.string('column_key', 10).defaultTo('');
    table.text('column_default').nullable();
    table.text('extra').defaultTo('');
    table.text('column_comment').defaultTo('');
    table.text('custom_comment').defaultTo('');
    table.string('display_name', 200).defaultTo('');
    table.text('tags').defaultTo('[]');
    table.integer('ordinal_position').notNullable().defaultTo(0);
  });
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('dictionary_columns');
}
