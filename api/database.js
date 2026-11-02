const requestHandler = require("../server");

module.exports = async (req, res) => {
  req.url = "/api/database";
  return requestHandler(req, res);
};
