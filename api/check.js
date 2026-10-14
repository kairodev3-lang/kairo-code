module.exports = async function handler(req, res) {
  const q = req.query || {};
  const url = q.url || "";
  const pkg = q.pkg || "";

  if (!/^https:\/\/[^\s/]+\/?$/.test(url)) return res.status(400).json({ ok: false, msg: "Invalid site link" });
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(pkg)) return res.status(400).json({ ok: false, msg: "Invalid package name" });

  const site = new URL(url).origin;
  try {
    const r = await fetch(site + "/.well-known/assetlinks.json", { redirect: "follow" });
    if (!r.ok) return res.json({ ok: false, msg: "File not found on your site (HTTP " + r.status + "). Upload it to .well-known/assetlinks.json and wait for the deploy." });
    const j = await r.json();
    const found = Array.isArray(j) && j.some(x => x && x.target && x.target.package_name === pkg &&
      Array.isArray(x.target.sha256_cert_fingerprints) && x.target.sha256_cert_fingerprints.length > 0);
    return res.json(found
      ? { ok: true, msg: "Verified. Uninstall the app and install it again: the address bar will be gone." }
      : { ok: false, msg: "The file exists but does not contain the package " + pkg + ". Upload the file from your latest build." });
  } catch (e) {
    return res.json({ ok: false, msg: "Could not read the file: " + e.message });
  }
};
