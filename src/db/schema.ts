/**
 * Drizzle ORM schema for the Home Expense app.
 * Source of truth: /workspace/shared-docs/home-expense-spec (CONTEXT.md + ADRs).
 *
 * Conventions (from the spec):
 *  - Tenant boundary = household. Every table holding household data carries a
 *    `householdId` and is ALWAYS queried scoped by it. Child tables
 *    (subcategories, transaction_lines) denormalize householdId so isolation is
 *    structural, not hoped-for.
 *  - Money = integer minor units (cents) of the household's single base currency.
 *  - Soft delete via `deletedAt` on mutable entities; destructive/admin actions
 *    are also recorded in `auditLog`.
 *  - Transaction = header (transactions) + >=1 lines (transactionLines). A
 *    plain single-category expense is one line.
 */

import {
  pgTable, pgEnum, uuid, text, varchar, integer, boolean,
  timestamp, date, jsonb, unique, index,
} from 'drizzle-orm/pg-core';

/* ----------------------------- enums ----------------------------- */
export const userRole = pgEnum('user_role', ['owner', 'member']);
export const direction = pgEnum('direction', ['income', 'expense']);
export const frequency = pgEnum('frequency', ['daily', 'weekly', 'bi-weekly', 'monthly', 'yearly']);

/* --------------------------- households --------------------------- */
// Tenant boundary. Single base currency for the whole household.
export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull().default('America/Los_Angeles'),
  baseCurrency: varchar('base_currency', { length: 3 }).notNull(), // 'CAD'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ----------------------------- users ----------------------------- */
// Login identity. Belongs to exactly one household (solo signup auto-creates
// its own; invite-accept joins an existing one). role = owner | member.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull().references(() => households.id, { onDelete: 'restrict' }),
  email: varchar('email', { length: 254 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(), // argon2id
  emailVerified: boolean('email_verified').notNull().default(false),
  role: userRole('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  byHousehold: index('users_by_household').on(t.householdId),
}));

/* ---------------------------- sessions ---------------------------- */
// Server-side session. `id` stores the HASHED session token; the plaintext is
// only ever sent to the client as an HTTP-only Secure cookie. Revoke = delete.
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // hashed session id
  userId: uuid('user_id')
    .notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byUser: index('sessions_by_user').on(t.userId),
}));

/* ---------------------------- auth tokens -------------------------- */
// Single-use tokens for email verification and password reset. Raw token is
// only ever sent in an email link; we store its SHA-256 hash.
export const authTokenKind = pgEnum('auth_token_kind', ['email_verify', 'password_reset']);
export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: authTokenKind('kind').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byUser: index('auth_tokens_by_user').on(t.userId),
}));

/* ---------------------------- invites ---------------------------- */
// Email-based join. Only the invited address may accept (token in accept link).
export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull().references(() => households.id, { onDelete: 'cascade' }),
  invitedByUserId: uuid('invited_by_user_id')
    .notNull().references(() => users.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 254 }).notNull(),
  token: varchar('token', { length: 64 }).notNull().unique(), // accept link (opaque random token)
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byHousehold: index('invites_by_household').on(t.householdId),
}));

/* --------------------------- categories --------------------------- */
// Primary reporting axis. Per household; seeded with defaults on creation.
export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull().references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  isArchived: boolean('is_archived').notNull().default(false),
  direction: direction('direction').notNull().default('expense'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  byHousehold: index('categories_by_household').on(t.householdId),
  uniqueName: unique('categories_household_name').on(t.householdId, t.name),
}));

