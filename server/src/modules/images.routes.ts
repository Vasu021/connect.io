import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { notFound, wrap } from '../lib/errors.js';
import { idParamSchema } from '../lib/validation.js';
import { findReadyImageById, imageStoreDir } from '../images/index.js';

export const imagesRouter = Router();

imagesRouter.use(requireAuth);

/**
 * Serves a stored word image.
 *
 * The bytes are ours — Pixabay forbids hotlinking and their URLs expire after a
 * day — so this is a plain file read. Content is immutable per id, which is why
 * it can be cached hard; `private` because the route sits behind the session.
 */
imagesRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);

    const row = await findReadyImageById(id);
    if (!row || !row.filePath) throw notFound('No such image');

    // Guard against a crafted filePath ever escaping the store directory.
    const root = imageStoreDir();
    const absolute = path.resolve(root, row.filePath);
    if (!absolute.startsWith(path.resolve(root) + path.sep)) throw notFound('No such image');

    try {
      await fs.access(absolute);
    } catch {
      // The row says READY but the file is gone — let it be fetched again
      // rather than serving a 404 forever.
      await prisma.wordImage.update({
        where: { id: row.id },
        data: { status: 'FAILED', filePath: null, nextRetryAt: null },
      });
      throw notFound('No such image');
    }

    res.setHeader('Content-Type', row.contentType ?? 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('ETag', `"${row.id}"`);
    if (row.bytes) res.setHeader('Content-Length', String(row.bytes));

    createReadStream(absolute).pipe(res);
  }),
);
