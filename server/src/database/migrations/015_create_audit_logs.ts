import type { Knex } from 'knex';

/**
 * Admin observability:
 *   1. Track per-user activity / login info on the users table.
 *      - last_seen_at: refreshed (throttled) by the auth middleware so we can
 *        compute "online now" without sessions or websockets.
 *      - last_login_at / last_login_ip: written on successful login.
 *   2. audit_logs: append-only event log covering auth, sync, dictionary
 *      publish/rollback, and user/role/permission mutations. Read-only from
 *      the admin UI except for a one-click "clear" action (which writes its
 *      own audit row).
 */
export async function up(knex: Knex) {
  await knex.schema.alterTable('users', (table) => {
    table.timestamp('last_seen_at').nullable();
    table.timestamp('last_login_at').nullable();
    table.string('last_login_ip', 64).nullable();
  });

  await knex.schema.createTable('audit_logs', (table) => {
    table.increments('id').primary();
    // High-level grouping for the filter UI:
    //   auth | sync | dictionary | user_mgmt | role_mgmt | system
    table.string('category', 32).notNullable();
    // Fine-grained code, e.g. login.success / sync.apply / dictionary.publish
    table.string('action', 64).notNullable();

    // Actor. user_id is nullable so login failures (no known user) can be
    // recorded. Username is snapshot'd so the row stays readable after the
    // user is deleted.
    table
      .integer('actor_user_id')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
    table.string('actor_username', 100).defaultTo('');

    // Target of the action. Free-form so it can describe any entity:
    //   target_type: 'user' | 'role' | 'version' | 'connection' | ...
    //   target_id:   numeric id when applicable
    //   target_label: human-readable snapshot ("v3", "订单库", "张三")
    table.string('target_type', 32).defaultTo('');
    table.integer('target_id').nullable();
    table.string('target_label', 255).defaultTo('');

    // success | failure
    table.string('result', 16).notNullable().defaultTo('success');
    table.string('message', 512).defaultTo('');

    table.string('ip_address', 64).defaultTo('');
    table.string('user_agent', 512).defaultTo('');

    // JSON-encoded extra context: duration_ms, counts, diff summary, notes...
    table.text('metadata').defaultTo('');

    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['category', 'created_at']);
    table.index(['action', 'created_at']);
    table.index(['actor_user_id', 'created_at']);
    table.index(['created_at']);
  });
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('last_seen_at');
    table.dropColumn('last_login_at');
    table.dropColumn('last_login_ip');
  });
}
