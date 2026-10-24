// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, test button), en and fr.
// -----------------------------------------------------------------------------

/** "2026-10-20T18:00:00Z" -> "18:00 UTC". */
export const utcTime = (ms) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

/** Why the Tilt Pi or a Tilt has no fresh value. */
export const REASONS = {
  failed: { en: 'no answer', fr: 'pas de réponse' },
  limited: { en: 'too many requests (pause)', fr: 'trop de requêtes (pause)' },
  busy: { en: 'Tilt Pi unavailable (pause)', fr: 'Tilt Pi indisponible (pause)' },
  denied: { en: 'access refused (401/403)', fr: 'accès refusé (401/403)' },
  notfound: {
    en: 'no Tilt Pi at this address (404)',
    fr: 'pas de Tilt Pi à cette adresse (404)',
  },
  invalid: { en: 'not a Tilt Pi answer', fr: "réponse qui n'est pas celle d'un Tilt Pi" },
  stale: { en: 'no recent reading', fr: 'pas de mesure récente' },
  twice: { en: 'two Tilts of this colour', fr: 'deux Tilt de cette couleur' },
};

export const reason = (kind) => REASONS[kind] ?? REASONS.failed;

export const T = {
  notConfigured: {
    en: 'Enter the address of your Tilt Pi (for example 192.168.1.30).',
    fr: "Saisissez l'adresse de votre Tilt Pi (par exemple 192.168.1.30).",
  },
  invalid: {
    en: 'Address not valid: give an IP address or a host name, with a port if it is not 1880 (http only, no path).',
    fr: "Adresse non valide : donnez une adresse IP ou un nom d'hôte, avec un port s'il n'est pas 1880 (http seulement, sans chemin).",
  },
  others: (n) => ({
    en: `${n} other entry(ies) of the Tilt Pi not read (unknown colour).`,
    fr: `${n} autre(s) entrée(s) du Tilt Pi non lue(s) (couleur inconnue).`,
  }),
  outOfRange: (names) => ({
    en: `Value out of range, not published: ${names}.`,
    fr: `Valeur hors bornes, non publiée : ${names}.`,
  }),
  nextRead: (at) => ({
    en: `next read possible at ${utcTime(at)}`,
    fr: `prochaine lecture possible à ${utcTime(at)}`,
  }),
  pausedUntil: (until) => ({
    en: `paused until ${utcTime(until)}`,
    fr: `en pause jusqu'à ${utcTime(until)}`,
  }),
  /** The connected status: what is read, how often, and what fails. */
  ok: ({ tilts, interval, failing = [] }) => {
    let en = `${tilts} Tilt(s) on the Tilt Pi, read every ${interval} min.`;
    let fr = `${tilts} Tilt sur le Tilt Pi, lu(s) toutes les ${interval} min.`;
    if (failing.length > 0) {
      en += ` Without value: ${failing.map((f) => `${f.name} (${reason(f.kind).en})`).join(', ')}.`;
      fr += ` Sans valeur : ${failing.map((f) => `${f.name} (${reason(f.kind).fr})`).join(', ')}.`;
    }
    return { en, fr };
  },
};
