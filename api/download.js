const AdmZip = require("adm-zip");
const { H, gh, findRun } = require("./_gh");

const WINDOW_MS = 100 * 1000; // 90s window + small grace

module.exports = async (req, res) => {
  const id = String(req.query.id || "");
  if (!/^[a-z0-9]{6,20}$/.test(id)) return res.status(400).send("Bad id");
  try {
    const run = await findRun(id);
    if (!run || run.conclusion !== "success") return res.status(404).send("Build not found");
    if (Date.now() - new Date(run.updated_at).getTime() > WINDOW_MS) return res.status(410).send("Link expired");

    const a = await (await gh(`/actions/runs/${run.id}/artifacts`)).json();
    const art = (a.artifacts || []).find(x => x.name === "apk-" + id);
    if (!art) return res.status(404).send("Artifact not found");

    // GitHub answers with a redirect to a signed URL
    const z = await fetch(art.archive_download_url, { headers: H, redirect: "manual" });
    const loc = z.headers.get("location");
    if (!loc) return res.status(502).send("Could not get artifact");
    const buf = Buffer.from(await (await fetch(loc)).arrayBuffer());

    const entry = new AdmZip(buf).getEntries().find(e => e.entryName.endsWith(".apk"));
    if (!entry) return res.status(500).send("APK not found in artifact");

    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", 'attachment; filename="app.apk"');
    res.send(entry.getData());
  } catch (e) {
    res.status(500).send(e.message);
  }
};
