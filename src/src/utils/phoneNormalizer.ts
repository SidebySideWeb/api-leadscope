/**
 * Normalizes Greek phone numbers to +30 format
 * Handles:
 * - Greek landlines: 210, 211, 2310, etc.
 * - Greek mobiles: 69xxxxxxxx
 */
export function normalizePhone(phone: string): { normalized: string; isMobile: boolean } | null {
  if (!phone) return null;

  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Remove leading + if present
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }

  // Remove leading 00
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }

  // If starts with 30 (country code), remove it
  if (cleaned.startsWith('30')) {
    cleaned = cleaned.substring(2);
  }

  // Remove leading 0 if present
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  // Validate Greek mobile (69xxxxxxxx - 10 digits starting with 69)
  if (cleaned.length === 10 && cleaned.startsWith('69')) {
    return {
      normalized: `+30${cleaned}`,
      isMobile: true
    };
  }

  // Validate Greek landline (2-4 digit area code + 6-8 digit number)
  // Common area codes: 210, 211, 2310, 231, 241, etc.
  if (cleaned.length >= 8 && cleaned.length <= 12) {
    // Check if it starts with known area codes
    const areaCodes = ['210', '211', '212', '213', '214', '215', '216', '217', '218', '219',
                       '231', '232', '233', '234', '235', '236', '237', '238', '239',
                       '241', '242', '243', '244', '245', '246', '247', '248', '249',
                       '251', '252', '253', '254', '255', '259',
                       '261', '262', '263', '264', '265', '266', '267', '268', '269',
                       '271', '272', '273', '274', '275', '276', '277', '278', '279',
                       '281', '282', '283', '2841', '2842', '2843', '2844', '2845', '2846', '2847', '2848', '2849',
                       '2891', '2892', '2893', '2894', '2895', '2897'];
    
    for (const code of areaCodes) {
      if (cleaned.startsWith(code)) {
        return {
          normalized: `+30${cleaned}`,
          isMobile: false
        };
      }
    }
  }

  return null;
}
