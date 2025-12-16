"use strict";

const express = require("express");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const ocrRouter = require("./routes/ocr");

const app = express();

app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (_req, res) => {
  res.json({ message: "API server is running" });
});

app.use("/ocr", ocrRouter);

module.exports = app;
