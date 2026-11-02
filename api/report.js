const requestHandler = require("../server");

module.exports = async (req, res) => {
  req.url = "/api/report";
  return requestHandler(req, res);
};
