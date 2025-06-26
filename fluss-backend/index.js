const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// PostgreSQL
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'Fluss',
  password: '',
  port: 5432
});

// Multer (upload documents)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// ✅ Route POST - Inscription entrepreneur
app.post('/api/inscription-entrepreneur', upload.single('document'), async (req, res) => {
  const {
    nom,
    prenom,
    email,
    mot_de_passe,
    ville,
    numero,
    date_naissance,
    nom_projet,
    secteur_activite,
    competences_recherchees,
    description_projet,
    budget,
    date_limite
  } = req.body;

  const documentPath = req.file ? req.file.filename : null;

  try {
    const checkUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (checkUser.rows.length > 0) {
      return res.status(400).json({ message: "Cet email est déjà utilisé." });
    }

    const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
    const newUser = await pool.query(
      `INSERT INTO users (nom, prenom, email, mot_de_passe, role)
       VALUES ($1, $2, $3, $4, 'entrepreneur') RETURNING id`,
      [nom, prenom, email, hashedPassword]
    );
    const userId = newUser.rows[0].id;

    await pool.query(
      `INSERT INTO entrepreneurs (user_id, nom_projet, secteur_activite, competences_recherchees, description_projet, budget, date_limite, document)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId, nom_projet, secteur_activite, competences_recherchees, description_projet, budget, date_limite, documentPath]
    );

    await pool.query(
      `INSERT INTO annonces (titre, description, budget_estime, auteur_id, auteur_type)
       VALUES ($1, $2, $3, $4, 'entrepreneur')`,
      [nom_projet, description_projet, budget, userId]
    );

    res.status(201).json({
      message: "Inscription réussie.",
      id: userId,
      utilisateur_id: userId,
      role: "entrepreneur",
      competences_recherchees
    });

  } catch (err) {
    console.error("Erreur dans /api/inscription-entrepreneur :", err);
    res.status(500).json({ message: "Erreur lors de l'inscription." });
  }
});

// ✅ Route POST - Inscription freelance
app.post('/api/inscription-freelance', async (req, res) => {
  const {
    nom,
    prenom,
    email,
    mot_de_passe,
    ville,
    numero,
    date_naissance,
    competences,
    annee_experience,
    tarif_horaire,
    disponibilite
  } = req.body;

  try {
    // 🔐 Hachage du mot de passe
    const hashedPassword = await bcrypt.hash(mot_de_passe, 10);

    // 👤 Création de l'utilisateur
    const resultUser = await pool.query(
      `INSERT INTO users (nom, prenom, email, mot_de_passe, role)
       VALUES ($1, $2, $3, $4, 'freelance') RETURNING id`,
      [nom, prenom, email, hashedPassword]
    );
    const userId = resultUser.rows[0].id;

    // 📥 Insertion dans la table freelances avec tous les champs
    await pool.query(
      `INSERT INTO freelances (
        user_id, bio, portfolio, ville, numero, date_naissance,
        annee_experience, tarif_horaire, disponibilite
      ) VALUES ($1, '', '', $2, $3, $4, $5, $6, $7)`,
      [userId, ville, numero, date_naissance, annee_experience, tarif_horaire, disponibilite]
    );

    // 🔁 Gestion des compétences
    const skills = competences.split(',').map(s => s.trim().toLowerCase());

    for (const skill of skills) {
      let result = await pool.query(`SELECT id FROM competences WHERE LOWER(nom) = $1`, [skill]);
      let competenceId;

      if (result.rowCount === 0) {
        const insert = await pool.query(`INSERT INTO competences (nom) VALUES ($1) RETURNING id`, [skill]);
        competenceId = insert.rows[0].id;
      } else {
        competenceId = result.rows[0].id;
      }

      // Lien entre freelance et compétence
      await pool.query(
        `INSERT INTO freelance_competence (freelance_id, competence_id) VALUES ($1, $2)`,
        [userId, competenceId]
      );
    }

    // ✅ Réponse finale
    res.status(200).json({ message: 'Inscription freelance réussie !' });

  } catch (err) {
    console.error("Erreur dans l'inscription freelance :", err);
    res.status(500).json({ message: "Erreur serveur lors de l'inscription." });
  }
});


// ✅ Route POST - Connexion
app.post('/api/login', async (req, res) => {
  const { email, mot_de_passe } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(400).json({ message: "Email incorrect." });

    const user = result.rows[0];
    const match = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
    if (!match) return res.status(400).json({ message: "Mot de passe incorrect." });

    res.status(200).json({
      message: "Connexion réussie.",
      user: { id: user.id, nom: user.nom, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur." });
  }
});

// ✅ Route GET - Projets (compétences)
app.get('/api/projets/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await pool.query(`SELECT * FROM entrepreneurs WHERE user_id = $1`, [userId]);
    if (result.rows.length === 0) return res.status(404).json({ message: "Projet introuvable" });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// ✅ Route GET - Budget total
app.get('/api/projets/:id/budget', async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await pool.query(`SELECT SUM(budget) as total_budget FROM entrepreneurs WHERE user_id = $1`, [userId]);
    res.json({ budget: result.rows[0].total_budget || 0 });
  } catch (err) {
    console.error("Erreur lors de la récupération du budget :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ✅ Route POST - Ajouter un projet (annonce)
app.post('/api/ajouter-projet', async (req, res) => {
  const { titre, description, competences_recherchees, budget_estime, auteur_id, auteur_type } = req.body;

  if (!titre || !description || !budget_estime || !auteur_id) {
    return res.status(400).json({ message: "Champs manquants" });
  }

  try {
    await pool.query(
      `INSERT INTO annonces (titre, description, budget_estime, auteur_id, auteur_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [titre, description, budget_estime, auteur_id, auteur_type]
    );
    res.status(201).json({ message: "Projet ajouté avec succès." });
  } catch (err) {
    console.error("Erreur insertion projet :", err);
    res.status(500).json({ message: "Erreur serveur." });
  }
});

// ✅ Serveur lancé
app.listen(3000, () => {
  console.log("✅ Serveur démarré : http://localhost:3000");
});

// R
// Route GET pour récupérer les infos d’un entrepreneur
app.get('/api/entrepreneur/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await pool.query(`
      SELECT 
        u.nom, u.prenom, u.email,
        e.ville, e.numero, e.date_naissance,
        e.nom_projet, e.secteur_activite, 
        e.competences_recherchees, e.description_projet, 
        e.budget, e.date_limite, e.document
      FROM users u
      JOIN entrepreneurs e ON u.id = e.user_id
      WHERE u.id = $1
    `, [userId]);


    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Entrepreneur introuvable" });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Erreur récupération entrepreneur:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// Liste des projets publiés par un entrepreneur (basé sur userId)
app.get('/api/entrepreneur/:id/projets', async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await pool.query(`
      SELECT nom_projet AS titre, description_projet AS description, budget, date_limite
      FROM entrepreneurs
      WHERE user_id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Aucun projet trouvé." });
    }

    res.json(result.rows);
  } catch (err) {
    console.error("Erreur chargement projets entrepreneur :", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});
 
