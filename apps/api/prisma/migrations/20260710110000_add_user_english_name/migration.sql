-- Add an editable English name for every user.
ALTER TABLE "User"
ADD COLUMN "englishName" VARCHAR(80);

-- Existing accounts did not have this field. Give each one a deterministic,
-- human-readable English name so the migration is safe on populated databases.
UPDATE "User"
SET "englishName" =
  (ARRAY[
    'Alex', 'Andrew', 'Chris', 'Daniel', 'David', 'Eric', 'Grace', 'Henry',
    'Iris', 'Jack', 'James', 'Jason', 'Jenny', 'Kevin', 'Leo', 'Lily',
    'Lucas', 'Mia', 'Nina', 'Oliver', 'Ryan', 'Sarah', 'Sophia', 'Steven', 'Victor'
  ])[(mod(abs(hashtext("id")::bigint), 25) + 1)::int]
  || ' ' ||
  (ARRAY[
    'Anderson', 'Brown', 'Campbell', 'Clark', 'Davis', 'Evans', 'Foster', 'Green',
    'Hall', 'Harris', 'Jackson', 'Johnson', 'Lee', 'Lewis', 'Martin', 'Miller',
    'Moore', 'Parker', 'Scott', 'Taylor', 'Thomas', 'Walker', 'White', 'Williams', 'Wilson'
  ])[(mod(abs(hashtext(reverse("id"))::bigint), 25) + 1)::int];

ALTER TABLE "User"
ALTER COLUMN "englishName" SET NOT NULL;
