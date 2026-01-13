"use strict";

const express = require("express");
const {
  handleOcrJson,
  handleOcrQuality,
  handleOcrHalfJson,
  handleOcrLeftJson,
  handleOcrRightJson,
  handleOcrJsonCrop,
} = require("../controllers/ocrController");

const router = express.Router();

router.post("/json", handleOcrJson);
router.post("/quality", handleOcrQuality);
router.post("/half/json", handleOcrHalfJson);
router.post("/left/json", handleOcrLeftJson);
router.post("/right/json", handleOcrRightJson);
router.post("/json/crop", handleOcrJsonCrop);

module.exports = router;
