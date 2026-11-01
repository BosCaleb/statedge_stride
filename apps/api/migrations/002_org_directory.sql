-- Migration 002: the organisation list for the daily retention sweep (docs/decisions.md D111).
--
-- The sweep runs once per organisation inside withOrg, so it first needs the list of
-- organisations, which row-level security hides from a connection with no organisation in
-- context. A third session-context key, org_directory, admits reading stride.organisations
-- only: every other table still filters on org_id, and the new block predicates stop the
-- directory context changing or deleting an organisation. Without the key, nothing changes:
-- the predicate still fails closed.

CREATE FUNCTION security.fn_org_read_predicate(@id UNIQUEIDENTIFIER)
RETURNS TABLE WITH SCHEMABINDING AS
  RETURN SELECT 1 AS allowed
  WHERE @id = TRY_CAST(SESSION_CONTEXT(N'org_id') AS UNIQUEIDENTIFIER)
     OR TRY_CAST(SESSION_CONTEXT(N'org_directory') AS BIT) = 1;
GO

ALTER SECURITY POLICY security.org_isolation
  ALTER FILTER PREDICATE security.fn_org_read_predicate(id) ON stride.organisations,
  ADD BLOCK PREDICATE security.fn_org_predicate(id) ON stride.organisations BEFORE UPDATE,
  ADD BLOCK PREDICATE security.fn_org_predicate(id) ON stride.organisations BEFORE DELETE;
GO
