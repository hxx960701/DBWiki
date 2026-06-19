import type { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.schema.createTable('database_connections', (table) => {
    table.increments('id').primary();
    table.integer('project_id').unsigned().notNullable().references('id').inTable('projects').onDelete('CASCADE');
    table.string('name', 100).notNullable();
    table.string('db_type', 30).notNullable();
    table.string('host', 255).notNullable();
    table.integer('port').notNullable();
    table.string('database_name', 100).notNullable();
    table.string('username', 100).defaultTo('');
    table.text('encrypted_password').defaultTo('');
    table.text('extra_config').defaultTo('{}');
    table.integer('created_by').unsigned().notNullable().references('id').inTable('users');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('database_connections');
}
