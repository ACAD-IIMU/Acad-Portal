// app/sr-elections/voteTable.ts
//
// Votes live in a separate physical table per term (sr_votes_term_v,
// sr_votes_term_iv, ...) rather than one shared table with a term column —
// see the SQL the user runs in Supabase to create a new one each term.

export function voteTableForTerm(term: string): string {
  return `sr_votes_${term.toLowerCase().replace(/\s+/g, '_')}`;
}
