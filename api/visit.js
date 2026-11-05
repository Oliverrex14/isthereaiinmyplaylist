const requestHandler = require("../server");

module.exports = async (req, res) => {
  req.url = "/api/visit";
  return requestHandler(req, res);
};
