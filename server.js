const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "casaci_secret_2026_abidjan";

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ==================== CONNEXION DB ====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL? { rejectUnauthorized: false } : false
});

pool.connect((err, client, release) => {
  if (err) {
    console.log('⚠️ Pas de DATABASE_URL, mode sans DB activé');
  } else {
    console.log('✅ CasaCI connecté à PostgreSQL');
    release();
  }
});

// Middleware Auth
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Token manquant" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: "Token invalide" });
  }
};

// ==================== ROUTES DE BASE ====================
app.get('/', (req, res) => {
  res.json({
    message: "CasaCI API v2 🏠 - Abidjan",
    owner: "galileeopah@gmail.com",
    status: "En ligne",
    endpoints: [
      "GET /api/init-db",
      "POST /api/auth/register",
      "POST /api/auth/login",
      "GET /api/annonces",
      "POST /api/annonces"
    ]
  });
});

// ==================== INIT DB ====================
app.get('/api/init-db', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        telephone VARCHAR(20) UNIQUE NOT NULL,
        email VARCHAR(100),
        password VARCHAR(200) NOT NULL,
        role VARCHAR(20) DEFAULT 'locataire' CHECK (role IN ('locataire','proprietaire','agence','admin')),
        est_verifie BOOLEAN DEFAULT false,
        avatar TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS annonces (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        titre VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        type_bien VARCHAR(50) NOT NULL CHECK (type_bien IN ('appartement','villa','studio','maison','terrain','bureau','magasin')),
        type_offre VARCHAR(20) DEFAULT 'location' CHECK (type_offre IN ('location','vente')),
        prix INTEGER NOT NULL,
        caution INTEGER DEFAULT 0,
        ville VARCHAR(100) DEFAULT 'Abidjan',
        commune VARCHAR(100) NOT NULL,
        quartier VARCHAR(100),
        nb_pieces INTEGER,
        superficie INTEGER,
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        images TEXT[] DEFAULT '{}',
        equipements TEXT[] DEFAULT '{}',
        est_verifiee BOOLEAN DEFAULT false,
        est_premium BOOLEAN DEFAULT false,
        est_disponible BOOLEAN DEFAULT true,
        vues INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS favoris (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        annonce_id INTEGER REFERENCES annonces(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, annonce_id)
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        annonce_id INTEGER REFERENCES annonces(id) ON DELETE CASCADE,
        nom VARCHAR(100),
        telephone VARCHAR(20),
        message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Annonce de test
    await pool.query(`
      INSERT INTO annonces (titre, description, type_bien, type_offre, prix, commune, quartier, nb_pieces, superficie, user_id)
      SELECT '3 pièces Cocody Angré', 'Bel appartement 3 pièces, 2 chambres, bien ventilé, 1er étage, eau courante', 'appartement', 'location', 250000, 'Cocody', 'Angré', 3, 80, 1
      WHERE NOT EXISTS (SELECT 1 FROM annonces)
    `);

    res.json({ success: true, message: "✅ Base CasaCI créée avec tables + annonce test!" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== AUTH ====================
app.post('/api/auth/register', async (req, res) => {
  const { nom, telephone, password, role } = req.body;
  if (!nom ||!telephone ||!password) return res.status(400).json({ error: "Nom, téléphone et mot de passe requis" });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (nom, telephone, password, role) VALUES ($1,$2,$3,$4) RETURNING id, nom, telephone, role',
      [nom, telephone, hash, role || 'locataire']
    );
    const token = jwt.sign({ id: result.rows[0].id, telephone }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ user: result.rows[0], token });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: "Téléphone déjà utilisé" });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { telephone, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE telephone = $1', [telephone]);
    if (result.rows.length === 0) return res.status(400).json({ error: "Utilisateur non trouvé" });
    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) return res.status(400).json({ error: "Mot de passe incorrect" });
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, telephone: user.telephone }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ user: { id: user.id, nom: user.nom, telephone: user.telephone, role: user.role }, token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== ANNONCES ====================
app.get('/api/annonces', async (req, res) => {
  const { ville, commune, type_bien, type_offre, prix_min, prix_max, nb_pieces, search } = req.query;
  try {
    let query = 'SELECT a.*, u.nom as proprietaire_nom, u.telephone as proprietaire_tel FROM annonces a LEFT JOIN users u ON a.user_id = u.id WHERE a.est_disponible = true';
    let params = [];
    let idx = 1;

    if (commune) { query += ` AND LOWER(a.commune) = LOWER($${idx})`; params.push(commune); idx++; }
    if (type_bien) { query += ` AND a.type_bien = $${idx}`; params.push(type_bien); idx++; }
    if (type_offre) { query += ` AND a.type_offre = $${idx}`; params.push(type_offre); idx++; }
    if (prix_min) { query += ` AND a.prix >= $${idx}`; params.push(prix_min); idx++; }
    if (prix_max) { query += ` AND a.prix <= $${idx}`; params.push(prix_max); idx++; }
    if (nb_pieces) { query += ` AND a.nb_pieces = $${idx}`; params.push(nb_pieces); idx++; }
    if (search) { query += ` AND (a.titre ILIKE $${idx} OR a.quartier ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    query += ' ORDER BY a.est_premium DESC, a.created_at DESC LIMIT 100';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (e) {
    // Fallback si pas de DB
    res.json([
      { id: 1, titre: "3 pièces Cocody Angré", prix: 250000, commune: "Cocody", type_bien: "appartement", nb_pieces: 3 },
      { id: 2, titre: "Villa 4 pièces Yopougon", prix: 400000, commune: "Yopougon", type_bien: "villa", nb_pieces: 4 }
    ]);
  }
});

app.get('/api/annonces/:id', async (req, res) => {
  try {
    await pool.query('UPDATE annonces SET vues = vues + 1 WHERE id = $1', [req.params.id]);
    const result = await pool.query('SELECT a.*, u.nom, u.telephone FROM annonces a LEFT JOIN users u ON a.user_id = u.id WHERE a.id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Annonce non trouvée" });
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/annonces', auth, async (req, res) => {
  const { titre, description, type_bien, type_offre, prix, commune, quartier, nb_pieces, superficie, images } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO annonces (user_id, titre, description, type_bien, type_offre, prix, commune, quartier, nb_pieces, superficie, images)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user.id, titre, description, type_bien, type_offre || 'location', prix, commune, quartier, nb_pieces, superficie, images || []]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/annonces/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM annonces WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user.id]);
    if (result.rows.length === 0) return res.status(403).json({ error: "Non autorisé" });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== FAVORIS ====================
app.post('/api/favoris', auth, async (req, res) => {
  try {
    await pool.query('INSERT INTO favoris (user_id, annonce_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, req.body.annonce_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/favoris', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT a.* FROM annonces a JOIN favoris f ON f.annonce_id = a.id WHERE f.user_id = $1', [req.user.id]);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CasaCI API lancée sur ${PORT} pour ${process.env.DATABASE_URL? 'avec DB' : 'sans DB'}`);
});
