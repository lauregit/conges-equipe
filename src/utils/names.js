// Comparaison de noms tolérante : les noms viennent de sources différentes
// (RH Compliance, profils Firestore, anciens congés) avec des casses et
// accents variables. On normalise pour comparer sans se tromper de personne.

export function normName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les accents
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

export function sameName(a, b) {
  return normName(a) === normName(b)
}

// Retrouve une ligne du roster par nom (comparaison normalisée).
export function findByName(roster, name) {
  const n = normName(name)
  return roster.find(r => normName(r.name) === n) || null
}
