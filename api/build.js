const { Readable } = require("node:stream");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("POST only");

  let b = req.body || {};
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const { url, name, short, color, packageId, icon, maskable } = b;

  if (!/^https:\/\/[^\s/]+\/?$/.test(url || "")) return res.status(400).send("Invalid site link");
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(packageId || "")) return res.status(400).send("Invalid package name");
  if (!name || !/^#[0-9a-fA-F]{6}$/.test(color || "")) return res.status(400).send("Invalid name or color");

  const u = new URL(url);
  const site = u.origin;

  const okPng = d => typeof d === "string" && d.length < 3500000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(d);
  let iconUrl = site + "/icon-512.png";
  let maskableIconUrl = site + "/icon-maskable-512.png";

  if (okPng(icon) && okPng(maskable)) {
    const tokenKey = Object.keys(process.env).find(k => k === "BLOB_READ_WRITE_TOKEN" || k.endsWith("_READ_WRITE_TOKEN"));
    const token = tokenKey ? process.env[tokenKey] : "";
    if (!token) {
      const seen = Object.keys(process.env).filter(k => /BLOB|TOKEN/i.test(k)).join(", ") || "none";
      return res.status(500).send("Storage token not found in this deployment. Variables seen: " + seen + ". Connect the Blob store to this project, then redeploy.");
    }
    try {
      const { put } = await import("@vercel/blob");
      const id = Date.now().toString(36);
      const up = async (d, n) => (await put("icons/" + id + "-" + n + ".png", Buffer.from(d.split(",")[1], "base64"), { access: "public", contentType: "image/png", addRandomSuffix: true, token })).url;
      iconUrl = await up(icon, "icon");
      maskableIconUrl = await up(maskable, "maskable");
    } catch (e) {
      return res.status(500).send("Icon upload failed: " + e.message);
    }
  } else {
    for (const f of ["/icon-512.png", "/icon-maskable-512.png"]) {
      try {
        const c = await fetch(site + f);
        if (c.body) c.body.cancel();
        if (!c.ok) return res.status(400).send("Missing " + f + " on " + site);
      } catch (e) {
        return res.status(400).send("Cannot reach " + site + f);
      }
    }
  }

  let hasManifest = false;
  try {
    const m = await fetch(site + "/manifest.webmanifest");
    if (m.body) m.body.cancel();
    hasManifest = m.ok;
  } catch (e) {}

  const options = {
    packageId,
    name,
    launcherName: (short || name).slice(0, 12),
    appVersion: "1.0.0.0",
    appVersionCode: 1,
    host: u.host,
    startUrl: "/",
    fullScopeUrl: site + "/",
    pwaUrl: site + "/",
    webManifestUrl: hasManifest ? site + "/manifest.webmanifest" : undefined,
    iconUrl,
    maskableIconUrl,
    monochromeIconUrl: null,
    themeColor: color,
    navigationColor: color,
    navigationColorDark: color,
    navigationDividerColor: color,
    navigationDividerColorDark: color,
    backgroundColor: "#07090d",
    display: "standalone",
    orientation: "default",
    fallbackType: "customtabs",
    signingMode: "new",
    signing: {
      file: null,
      alias: "key",
      fullName: name,
      organization: name,
      organizationalUnit: "Dev",
      countryCode: "US",
      keyPassword: "",
      storePassword: ""
    },
    enableNotifications: false,
    enableSiteSettingsShortcut: true,
    isChromeOSOnly: false,
    includeSourceCode: false,
    splashScreenFadeOutDuration: 300,
    shortcuts: [],
    additionalTrustedOrigins: [],
    features: { locationDelegation: { enabled: false }, playBilling: { enabled: false } },
    minSdkVersion: 21,
    generator: "pwabuilder"
  };

  try {
    const r = await fetch("https://pwabuilder-cloudapk.azurewebsites.net/generateAppPackage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options)
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(502).send("Build service error " + r.status + ": " + t.slice(0, 300));
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="' + packageId + '.zip"');
    Readable.fromWeb(r.body).pipe(res);
  } catch (e) {
    res.status(500).send("Build failed: " + e.message);
  }
};

module.exports.config = { maxDuration: 300 };
