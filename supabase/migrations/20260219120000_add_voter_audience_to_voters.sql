-- Add voter_audience to voters for deterministic eligibility gating
-- Default is 'students' to preserve current behavior for existing records.

BEGIN;

ALTER TABLE public.voters
  ADD COLUMN IF NOT EXISTS voter_audience text NOT NULL DEFAULT 'students';

-- Enforce allowed values (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'voters_voter_audience_chk'
  ) THEN
    ALTER TABLE public.voters
      ADD CONSTRAINT voters_voter_audience_chk
      CHECK (voter_audience IN ('students','employees'));
  END IF;
END $$;

-- One-time backfill: mark employees based on employee_registry email match
UPDATE public.voters v
SET voter_audience = 'employees'
FROM public.employee_registry e
WHERE lower(trim(v.email)) = lower(trim(e.email));

-- Optional: index to speed audience filtering
CREATE INDEX IF NOT EXISTS voters_voter_audience_idx ON public.voters (voter_audience);

COMMIT;
