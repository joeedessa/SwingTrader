/* localStorage that is allowed to be missing: private mode and blocked storage read as no storage at all, and every
   reader and writer built on it treats that as empty rather than throwing. */
export function localKV(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
