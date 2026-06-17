-- Link all existing guardian/student pairs that share the same family_code
-- within the same organization but are not yet in commerce_guardian_students.
INSERT INTO commerce_guardian_students
  (guardian_id, student_id, organization_id, relationship)
SELECT g.id, c.id, g.organization_id, 'guardian'
FROM commerce_guardians  g
JOIN commerce_customers  c
  ON  c.organization_id = g.organization_id
  AND c.family_code     = g.family_code
  AND c.customer_type   = 'student'
  AND c.active          = TRUE
WHERE g.active       = TRUE
  AND g.family_code  IS NOT NULL
  AND g.family_code  <> ''
ON CONFLICT (guardian_id, student_id) DO NOTHING;
