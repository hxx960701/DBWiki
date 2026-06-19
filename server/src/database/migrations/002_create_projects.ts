import type { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.schema.createTable('projects', (table) => {
    table.increments('id').primary();
    table.string('name', 100).notNullable();
    table.text('description').defaultTo('');
    table.integer('created_by').unsigned().notNullable().references('id').inTable('users');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('projects');
}
