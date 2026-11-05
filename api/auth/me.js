const requestHandler = require("../../server");

module.exports = async (req, res) => {
  req.url = req.url ? req.url.replace(/^\/api\/auth\/me/, "/api/auth/me") : "/api/auth/me";
  return requestHandler(req, res);
};
