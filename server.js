const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    message: "Bienvenue sur l'API CasaCI 🏠",
    status: "API en ligne",
    version: "1.0.0"
  });
});

app.get('/api/annonces', (req, res) => {
  res.json([
    { id: 1, titre: "3 pièces Cocody", prix: 250000, ville: "Abidjan" },
    { id: 2, titre: "Villa Yopougon", prix: 180000, ville: "Abidjan" }
  ]);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CasaCI API lancée sur le port ${PORT}`);
});
