import type { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.schema.createTable('project_members', (table) => {
    table.increments('id').primary();
    table.integer('project_id').unsigned().notNullable().references('id').inTable('projects').onDelete('CASCADE');
    table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('role', 20).notNullable().defaultTo('viewer');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.unique(['project_id', 'user_id']);
  });
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('project_members');
}
