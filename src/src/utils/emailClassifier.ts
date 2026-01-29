/**
 * Classifies email addresses as generic or personal
 * Generic: info@, contact@, sales@, hello@, etc.
 * Personal: firstname.lastname@, firstname@, etc.
 */
export function classifyEmail(email: string): { isGeneric: boolean; normalized: string } {
  if (!email) {
    throw new Error('Email cannot be empty');
  }

  const normalized = email.toLowerCase().trim();

  // Generic email patterns
  const genericPatterns = [
    /^info@/i,
    /^contact@/i,
    /^sales@/i,
    /^hello@/i,
    /^support@/i,
    /^help@/i,
    /^admin@/i,
    /^webmaster@/i,
    /^noreply@/i,
    /^no-reply@/i,
    /^mail@/i,
    /^office@/i,
    /^general@/i,
    /^enquiries@/i,
    /^inquiry@/i,
    /^service@/i,
    /^services@/i,
    /^team@/i,
    /^marketing@/i,
    /^press@/i,
    /^media@/i,
    /^pr@/i,
    /^hr@/i,
    /^careers@/i,
    /^jobs@/i,
    /^billing@/i,
    /^accounts@/i,
    /^finance@/i,
    /^legal@/i,
    /^abuse@/i,
    /^postmaster@/i
  ];

  const isGeneric = genericPatterns.some(pattern => pattern.test(normalized));

  return {
    isGeneric,
    normalized
  };
}
