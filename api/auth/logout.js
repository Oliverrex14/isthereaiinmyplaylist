const requestHandler = require("../../server");

module.exports = async (req, res) => {
  req.url = "/api/auth/logout";
  return requestHandler(req, res);
};
