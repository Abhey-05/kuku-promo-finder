// Prebuild guard: Vite inlines any VITE_* variable into the browser bundle, so a key-like
// VITE_ variable would ship the key to every visitor. Fail the build if one is set.
export function viteKeyVars(env) {
  return Object.keys(env).filter((k) => /^VITE_/i.test(k) && /KEY|TOKEN|SECRET/i.test(k) && env[k]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bad = viteKeyVars(process.env);
  if (bad.length) {
    console.error(`Build stopped: ${bad.join(', ')} is set. A VITE_ variable is copied into the public bundle. Keys are pasted into Settings at runtime instead.`);
    process.exit(1);
  }
}
