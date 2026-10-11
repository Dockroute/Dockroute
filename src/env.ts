/**
 * Treats a blank env value as unset. Portainer, Unraid and app-store templates
 * submit a cleared optional field as an empty string, and that has to mean the
 * default, never a fatal error or an empty identity. Non-blank values are
 * returned untouched.
 */
export function nonBlank(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}
