const { findRun } = require("./_gh");

module.exports = async (req, res) => {
  const id = String(req.query.id || "");
  if (!/^[a-z0-9]{6,20}$/.test(id)) return res.status(400).json({ error: "Bad id" });
  try {
    const run = await findRun(id);
    if (!run) return res.json({ status: "queued" });
    if (run.status !== "completed") return res.json({ status: "building" });
    if (run.conclusion !== "success") return res.json({ status: "failed" });
    res.json({ status: "done", downloadUrl: `/api/download?id=${id}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
