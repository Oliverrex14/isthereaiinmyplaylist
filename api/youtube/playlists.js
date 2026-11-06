const requestHandler = require("../../server");

module.exports = async (req, res) => {
  const qs =
    req.url && req.url.includes("?")
      ? req.url.slice(req.url.indexOf("?"))
      : "";
  req.url = `/api/youtube/playlists${qs}`;
  return requestHandler(req, res);
};
