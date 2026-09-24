// The app starts in one-world mode (The Range, no picker). The smoke tools
// that exercise the world picker or the other worlds open it with every
// world registered, which is what `?worlds=all` does (src/main.js).
export function withAllWorlds(url) {
  const u = new URL(url);
  u.searchParams.set('worlds', 'all');
  return u.href;
}
