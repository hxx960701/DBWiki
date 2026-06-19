import type { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.schema.createTable('dictionary_indexes', (table) => {
    table.increments('id').primary();
    table.integer('table_id').unsigned().notNullable().references('id').inTable('dictionary_tables').onDelete('CASCADE');
    table.string('index_name', 200).notNullable();
    table.string('index_type', 50).defaultTo('BTREE');
    table.text('columns').defaultTo('[]');
    table.integer('is_unique').defaultTo(0);
  });
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('dictionary_indexes');
}
