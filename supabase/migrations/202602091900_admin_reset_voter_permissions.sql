CREATE OR REPLACE FUNCTION public.admin_reset_voter_for_election(
  p_election_id uuid,
  p_voter_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
begin
  -- Enable bypass only inside this transaction
  perform set_config('app.bypass_final_vote_lock', 'on', true);

  delete from public.votes
  where election_id = p_election_id
    and voter_id = p_voter_id;

  delete from public.voter_election_status
  where election_id = p_election_id
    and voter_id = p_voter_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.admin_reset_voter_for_election(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_voter_for_election(uuid, uuid) TO service_role;
