-- Allow recipe-scanned items in the shopping_list added_by column
ALTER TABLE shopping_list DROP CONSTRAINT IF EXISTS shopping_list_added_by_check;
ALTER TABLE shopping_list ADD CONSTRAINT shopping_list_added_by_check
  CHECK (added_by IN ('auto', 'manual', 'recipe'));
