// Server copy of the application's disqualification rules (assets/js/app.js dqReason); keep in sync.
// /api/lead re-runs these so an old or tampered page can't mark a lead qualified.

const MIN_AGE = 21;

const OCCUPATION_DQ = [
  ['on_benefits', /\bdisabled\b|\bon disability\b|\bdisability (benefits|pension|payments?)\b|\bss(i|di)\b|\bon benefits\b|\bwelfare\b|\bcan'?t work\b|\bunable to work\b/],
  ['unemployed', /\bunemploy|\bjobless\b|\bno (job|work|income)\b|\bnot (currently )?working\b|\bout of work\b|\bbetween jobs\b|\blooking for (a )?(job|work)\b|\bjob ?hunting\b|^(none|nothing|n\/?a|no|-+)\.?$/],
  ['student', /\bstudent\b/]
];

export function occupationDq(text) {
  const t = String(text || '').toLowerCase().trim();
  for (const [reason, re] of OCCUPATION_DQ) if (re.test(t)) return reason;
  return null;
}

export function dqReason(answers = {}) {
  if (answers.invest?.code === 'not-investing') return 'not_investing';
  if (answers.age && +answers.age < MIN_AGE) return 'under_min_age';
  return occupationDq(answers.occupation);
}