// backend/index.js ou routes/collaborations.js
app.post('/api/collaborations/creer', async (req, res) => {
  const { projetId, freelanceId } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO collaborations (projet_id, freelance_id)
       VALUES ($1, $2)
       RETURNING *`,
      [projetId, freelanceId]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erreur création collaboration :', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

app.get("/api/matchs/:id", async (req, res) => {
  const userId = req.params.id;

  const query = `
    WITH entrep AS (
      SELECT competences_recherchees
      FROM entrepreneurs
      WHERE user_id = $1
    ),
    wanted AS (
      SELECT TRIM(LOWER(UNNEST(string_to_array(competences_recherchees, ',')))) AS nom_comp
      FROM entrep
    )
    SELECT
      u.id, u.nom, u.prenom, u.email,
      f.annee_experience, f.disponibilite,
      ARRAY_AGG(DISTINCT c.nom) AS competences
    FROM wanted
    JOIN competences c ON LOWER(c.nom) = wanted.nom_comp
    JOIN freelance_competence fc ON fc.competence_id = c.id
    JOIN freelances f ON f.user_id = fc.freelance_id
    JOIN users u ON u.id = f.user_id
    GROUP BY u.id, u.nom, u.prenom, u.email, f.annee_experience, f.disponibilite;
  `;

  try {
    const { rows } = await pool.query(query, [userId]);

    // 🔍 Tu AJOUTES ceci :
    console.log("Résultat de la requête match :", rows);

    res.json(rows);
  } catch (error) {
    console.error("Erreur dans la récupération des matchs :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

