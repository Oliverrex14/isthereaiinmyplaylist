const requestHandler = require("../server");

module.exports = async (req, res) => {
  req.url = "/api/analyze";
  return requestHandler(req, res);
};
