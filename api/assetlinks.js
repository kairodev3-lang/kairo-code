const { getArtifactZip } = require("./_gh");

module.exports = async (req, res) => {
  const id = String(req.query.id || "");
  if (!/^[a-z0-9]{6,20}$/.test(id)) return res.status(400).send("Bad id");
  try {
    const r = await getArtifactZip(id);
    if (!r) return res.status(404).send("Build not found");
    const e = r.zip.getEntries().find(x => x.entryName.endsWith("assetlinks.json"));
    if (!e) return res.status(404).send("No assetlinks in this build");
    res.setHeader("Content-Type", "application/json");
    res.send(e.getData().toString("utf8"));
  } catch (e) {
    res.status(500).send(e.message);
  }
};
