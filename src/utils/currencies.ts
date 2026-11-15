/**
 * Supported display currencies: every ISO 4217 code the runtime's ICU data knows (about 160),
 * so anything the formatter can show is accepted and nothing else is.
 */
const SUPPORTED = new Set(Intl.supportedValuesOf("currency"));

export function isSupportedCurrency(code: string): boolean {
  return SUPPORTED.has(code);
}
