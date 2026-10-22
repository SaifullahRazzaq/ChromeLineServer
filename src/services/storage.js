import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import multer from 'multer';

// Serverless filesystems are read-only except /tmp (uploads there are not persistent: use CLOUDINARY_URL)
export const UPLOAD_DIR = process.env.VERCEL ? path.join(os.tmpdir(), 'uploads') : path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = /^(image\/(png|jpe?g|webp|gif|heic)|application\/pdf)$/;

export const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.test(file.mimetype)),
});

// Returns a public URL. With CLOUDINARY_URL set the file moves to Cloudinary and the local copy is removed.
export async function publish(file) {
  if (process.env.CLOUDINARY_URL) {
    const { v2: cloudinary } = await import('cloudinary');
    const res = await cloudinary.uploader.upload(file.path, { folder: 'primebody', resource_type: 'auto' });
    fs.unlink(file.path, () => {});
    return res.secure_url;
  }
  return `/uploads/${file.filename}`;
}
