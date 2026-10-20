module.exports = async (req, res) => {
  const { url, pkg, fp } = req.query;
  let u;
  try { u = new URL(String(url)); } catch (e) { return res.status(400).json({ ok: false, reason: "Bad link" }); }
  const h = u.hostname;
  if (u.protocol !== "https:" || !h.includes(".") || /^[\d.]+$/.test(h) || h === "localhost")
    return res.status(400).json({ ok: false, reason: "Bad link" });
  try {
    const r = await fetch(u.origin + "/.well-known/assetlinks.json", {
      redirect: "follow",
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return res.json({ ok: false, reason: `File not found on your site (HTTP ${r.status})` });
    const j = await r.json();
    const want = String(fp).toUpperCase();
    const ok = Array.isArray(j) && j.some(x =>
      x.target && x.target.package_name === pkg &&
      (x.target.sha256_cert_fingerprints || []).map(s => String(s).toUpperCase()).includes(want));
    res.json({ ok, reason: ok ? "Verified" : "File found, but package name or fingerprint does not match" });
  } catch (e) {
    res.json({ ok: false, reason: "Could not read the file from your site" });
  }
};
