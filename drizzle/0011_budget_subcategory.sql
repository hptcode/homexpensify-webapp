ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "subcategory_id" uuid REFERENCES "subcategories"("id") ON DELETE cascade;
DROP INDEX IF EXISTS "budgets_household_category";
CREATE UNIQUE INDEX IF NOT EXISTS "budgets_household_category_subcategory" ON "budgets" ("household_id", "category_id", "subcategory_id");
