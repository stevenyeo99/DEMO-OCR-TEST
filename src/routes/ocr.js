"use strict";

const express = require("express");
const { handleOcrJson, handleOcrJsonCrop } = require("../controllers/ocrController");

const router = express.Router();

router.post("/json", handleOcrJson);
router.post("/json/crop", handleOcrJsonCrop);

module.exports = router;
