const requestHandler = require("../server");

module.exports = async (req, res) => {
  req.url = "/api/unflag";
  return requestHandler(req, res);
};
