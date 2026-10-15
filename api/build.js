const { Readable } = require("node:stream");
const zlib = require("node:zlib");
const { gh } = require("./_gh");

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

/* ---- put assetlinks.json in the right folder(s) of the site's GitHub repo ----
   plain sites serve  .well-known/assetlinks.json  from the repo root.
   Vite / Next / React / Astro / Nuxt / Svelte sites only serve what is inside  public/  (or  static/ ),
   so for those the file is added there too. */
const exists = async (repo, p) => {
  const r = await gh("/repos/" + repo + "/contents/" + p);
  if (r.body) r.body.cancel().catch(() => {});
  return r.ok;
};

async function putOne(repo, path, pkg, newText) {
  const api = "/repos/" + repo + "/contents/" + path;
  let sha, list = [], old = [];
  const cur = await gh(api);
  if (cur.ok) {
    const j = await cur.json();
    sha = j.sha;
    try {
      const arr = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
      if (Array.isArray(arr)) {
        list = arr.filter(x => !(x && x.target && x.target.package_name === pkg));
        /* keep fingerprints of earlier builds of the same app (each build makes a new key) */
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
      m.target.sha256_cert_fingerprints = Array.from(new Set((m.target.sha256_cert_fingerprints || []).concat(old))).slice(-10);
    }
  });
  const body = { message: "Add app verification file (Kairo Code)", content: Buffer.from(JSON.stringify(list.concat(mine), null, 2)).toString("base64") };
  if (sha) body.sha = sha;
  const put = await gh(api, { method: "PUT", body: JSON.stringify(body) });
  return put.ok ? { ok: true } : { ok: false, note: "GitHub refused the file (" + put.status + "). The token needs write access to " + repo };
}

async function pushAssetlinks(repoInput, pkg, newText) {
  let repo = String(repoInput || "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "").replace(/\.git$/, "");
  if (!/^[\w.-]+(\/[\w.-]+)?$/.test(repo)) return { ok: false, note: "Invalid GitHub repo" };
  if (!process.env.GH_TOKEN) return { ok: false, note: "GH_TOKEN is not set in Vercel" };
  if (!repo.includes("/")) {
    const u = await gh("/user");
    if (!u.ok) return { ok: false, note: "GH_TOKEN is not valid" };
    repo = (await u.json()).login + "/" + repo;
  }
  const info = await gh("/repos/" + repo);
  if (!info.ok) return { ok: false, note: "Cannot open " + repo + " (" + info.status + "). Check the repo name and that the token can write to it" };
  if (info.body) await info.json().catch(() => {});

  /* which folders does this site serve? */
  const [hasPublic, hasStatic, pj] = await Promise.all([
    exists(repo, "public"), exists(repo, "static"),
    gh("/repos/" + repo + "/contents/package.json").then(async r => r.ok ? Buffer.from((await r.json()).content || "", "base64").toString("utf8") : "").catch(() => "")
  ]);
  const framework = /"(vite|next|react-scripts|astro|nuxt|gatsby|@sveltejs\/kit|@remix-run\/[\w-]+|vue-cli-service|@vue\/cli-service)"/.test(pj);
  const svelteKit = /"@sveltejs\/kit"/.test(pj);

  const targets = [".well-known/assetlinks.json"];
  if (hasPublic || framework) targets.push("public/.well-known/assetlinks.json");
  if (svelteKit || (hasStatic && framework)) targets.push("static/.well-known/assetlinks.json");

  const done = [];
  for (const t of targets) {
    const r = await putOne(repo, t, pkg, newText);
    if (!r.ok) return r;
    done.push(t);
  }
  return { ok: true, note: repo + " (" + done.join(", ") + ")" };
}

async function main(req, res) {
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
  const checkManifest = (async () => {
    try {
      const m = await fetch(site + "/manifest.webmanifest", { signal: AbortSignal.timeout(4000) });
      if (m.body) m.body.cancel();
      if (m.ok) manifestUrl = site + "/manifest.webmanifest";
    } catch (e) {}
  })();

  try {
    const { put } = await import("@vercel/blob");
    const stamp = Date.now().toString(36);
    const opt = ct => ({ access: "public", contentType: ct, addRandomSuffix: true, ...(token ? { token } : {}) });
    const up = async (d, n) => (await put("icons/" + stamp + "-" + n + ".png", Buffer.from(d.split(",")[1], "base64"), opt("image/png"))).url;
    [iconUrl, maskableIconUrl] = await Promise.all([up(icon, "icon"), up(maskable, "maskable")]);
    await checkManifest;
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
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options),
      signal: AbortSignal.timeout(200000)
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
  /* no waiting here: Vercel needs about a minute to deploy the file, the app screen tells the user to wait */
  let live = "no";
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


module.exports = async function handler(req, res) {
  try { await main(req, res); }
  catch (e) { if (!res.headersSent) res.status(500).send("Server error: " + (e && e.message ? e.message : e)); else res.end(); }
};

module.exports.config = { maxDuration: 300 };
