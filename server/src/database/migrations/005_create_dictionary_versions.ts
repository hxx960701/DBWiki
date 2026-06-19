import type { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.schema.createTable('dictionary_versions', (table) => {
    table.increments('id').primary();
    table.integer('connection_id').unsigned().notNullable().references('id').inTable('database_connections').onDelete('CASCADE');
    table.integer('version_number').notNullable();
    table.string('status', 20).notNullable().defaultTo('draft');
    table.text('snapshot_data').defaultTo('{}');
    table.integer('created_by').unsigned().notNullable().references('id').inTable('users');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('published_at').nullable();
    table.text('notes').defaultTo('');
    table.unique(['connection_id', 'version_number']);
  });
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('dictionary_versions');
}
