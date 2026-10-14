const { Readable } = require("node:stream");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("POST only");

  let b = req.body || {};
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const { url, name, short, color, packageId } = b;

  if (!/^https:\/\/[^\s/]+\/?$/.test(url || "")) return res.status(400).send("Invalid site link");
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(packageId || "")) return res.status(400).send("Invalid package name");
  if (!name || !/^#[0-9a-fA-F]{6}$/.test(color || "")) return res.status(400).send("Invalid name or color");

  const u = new URL(url);
  const site = u.origin;

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
    webManifestUrl: site + "/manifest.webmanifest",
    iconUrl: site + "/icon-512.png",
    maskableIconUrl: site + "/icon-maskable-512.png",
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
