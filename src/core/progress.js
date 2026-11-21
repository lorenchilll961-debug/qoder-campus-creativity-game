// Byte-accurate download progress for the load screen: the big fetches stream through here so
// the bar shows real progress through the ~95 MB first load instead of only stage marks.
const files = new Map();   // url -> [got, total]

export const Load = {
  total: 0,
  got: 0,

  frac() { return this.total > 0 ? Math.min(1, this.got / this.total) : 0; },

  /** Progress report for one file (cumulative bytes). */
  file(url, loaded, total) {
    let rec = files.get(url);
    if (!rec) { rec = [0, 0]; files.set(url, rec); }
    const d = loaded - rec[0];
    if (d > 0) { this.got += d; rec[0] = loaded; }
    if (total > rec[1]) { this.total += total - rec[1]; rec[1] = total; }
  },

  /** fetch(), counting bytes when the server says how many there are. */
  async fetch(url, opts) {
    const res = await fetch(url, opts);
    const len = Number(res.headers.get('content-length')) || 0;
    if (!len || !res.body) return res;          // chunked or cached: untracked, still works
    this.file(url, 0, len);
    const chunks = [];
    const reader = res.body.getReader();
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      this.file(url, loaded, len);
    }
    return new Response(new Blob(chunks), { headers: res.headers, status: res.status });
  },
};

/** GLTFLoader/FileLoader progress events, folded into the same counter. */
export function loaderProgress(url) {
  return (e) => { if (e.lengthComputable) Load.file(url, e.loaded, e.total); };
}

/** loadAsync, with byte progress. */
export function loadTracked(loader, url) {
  return loader.loadAsync(url, loaderProgress(url));
}
