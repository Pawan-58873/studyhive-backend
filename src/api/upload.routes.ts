import express from 'express';
import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.ts';

const router = express.Router();

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'StudyHiveUploads',
        allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'pdf', 'mp4'],
        resource_type: 'auto', // Auto-detect resource type (image, video, raw)
    } as any,
});

const parser = multer({ storage: storage });

// Single file upload
router.post('/', parser.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }

    res.json({
        message: 'File uploaded successfully',
        url: req.file.path,
        filename: req.file.filename,
        mimetype: req.file.mimetype,
        size: req.file.size
    });
});

// Multiple files upload
router.post('/multiple', parser.array('files', 10), (req, res) => {
    if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
        return res.status(400).json({ message: 'No files uploaded' });
    }

    const files = req.files as Express.Multer.File[];

    res.json({
        message: 'Files uploaded successfully',
        files: files.map(f => ({
            url: f.path,
            filename: f.filename,
            mimetype: f.mimetype,
            size: f.size
        }))
    });
});

export default router;
