# Éditeur de carte

Outil pour monter une carte de lieux à partir d'un fichier CSV (par exemple un export Mapme), la corriger, puis la publier en une page HTML autonome à intégrer dans un autre site. Tout se passe dans le navigateur : aucun serveur, aucune donnée envoyée.

**En ligne :** [mapedit.gabfortin.com](https://mapedit.gabfortin.com)

Projet personnel de [Gabriel Fortin](https://gabfortin.com). Ce n'est pas un service de la Ville de Montréal ni d'un arrondissement.

## Ce que fait l'outil

| Fonction | Détail |
|---|---|
| Importer | CSV (virgule, point-virgule ou tabulation ; UTF-8 ou Windows-1252), page HTML exportée par l'outil, fichier de projet `.json`. Bouton « Importer » ou glisser-déposer sur la page. |
| Rapport d'import | Nombre de lignes lues, de points, de lignes, de lieux sans position ou à plus de 100 km des autres, colonnes reconnues. Rien n'est supprimé ni corrigé automatiquement. |
| Modifier | Nom, catégories, adresse, description (mise en forme simple, ou code HTML d'origine), lien, autres colonnes du fichier. Glisser un point, glisser les sommets d'une ligne, clic droit sur un sommet pour le retirer, prolonger une ligne. |
| Ajouter | Points et lignes, en cliquant sur la carte. |
| Annuler | Bouton « Annuler » ou Ctrl+Z (60 étapes). |
| Style | Couleur et icône par catégorie (« Réglages de la carte »), parmi 72 pictogrammes. Un lieu prend celles de sa première catégorie et s'affiche en disque de couleur avec une icône blanche, comme dans Mapme. Une couleur et une icône sont proposées d'office selon le nom de la catégorie (ex. « Espaces verts » → arbres, vert). Enregistré dans le projet et la page exportée, jamais dans le CSV. |
| Enregistrer | Automatique, dans le navigateur (IndexedDB). « Mes cartes » liste les cartes enregistrées sur cet appareil. |
| Exporter | **Page HTML** autonome (carte, données, Leaflet et code intégrés) + code d'`iframe` ; **CSV** (mêmes colonnes et même ordre que le fichier importé) ; **projet** `.json`. |

## Format du CSV

Une ligne par lieu. Les colonnes sont reconnues par leur nom (sans tenir compte des accents ni de la casse) :

| Rôle | Noms reconnus | Remarque |
|---|---|---|
| Identifiant | `mapmeId`, `id`, `identifiant`, `uuid` | Généré (UUID) pour un lieu ajouté |
| Nom | `name`, `nom`, `titre`, `title` | |
| Description | `description`, `desc`, `texte` | HTML simple accepté |
| Catégories | `categories`, `catégorie`, `category`, `tags`, `thème` | Séparées par `;`. Couleur selon la première. |
| Adresse | `address`, `adresse` | Une adresse qui ne contient que des coordonnées n'est pas affichée (cas Mapme) |
| Position | `latitude`/`lat`, `longitude`/`lng`/`lon` | Point décimal ou virgule |
| Lien | `actionText`, `actionUrl` (ou `lien`, `url`) | Bouton dans la fenêtre du lieu |
| Ligne (tracé) | `geometry`, `wkt`, `geom` | WKT `LINESTRING (lng lat, lng lat, …)` ; GeoJSON accepté à l'import |

**Ce que l'export CSV de Mapme ne contient pas** : l'icône et la couleur des catégories, le fond de carte, et les formes dessinées dans Mapme (lignes, zones). Vérifié sur l'export « Réalisations » (361 lignes, que des points). Les icônes et couleurs se refont dans « Réglages de la carte » ; les lignes se tracent dans l'éditeur.

Les autres colonnes (`pitch`, `zoom`, `bearing` de Mapme, etc.) sont gardées telles quelles et ressortent à l'export. Une carte créée de zéro utilise les colonnes de Mapme. La colonne `geometry` est ajoutée en fin de tableau au premier tracé de ligne.

**Fidélité à la source** : le projet est la table du CSV. Une valeur n'est réécrite que si on la modifie (ex. latitude et longitude après un déplacement). Un CSV importé puis exporté sans modification est identique, octet pour octet (testé). Les descriptions HTML sont nettoyées **à l'affichage seulement** (voir `js/sanitize.js`) ; le texte d'origine reste dans les données tant qu'on ne le modifie pas dans l'éditeur visuel.

## Publier une carte

1. Exporter → Télécharger la page HTML.
2. Mettre le fichier en ligne (GitHub Pages, site Web).
3. L'intégrer avec le code d'`iframe` fourni, en remplaçant l'adresse.

La page exportée n'a ni mesure d'audience ni dépendance externe, sauf les tuiles OpenStreetMap. Ouverte directement depuis le disque (`file://`), elle peut afficher des tuiles bloquées : OpenStreetMap exige un site d'origine. Une fois en ligne, tout s'affiche.

La page exportée contient le projet complet : on peut la rouvrir dans l'éditeur (Importer) pour la modifier.

## Stack

HTML/CSS/JS vanilla, sans build. Leaflet 1.9.4 hébergé dans `vendor/` (il est aussi intégré tel quel dans les pages exportées). Pictogrammes : 72 icônes de [Lucide](https://lucide.dev) 0.460.0 (licence ISC, `vendor/lucide-0.460.0/LICENSE`) copiées dans `js/icons.js`. Polices Inter et Poppins dans `fonts/` (OFL). Système de design des cartes (`~/Developer/MAP-DESIGN-SYSTEM.md`), dialecte `gf-`, couleur sarcelle, mode sombre selon l'appareil.

| Fichier | Rôle |
|---|---|
| `index.html`, `css/style.css`, `js/app.js` | Éditeur |
| `js/csv.js` | Lecture et écriture CSV (RFC 4180, champs multilignes) |
| `js/model.js` | Projet, rôles des colonnes, géométrie, catégories, lieux à vérifier. Partagé avec la carte exportée. |
| `js/sanitize.js` | Nettoyage du HTML des descriptions. Partagé avec la carte exportée. |
| `js/icons.js` | Pictogrammes des catégories (Lucide). Partagé avec la carte exportée. |
| `js/store.js` | Enregistrement dans IndexedDB |
| `js/export-html.js` | Construction de la page HTML autonome |
| `viewer/viewer.css`, `viewer/viewer.js` | Carte publiée (intégrés dans la page exportée) |
| `tests/` | Tests et CSV d'exemple |

## Développer en local

```bash
python3 -m http.server 8000
```

- Éditeur : http://localhost:8000/
- Tests : http://localhost:8000/tests/tests.html (CSV, nettoyage HTML, modèle, export, carte exportée)
- Charger l'exemple : http://localhost:8000/tests/charger-exemple.html (enregistre `tests/exemple-mapme.csv` comme carte et ouvre l'éditeur)

À chaque mise en ligne : changer le numéro `?v=` dans `index.html` (balises `<link>`/`<script>` et `<meta name="app-version">`, qui sert aussi aux fichiers intégrés dans les exports).
