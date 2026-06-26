/**
 * Telegram allowlist gate.
 *
 * Walking-skeleton slice: the allowlist is intentionally stubbed open — every
 * sender is permitted. Real per-user / per-chat enforcement (mirroring the
 * discord/slack allowlist matchers) lands in a later slice. The signature is
 * kept stable so callers don't change when enforcement arrives.
 */
export function isSenderAllowed(_userId: number | undefined): boolean {
  return true;
}
