import multer from "multer";

// store file in memory as buffer (req.file.buffer me milegi)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // max 10 MB
});

export default upload;