/* -------------------------- subcategories ------------------------- */
// Optional 2nd level (Category -> Subcategory).
export const subcategories = pgTable('subcategories', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull().references(() => households.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id')
    .notNull().references(() => categories.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  direction: direction('direction').notNull().default('expense'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  byHousehold: index('subcats_by_household').on(t.householdId),
  byCategory: index('subcats_by_category').on(t.categoryId),
}));

/* ---------------------------- budgets ---------------------------- */
// Owner-set spending LIMIT per category (monthly or yearly), or a savings GOAL
// (no category; measured against net cash flow for the period). Opt-in.
export const budgetPeriod = pgEnum('budget_period', ['monthly', 'yearly']);
export const budgetKind = pgEnum('budget_kind', ['limit', 'goal']);
export const budgets = pgTable('budgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull().references(() => households.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id')
    .references(() => categories.id, { onDelete: 'cascade' }), // null for savings goals
  subcategoryId: uuid('subcategory_id')
    .references(() => subcategories.id, { onDelete: 'cascade' }), // optional subcategory limit
  kind: budgetKind('kind').notNull().default('limit'),
  period: budgetPeriod('period').notNull().default('monthly'),
  amount: integer('amount').notNull(), // minor units (monthly or yearly figure)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byHousehold: index('budgets_by_household').on(t.householdId),
  uniqueCategory: unique('budgets_household_category').on(t.householdId, t.categoryId, t.subcategoryId),
}));

/* -------------------------- transactions -------------------------- */
// Header of a Transaction. Carries receiptTotal (may exceed sum of lines).
export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull().references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull().references(() => users.id, { onDelete: 'restrict' }), // creator
  direction: direction('direction').notNull(),
  merchant: varchar('merchant', { length: 160 }),
  transactedAt: timestamp('transacted_at', { withTimezone: true }).notNull().defaultNow(),
  receiptTotal: integer('receipt_total'), // minor units; may exceed sum(lines)
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  byHousehold: index('txns_by_household').on(t.householdId),
  byHouseholdDate: index('txns_by_household_date').on(t.householdId, t.transactedAt),
}));

/* ------------------------ transaction lines ----------------------- */
// One categorized amount within a Transaction, scoped to a category (+ optional subcategory).
export const transactionLines = pgTable('transaction_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  transactionId: uuid('transaction_id')
    .notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  householdId: uuid('household_id')
    .notNull().references(() => households.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id')
    .notNull().references(() => categories.id, { onDelete: 'restrict' }),
  subcategoryId: uuid('subcategory_id')
    .references(() => subcategories.id, { onDelete: 'restrict' }), // nullable; required-when-exist (app logic)
  amount: integer('amount').notNull(), // minor units
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  byHousehold: index('txn_lines_by_household').on(t.householdId),
  byCategory: index('txn_lines_by_category').on(t.householdId, t.categoryId),
  bySubcategory: index('txn_lines_by_subcategory').on(t.householdId, t.subcategoryId),
}));

/* ------------------------- recurring rules ------------------------ */
// First-class schedule that materializes a single-line Transaction on cadence.
// Materialization is triggered by the internal CRON_SECRET endpoint (ADR-0005).
export const recurringRules = pgTable('recurring_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull().references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull().references(() => users.id, { onDelete: 'restrict' }),
  categoryId: uuid('category_id')
    .notNull().references(() => categories.id, { onDelete: 'restrict' }),
  subcategoryId: uuid('subcategory_id')
    .references(() => subcategories.id, { onDelete: 'restrict' }),
  direction: direction('direction').notNull(),
  amount: integer('amount').notNull(), // minor units for the generated line
  merchant: varchar('merchant', { length: 160 }),
  note: text('note'),
  frequency: frequency('frequency').notNull(),
  intervalN: integer('interval_n').notNull().default(1), // every N units
  anchorDate: date('anchor_date').notNull(), // next due date
  endDate: date('end_date'),
  lastMaterializedAt: timestamp('last_materialized_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  byHousehold: index('recurring_by_household').on(t.householdId),
  dueIndex: index('recurring_due').on(t.isActive, t.anchorDate),
}));

/* --------------------------- audit log ---------------------------- */
// Targeted log of destructive/admin actions (delete txn, remove member, etc.).
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull().references(() => households.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 80 }).notNull(), // 'transaction.delete'
  detail: jsonb('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byHousehold: index('audit_by_household').on(t.householdId),
}));
