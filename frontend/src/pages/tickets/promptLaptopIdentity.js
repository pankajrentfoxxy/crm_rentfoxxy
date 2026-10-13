/**
 * Every floor assignment verifies the laptop: its full TTSPL ID and serial,
 * typed or scanned from the laptop, matched exactly on the server.
 * @returns {{ ttspl_id: string, serial_number?: string } | null} null if cancelled
 */
export default function promptLaptopIdentity() {
  const ttspl = (window.prompt("Type the laptop's full TTSPL ID (from its label):") || '').trim();
  if (!ttspl) return null;
  const serial = (window.prompt("Type the laptop's full Serial number (leave empty only if it will not power on):") ?? '').trim();
  return serial ? { ttspl_id: ttspl, serial_number: serial } : { ttspl_id: ttspl };
}
