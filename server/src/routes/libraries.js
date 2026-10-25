import express from 'express';
import crypto from 'node:crypto';
import { db } from '../db/database.js';
import { scanner } from '../scanner/fileScanner.js';

const router = express.Router();

// List all libraries with item counts
router.get('/', (req, res) => {
  try {
    const libraries = db.queryAll('SELECT * FROM libraries ORDER BY created_at ASC');
    const enriched = libraries.map(lib => {
      const paths = JSON.parse(lib.paths || '[]');
      const count = db.queryOne('SELECT COUNT(*) as c FROM media_items WHERE library_id = ?', [lib.id])?.c || 0;
      return {
        ...lib,
        paths,
        itemCount: count
      };
    });
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch libraries', message: err.message });
  }
});

// Create new library
router.post('/', async (req, res) => {
  try {
    const { name, type, paths } = req.body;
    if (!name || !type || !paths || !Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ error: 'Name, type (movie|show), and at least one folder path are required' });
    }

    const id = `lib-${crypto.randomBytes(4).toString('hex')}`;
    db.run(
      'INSERT INTO libraries (id, name, type, paths) VALUES (?, ?, ?, ?)',
      [id, name.trim(), type, JSON.stringify(paths)]
    );

    // Trigger initial scan and start watcher
    scanner.scanLibrary(id).catch(err => console.error('Initial scan error:', err));
    scanner.startWatcher(id);

    const created = db.queryOne('SELECT * FROM libraries WHERE id = ?', [id]);
    res.status(201).json({ ...created, paths });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create library', message: err.message });
  }
});

// Update library
router.put('/:id', (req, res) => {
  try {
    const { name, paths } = req.body;
    const lib = db.queryOne('SELECT * FROM libraries WHERE id = ?', [req.params.id]);
    if (!lib) return res.status(404).json({ error: 'Library not found' });

    db.run(
      'UPDATE libraries SET name = ?, paths = ? WHERE id = ?',
      [name ? name.trim() : lib.name, paths ? JSON.stringify(paths) : lib.paths, req.params.id]
    );

    if (paths) scanner.startWatcher(req.params.id);

    const updated = db.queryOne('SELECT * FROM libraries WHERE id = ?', [req.params.id]);
    res.json({ ...updated, paths: JSON.parse(updated.paths) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update library', message: err.message });
  }
});

// Delete library
router.delete('/:id', (req, res) => {
  try {
    const lib = db.queryOne('SELECT * FROM libraries WHERE id = ?', [req.params.id]);
    if (!lib) return res.status(404).json({ error: 'Library not found' });

    db.run('DELETE FROM libraries WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: `Library ${lib.name} removed` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete library', message: err.message });
  }
});

// Trigger manual scan for a library
router.post('/:id/scan', async (req, res) => {
  try {
    const lib = db.queryOne('SELECT * FROM libraries WHERE id = ?', [req.params.id]);
    if (!lib) return res.status(404).json({ error: 'Library not found' });

    // Respond immediately and run in background
    scanner.scanLibrary(req.params.id)
      .then(result => console.log(`Scan completed for ${lib.name}:`, result))
      .catch(err => console.error(`Scan error for ${lib.name}:`, err));

    res.json({ success: true, message: `Scan initiated for ${lib.name}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to initiate scan', message: err.message });
  }
});

export default router;
