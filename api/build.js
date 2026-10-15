const { Readable } = require("node:stream");
const zlib = require("node:zlib");
const { gh } = require("./_gh");

module.exports.config = { maxDuration: 300 };

/* read one file out of a zip held in memory */
function zipFind(buf, suffix) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) return null;
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    if (name.toLowerCase().endsWith(suffix)) {
      const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
      const data = buf.subarray(start, start + csize);
      return (method === 0 ? data : zlib.inflateRawSync(data)).toString("utf8");
    }
    p += 46 + nl + el + cl;
  }
  return null;
}

/* add or update .well-known/assetlinks.json in the site's GitHub repo */
async function pushAssetlinks(repoInput, pkg, newText) {
  let repo = String(repoInput || "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  if (!/^[\w.-]+(\/[\w.-]+)?$/.test(repo)) return { ok: false, note: "Invalid GitHub repo" };
  if (!process.env.GH_TOKEN) return { ok: false, note: "GH_TOKEN is not set in Vercel" };
  if (!repo.includes("/")) {
    const u = await gh("/user");
    if (!u.ok) return { ok: false, note: "GH_TOKEN is not valid" };
    repo = (await u.json()).login + "/" + repo;
  }
  const path = "/repos/" + repo + "/contents/.well-known/assetlinks.json";
  let sha, list = [], old = [];
  const cur = await gh(path);
  if (cur.ok) {
    const j = await cur.json();
    sha = j.sha;
    try {
      const arr = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
      if (Array.isArray(arr)) {
        list = arr.filter(x => !(x && x.target && x.target.package_name === pkg));
        /* keep the fingerprints of earlier builds of the same app: every build makes a new signing key,
           and replacing the old one would bring the address bar back on apps installed from older builds */
        arr.forEach(x => {
          if (x && x.target && x.target.package_name === pkg && Array.isArray(x.target.sha256_cert_fingerprints)) old.push(...x.target.sha256_cert_fingerprints);
        });
      }
    } catch (e) {}
  } else if (cur.status !== 404) {
    return { ok: false, note: "Cannot open " + repo + " (" + cur.status + ")" };
  }
  let mine = [];
  try { mine = JSON.parse(newText); } catch (e) { return { ok: false, note: "assetlinks.json is not valid" }; }
  mine.forEach(m => {
    if (m && m.target && m.target.package_name === pkg) {
      const all = Array.from(new Set((m.target.sha256_cert_fingerprints || []).concat(old)));
      m.target.sha256_cert_fingerprints = all.slice(-10);
    }
  });
  const body = { message: "Add app verification file (Kairo Code)", content: Buffer.from(JSON.stringify(list.concat(mine), null, 2)).toString("base64") };
  if (sha) body.sha = sha;
  const put = await gh(path, { method: "PUT", body: JSON.stringify(body) });
  return put.ok ? { ok: true, note: repo } : { ok: false, note: "GitHub refused the file (" + put.status + "). The token needs write access to " + repo };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("POST only");

  let b = req.body || {};
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const { url, name, short, color, packageId, icon, maskable } = b;
  const repo = b.repo || process.env.SITE_REPO || "";

  if (!/^https:\/\/[^\s/]+\/?$/.test(url || "")) return res.status(400).send("Invalid site link");
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(packageId || "")) return res.status(400).send("Invalid package name");
  if (!/^#[0-9a-fA-F]{6}$/.test(color || "")) return res.status(400).send("Invalid color");
  const okPng = d => typeof d === "string" && d.length < 3500000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(d);
  if (!okPng(icon) || !okPng(maskable)) return res.status(400).send("Icon missing or too large");

  const appName = String(name || "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 30) || "App";
  const u = new URL(url);
  const site = u.origin;

  /* host icons + a manifest on Blob (PWABuilder downloads them by link) */
  const tokenKey = Object.keys(process.env).find(k => k === "BLOB_READ_WRITE_TOKEN" || k.endsWith("_READ_WRITE_TOKEN"));
  const token = tokenKey ? process.env[tokenKey] : "";
  if (!token && !process.env.BLOB_STORE_ID) return res.status(500).send("Blob storage is not connected to this Vercel project.");

  let iconUrl, maskableIconUrl, manifestUrl = "";
  try {
    const m = await fetch(site + "/manifest.webmanifest");
    if (m.body) m.body.cancel();
    if (m.ok) manifestUrl = site + "/manifest.webmanifest";
  } catch (e) {}

  try {
    const { put } = await import("@vercel/blob");
    const stamp = Date.now().toString(36);
    const opt = ct => ({ access: "public", contentType: ct, addRandomSuffix: true, ...(token ? { token } : {}) });
    const up = async (d, n) => (await put("icons/" + stamp + "-" + n + ".png", Buffer.from(d.split(",")[1], "base64"), opt("image/png"))).url;
    iconUrl = await up(icon, "icon");
    maskableIconUrl = await up(maskable, "maskable");
    if (!manifestUrl) {
      const manifest = {
        name: appName, short_name: (short || appName).slice(0, 12),
        start_url: site + "/", scope: site + "/", display: "standalone",
        background_color: "#07090d", theme_color: color,
        icons: [
          { src: iconUrl, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: maskableIconUrl, sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      };
      manifestUrl = (await put("manifests/" + stamp + ".webmanifest", JSON.stringify(manifest), opt("application/manifest+json"))).url;
    }
  } catch (e) {
    return res.status(500).send("Upload failed: " + e.message);
  }

  const options = {
    packageId, name: appName, launcherName: (short || appName).slice(0, 12),
    appVersion: "1.0.0.0", appVersionCode: 1,
    host: u.host, startUrl: "/", fullScopeUrl: site + "/", pwaUrl: site + "/",
    webManifestUrl: manifestUrl, iconUrl, maskableIconUrl, monochromeIconUrl: null,
    themeColor: color, navigationColor: "#07090d", navigationColorDark: "#07090d",
    navigationDividerColor: "#07090d", navigationDividerColorDark: "#07090d",
    backgroundColor: "#07090d", display: "standalone", orientation: "default",
    fallbackType: "customtabs", signingMode: "new",
    signing: { file: null, alias: "key", fullName: appName, organization: appName, organizationalUnit: "Dev", countryCode: "US", keyPassword: "", storePassword: "" },
    enableNotifications: false, enableSiteSettingsShortcut: false, isChromeOSOnly: false, includeSourceCode: false,
    splashScreenFadeOutDuration: 100, shortcuts: [], additionalTrustedOrigins: [],
    features: { locationDelegation: { enabled: false }, playBilling: { enabled: false } },
    minSdkVersion: 21, generator: "pwabuilder"
  };

  let zip;
  try {
    const r = await fetch("https://pwabuilder-cloudapk.azurewebsites.net/generateAppPackage", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options)
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).send("Build service error " + r.status + ": " + t.slice(0, 300));
    }
    zip = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    return res.status(500).send("Build failed: " + e.message);
  }

  /* the verification file that removes the address bar */
  let links = null;
  try { links = zipFind(zip, "assetlinks.json"); } catch (e) {}
  let status = "manual", note = "";
  if (links && repo) {
    try {
      const p = await pushAssetlinks(repo, packageId, links);
      if (p.ok) { status = "pushed"; note = p.note; } else { note = p.note; }
    } catch (e) { note = e.message; }
  }
  /* check that the site really serves the file with this build's key (the address bar only goes away if it does) */
  let live = "no";
  if (links) {
    let want = [];
    try { want = JSON.parse(links).flatMap(x => (x.target && x.target.package_name === packageId && x.target.sha256_cert_fingerprints) || []); } catch (e) {}
    const until = Date.now() + (status === "pushed" ? 100000 : 8000);
    while (want.length) {
      try {
        const r = await fetch(site + "/.well-known/assetlinks.json?t=" + Date.now(), { cache: "no-store", redirect: "follow" });
        if (r.ok) {
          const t = await r.text();
          if (want.every(f => t.includes(f)) && t.includes(packageId)) { live = "yes"; break; }
        }
      } catch (e) {}
      if (Date.now() > until) break;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  res.setHeader("X-Links-Live", live);
  if (links) res.setHeader("X-Assetlinks", Buffer.from(links).toString("base64"));
  res.setHeader("X-Links-Status", status);
  res.setHeader("X-Links-Note", encodeURIComponent(note));
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="' + packageId + '.zip"');

  const chunks = [];
  for (let i = 0; i < zip.length; i += 262144) chunks.push(zip.subarray(i, i + 262144));
  Readable.from(chunks).pipe(res);
};

module.exports.config = { maxDuration: 300 };
