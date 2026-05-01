import { Router } from 'express';
import multer from 'multer';
import { requireRole } from '../middlewares/role.middleware';
import { requireAuth } from '../middlewares/auth.middleware';
import { uploadDriversFromFile } from '../services/admin/drivers-upload.service';
import { uploadTemplateModel } from '../services/admin/template-upload.service';
import { ValidationError } from '../errors';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['text/csv', 'application/json'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
});

router.post(
  '/drivers/upload',
  requireAuth,
  requireRole(['Admin']),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {

        throw new ValidationError('No file uploaded');
      }

      await uploadDriversFromFile(req.file.buffer, req.file.mimetype);

      return res.status(200).json({
        message: 'Drivers uploaded successfully',
      });
    } catch (err) {
      next(err); 
    }
  }
);

router.post(
  '/templates/upload',
  requireAuth,
  requireRole(['Admin']),
  upload.single('file'),
  async (req, res, next) => {
    try {

      if (!req.file) {
        throw new ValidationError('No file uploaded');
      }
      
      if (req.file.mimetype !== 'application/json') {
        throw new ValidationError('Invalid file type: Template must be a JSON file');
      }

      await uploadTemplateModel(req.file.buffer);

      return res.status(200).json({
        message: 'Template uploaded successfully',
      });
    } catch (err) {
      next(err); 
    }
  }
);

export default router;