import type { Knex } from 'knex';

/**
 * Per-version publish log: keeps full history of publish events
 * (publisher, time, notes). The original dictionary_versions.published_at /
 * notes columns are kept for backward compatibility but represent only
 * the most recent publish.
 */
export async function up(knex: Knex) {
  await knex.schema.createTable('dictionary_publish_logs', (table) => {
    table.increments('id').primary();
    table
      .integer('version_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('dictionary_versions')
      .onDelete('CASCADE');
    table
      .integer('published_by')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');
    table.timestamp('published_at').defaultTo(knex.fn.now());
    table.text('notes').defaultTo('');
    table.index(['version_id']);
    table.index(['published_at']);
  });
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('dictionary_publish_logs');
}
