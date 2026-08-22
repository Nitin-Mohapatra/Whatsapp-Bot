const express = require("express");

const { testAI } = require("../controllers/ai.controller");

const router = express.Router();

router.post("/test", testAI);

module.exports = router;