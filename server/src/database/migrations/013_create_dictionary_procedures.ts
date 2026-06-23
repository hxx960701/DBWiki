import type { Knex } from 'knex';

/**
 * Stored procedures / functions captured during dictionary sync.
 *
 * Parameters are stored inline as a JSON array (same trade-off as
 * dictionary_indexes.columns) — we don't expect parameter-level editing,
 * just listing in the UI + diffing the procedure as a whole.
 */
export async function up(knex: Knex) {
  await knex.schema.createTable('dictionary_procedures', (table) => {
    table.increments('id').primary();
    table.integer('version_id').unsigned().notNullable()
      .references('id').inTable('dictionary_versions').onDelete('CASCADE');
    table.string('procedure_name', 255).notNullable();
    table.string('procedure_type', 20).defaultTo('PROCEDURE'); // 'PROCEDURE' | 'FUNCTION'
    table.string('return_type', 200).defaultTo('');
    table.text('parameters').defaultTo('[]');                  // JSON [{name,type,mode,default}]
    table.text('definition').defaultTo('');                    // full DDL / source
    table.text('procedure_comment').defaultTo('');
    table.text('custom_comment').defaultTo('');
    table.string('last_modified', 50).defaultTo('');
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('dictionary_procedures');
}
