-- Best-effort backfill of split name fields from the legacy `name` column.
-- Only touches rows where first_name IS NULL (i.e. not yet split manually).
--
-- Heuristic (Mexican naming convention):
--   2 words  → nombre + apellido_paterno
--   3 words  → nombre + apellido_paterno + apellido_materno
--   4 words  → nombre + segundo_nombre + apellido_paterno + apellido_materno
--   5+ words → nombre + segundo_nombre + apellido_paterno + (rest as apellido_materno)

UPDATE commerce_customers
SET
  first_name  = parts[1],
  middle_name = CASE
    WHEN array_length(parts, 1) >= 4 THEN parts[2]
    ELSE NULL
  END,
  last_name_1 = CASE
    WHEN array_length(parts, 1) = 2 THEN parts[2]
    WHEN array_length(parts, 1) = 3 THEN parts[2]
    WHEN array_length(parts, 1) >= 4 THEN parts[3]
    ELSE NULL
  END,
  last_name_2 = CASE
    WHEN array_length(parts, 1) = 3 THEN parts[3]
    WHEN array_length(parts, 1) >= 4 THEN array_to_string(parts[4:array_length(parts,1)], ' ')
    ELSE NULL
  END
FROM (
  SELECT id, string_to_array(regexp_replace(trim(name), '\s+', ' ', 'g'), ' ') AS parts
  FROM commerce_customers
  WHERE first_name IS NULL
    AND name IS NOT NULL
    AND trim(name) <> ''
) sub
WHERE commerce_customers.id = sub.id;
