# Données — Éditeur de carte

Format des fichiers que l'éditeur lit et écrit. Le projet **est** la table du
CSV : voir aussi [NOTES.md](NOTES.md), « Le projet est la table du CSV ».

## Colonnes reconnues

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
| Ligne ou zone (tracé) | `geometry`, `wkt`, `geom` | WKT `LINESTRING (lng lat, lng lat, …)` pour une ligne, `POLYGON ((lng lat, …, premier sommet répété))` pour une zone (anneau extérieur seulement) ; GeoJSON `LineString` / `Polygon` accepté à l'import |
| Point de rattachement d'une ligne ou d'une zone | `parentId`, `parent`, `lieuParent` | Identifiant (colonne Identifiant) du point auquel le tracé appartient. Colonne ajoutée en fin de tableau au premier rattachement. |

**Ce que l'export CSV de Mapme ne contient pas** : l'icône et la couleur des catégories, le fond de carte, et les formes dessinées dans Mapme (lignes, zones). Vérifié sur l'export « Réalisations » (361 lignes, que des points). Les icônes et couleurs se refont dans « Réglages de la carte » ; les lignes se tracent dans l'éditeur.

Les autres colonnes (`pitch`, `zoom`, `bearing` de Mapme, etc.) sont gardées telles quelles et ressortent à l'export. Une carte créée de zéro utilise les colonnes de Mapme. La colonne `geometry` est ajoutée en fin de tableau au premier tracé de ligne.

**Fidélité à la source** : le projet est la table du CSV. Une valeur n'est réécrite que si on la modifie (ex. latitude et longitude après un déplacement). Un CSV importé puis exporté sans modification est identique, octet pour octet (testé). Les descriptions HTML sont nettoyées **à l'affichage seulement** (voir `js/sanitize.js`) ; le texte d'origine reste dans les données tant qu'on ne le modifie pas dans l'éditeur visuel.
