/**
 * UI text helper: `t('LEVEL {n}', { n: 5 })` fills the `{name}` holes. The game's text is
 * English; keeping every UI string behind this one function leaves room to add languages
 * later without touching the components again.
 */
export function t(text, vars) {
  let out = text
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
  return out
}
