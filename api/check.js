/* Is the site really serving assetlinks.json with this build's key?  GET /api/check?site=https://x.app&pkg=com.a.b&fp=AA:BB,... */
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  const q = req.query || {};
  let u;
  try { u = new URL(String(q.site || "")); } catch (e) { return res.status(400).end(JSON.stringify({ live: false, reason: "bad_site" })); }
  if (u.protocol !== "https:" || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(u.hostname)) return res.status(400).end(JSON.stringify({ live: false, reason: "bad_site" }));
  const pkg = String(q.pkg || "");
  const fps = String(q.fp || "").split(",").map(x => x.trim().toUpperCase()).filter(Boolean).slice(0, 10);
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(pkg) || !fps.length) return res.status(400).end(JSON.stringify({ live: false, reason: "bad_input" }));

  let r;
  try {
    r = await fetch(u.origin + "/.well-known/assetlinks.json?t=" + Date.now(), { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(7000) });
  } catch (e) { return res.end(JSON.stringify({ live: false, reason: "unreachable" })); }
  if (!r.ok) return res.end(JSON.stringify({ live: false, reason: "notfound", status: r.status }));
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { return res.end(JSON.stringify({ live: false, reason: "html" })); }
  const mine = (Array.isArray(data) ? data : []).filter(x => x && x.target && x.target.package_name === pkg);
  const have = mine.flatMap(x => x.target.sha256_cert_fingerprints || []).map(x => String(x).toUpperCase());
  const live = fps.every(f => have.includes(f));
  res.end(JSON.stringify({ live, reason: live ? "ok" : (mine.length ? "old_key" : "no_package") }));
};
