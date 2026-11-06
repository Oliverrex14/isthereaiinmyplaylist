const requestHandler = require("../../server");

module.exports = async (req, res) => {
  req.url = "/api/spotify/clean-playlist";
  return requestHandler(req, res);
};
