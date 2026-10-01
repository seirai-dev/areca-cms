-- Corrects publication.was_live values written by 0001_cheerful_tusk.
--
-- 0001 backfilled was_live = true for every row with status IN ('live',
-- 'superseded', 'rolled_back') OR deployed_at IS NOT NULL. 'superseded' also
-- covers publications that were queued, coalesced by a newer release and
-- never built or deployed, so those rows wrongly became rollback targets.
-- Since then the worker sets was_live only together with deployed_at, in the
-- transaction that marks the release live (demo releases never set it).
--
-- Conservative rule: clear was_live only when NOTHING shows a deployment:
--   * deployed_at is NULL,
--   * status is not 'live', 'rolled_back' or 'demo',
--   * the publication is not a demo-mode release,
--   * no build_job for it has status 'succeeded'.
-- Caveat: a superseded release deployed by a pre-deployed_at worker that
-- also lost its succeeded job row (e.g. job rows pruned) is indistinguishable
-- from a never-built one and loses rollback eligibility; its content stays
-- reachable through the normal release history. Rows with any evidence are
-- left as they are, so some historic false positives may remain.
UPDATE "publication" p
SET "was_live" = false
WHERE p."was_live" = true
  AND p."deployed_at" IS NULL
  AND p."status" NOT IN ('live', 'rolled_back', 'demo')
  AND p."publishing_mode" <> 'demo'
  AND NOT EXISTS (
    SELECT 1 FROM "build_job" b
    WHERE b."publication_id" = p."id" AND b."status" = 'succeeded'
  );
