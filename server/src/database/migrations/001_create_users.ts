import type { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('username', 50).notNullable().unique();
    table.string('email', 100).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.string('role', 20).notNullable().defaultTo('viewer');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
  // Add CHECK constraint — syntax differs between SQLite and MySQL
  const dialect = knex.client.dialect;
  if (dialect === 'sqlite3') {
    await knex.raw("CREATE TRIGGER users_role_check BEFORE INSERT ON users BEGIN SELECT CASE WHEN NEW.role NOT IN ('admin','editor','viewer') THEN RAISE(ABORT, 'Invalid role') END; END;");
  } else {
    await knex.raw("CREATE TRIGGER users_role_check BEFORE INSERT ON users FOR EACH ROW BEGIN IF NEW.role NOT IN ('admin','editor','viewer') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid role'; END IF; END;");
  }
}

export async function down(knex: Knex) {
  await knex.raw('DROP TRIGGER IF EXISTS users_role_check');
  await knex.schema.dropTableIfExists('users');
}
