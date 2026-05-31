const express = require('express');
const multer = require('multer');
const path = require('path');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, or WEBP images allowed'));
  },
});

const ALLOWED_BUCKETS = ['customer-pictures', 'product-images'];

router.post('/:bucket', requireRole('admin', 'operator'), upload.single('file'), async (req, res) => {
  const { bucket } = req.params;
  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return res.status(400).json({ error: 'invalid bucket' });
  }
  if (!req.file) return res.status(400).json({ error: 'file is required (multipart/form-data field "file")' });

  // Operators can only upload customer pictures (their branch's customers).
  // Only admins can upload product images.
  if (req.user.role === 'operator' && bucket === 'product-images') {
    return res.status(403).json({ error: 'Only admins can upload product images' });
  }

  const ext = (path.extname(req.file.originalname) || '').toLowerCase() || '.jpg';
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const objectPath = req.user.role === 'admin' ? `admin/${safeName}` : `${req.user.branch_id}/${safeName}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from(bucket)
    .upload(objectPath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

  if (upErr) return res.status(500).json({ error: upErr.message });

  const { data: pub } = supabaseAdmin.storage.from(bucket).getPublicUrl(objectPath);

  res.status(201).json({ path: objectPath, url: pub.publicUrl });
});

module.exports = router;
