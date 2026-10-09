const URL_RE = /^https:\/\/[A-Za-z0-9._~:\/?#@!$&()*+,;=%-]+$/;
const PKG_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.GH_TOKEN || !process.env.BUILDER_REPO) return res.status(500).json({ error: "Server not configured" });

  const { url, name, pkg, icon } = req.body || {};
  if (typeof url !== "string" || url.length > 300 || !URL_RE.test(url)) return res.status(400).json({ error: "Invalid https link" });
  if (typeof name !== "string" || !name.trim() || name.length > 40) return res.status(400).json({ error: "Invalid app name" });
  if (typeof pkg !== "string" || pkg.length > 80 || !PKG_RE.test(pkg)) return res.status(400).json({ error: "Invalid package name" });
  const ic = typeof icon === "string" ? icon : "";
  if (ic.length > 60000 || !/^[A-Za-z0-9+\/=]*$/.test(ic)) return res.status(400).json({ error: "Invalid icon" });

  const id = require("crypto").randomBytes(5).toString("hex");
  const r = await fetch("https://api.github.com/repos/" + process.env.BUILDER_REPO + "/actions/workflows/build.yml/dispatches", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.GH_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "kairo-code",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ref: "main", inputs: { id, url, name: name.trim(), pkg, icon: ic } })
  });
  if (r.status !== 204) return res.status(502).json({ error: "Could not start build (" + r.status + ")" });
  res.status(200).json({ id });
};
