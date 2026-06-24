import type { Knex } from 'knex';

/**
 * Table relations (foreign-key-like links managed by users, not derived from
 * the live database).
 *
 * Three tables:
 *   - table_dimensions: named "views" scoped to a connection (e.g. "工作中心",
 *     "设备"). Dimensions survive version clones because they are keyed by
 *     connection, not by version.
 *   - table_relations: FK-style links between tables, stored by table_name +
 *     column_name (not by auto-increment ids) so they remain valid after
 *     version clones reassign ids.
 *   - table_positions: canvas layout (x, y per table) per dimension.
 */
export async function up(knex: Knex) {
  await knex.schema.createTable('table_dimensions', (table) => {
    table.increments('id').primary();
    table
      .integer('connection_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('database_connections')
      .onDelete('CASCADE');
    table.string('name', 100).notNullable();
    table.text('description').defaultTo('');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.unique(['connection_id', 'name']);
  });

  await knex.schema.createTable('table_relations', (table) => {
    table.increments('id').primary();
    table
      .integer('dimension_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('table_dimensions')
      .onDelete('CASCADE');
    table.string('source_table_name', 255).notNullable();
    table.string('source_column_name', 255).notNullable();
    table.string('target_table_name', 255).notNullable();
    table.string('target_column_name', 255).notNullable();
    // '1:1' | '1:N' | 'N:M'
    table.string('relation_type', 20).notNullable().defaultTo('1:N');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['dimension_id']);
    table.index(['dimension_id', 'source_table_name']);
    table.index(['dimension_id', 'target_table_name']);
  });

  await knex.schema.createTable('table_positions', (table) => {
    table.increments('id').primary();
    table
      .integer('dimension_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('table_dimensions')
      .onDelete('CASCADE');
    table.string('table_name', 255).notNullable();
    table.integer('position_x').notNullable();
    table.integer('position_y').notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.unique(['dimension_id', 'table_name']);
  });
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('table_positions');
  await knex.schema.dropTableIfExists('table_relations');
  await knex.schema.dropTableIfExists('table_dimensions');
}
