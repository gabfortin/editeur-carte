# Notes de conception

## Pourquoi tout dans le navigateur (pas de Cloudflare)

Toutes les fonctions demandées (importer, éditer, enregistrer, rouvrir, exporter CSV et HTML) se font sans serveur. GitHub Pages suffit. La limite : une carte enregistrée reste dans le navigateur où elle a été créée. Pour passer d'un appareil à l'autre, on passe par un fichier (projet `.json`, CSV, ou la page HTML exportée, qui contient le projet complet).

Si un jour il faut des cartes partagées entre appareils ou une publication en un clic à une adresse fixe : Cloudflare Worker + R2 ou D1, derrière Cloudflare Access. Le format de projet (`js/model.js`, `format: "editeur-carte"`, `version: 1`) est déjà un document JSON autonome, prêt à être stocké tel quel.

## Le projet est la table du CSV

Choix central, pour respecter « données fidèles à la source » :

- `project.columns` garde l'ordre exact des colonnes du fichier ; `feature.row` garde chaque valeur en texte, telle quelle.
- `project.roles` associe un rôle (nom, latitude…) à une colonne existante. Rien n'est renommé.
- La position d'un point se lit dans les colonnes latitude/longitude ; celle d'une ligne dans `geometry` (WKT). Pas de copie séparée de la géométrie : impossible qu'elle diverge de la ligne CSV.
- L'export CSV reprend le séparateur, la fin de ligne et le style de guillemets de Mapme (tout champ non vide entre guillemets). Un aller-retour sans modification redonne le fichier à l'octet près (`tests/tests.html`).
- Les lignes du fichier sans position, sans nom ou géocodées hors de la zone (Madrid, Paris, Texas dans l'export Mapme « Réalisations ») ne sont ni supprimées ni corrigées : elles sont signalées (« À vérifier »). Celles sans position restent dans le CSV mais n'apparaissent pas sur la carte publiée.
- « Loin » = à plus de 100 km de la médiane des positions. Ces lieux sont exclus du cadrage initial de la carte, pas de la carte.

## Ce que l'export CSV de Mapme contient (et pas)

Vérifié sur l'export complet « Réalisations de Projet Montréal » (361 lignes, 12 colonnes : `mapmeId, name, description, categories, address, latitude, longitude, pitch, zoom, bearing, actionText, actionUrl`) :

- **Que des points.** Aucune colonne de géométrie, aucun tracé dans l'adresse ou la description. Les lignes et la zone visibles sur la carte Mapme sont des formes dessinées dans Mapme, que son export CSV ne sort pas. L'import n'en « rate » donc aucune ; il faut les retracer dans l'éditeur (ou trouver un export GeoJSON/KML de Mapme, à vérifier).
- **Pas de style.** L'icône et la couleur de chaque catégorie, et le fond de carte, sont des réglages de la carte Mapme. D'où le style par catégorie de l'éditeur (ci-dessous).
- 53 catégories, séparées par `;`.

## Style par catégorie (couleur + icône)

- Stocké dans `project.settings.categoryColors` et `project.settings.categoryIcons` (nom de catégorie → couleur / identifiant d'icône). Jamais dans le CSV : l'export CSV reste identique à celui de Mapme (testé).
- Un lieu prend la couleur et l'icône de sa **première** catégorie (`Model.colorOf`, `Model.iconOf`), comme la couleur l'était déjà.
- **Proposition d'office** (`STYLE_RULES` dans `js/model.js`) : expressions sur le nom de la catégorie, sans accents ni casse, testées dans l'ordre, avec 8 couleurs inspirées de Mapme (vert pour la nature, rouge pour l'habitation, bleu pour le social, etc.). Les 53 catégories de l'export « Réalisations » ont toutes une règle. Pièges rencontrés : « Dé*velo*ppement » attrapé par `velo` (d'où `\bvelo`), et « AccèsLogis et Logement *social* » attrapé par la règle du social (d'où l'habitation testée avant). Une catégorie sans règle reçoit le repère (`map-pin`) et une couleur de `PALETTE`.
- `assignColors()` ne remplace jamais un choix existant : rouvrir un projet ou ajouter une catégorie ne touche pas aux styles déjà choisis.
- **Icônes** : 72 pictogrammes de Lucide 0.460.0 (ISC), copiés dans `js/icons.js` (contenu des `<svg>` seulement) et intégrés dans la page exportée. Pas de police d'icônes ni de CDN. Pour en ajouter, voir l'en-tête du fichier.
- **Rendu** : disque de 26 px (éditeur) ou 28 px (carte exportée), bordure blanche, icône en trait blanc. `L.marker` + `divIcon` au lieu de `circleMarker` : un peu plus lourd, sans problème pour quelques centaines de lieux (361 testés).
- **Choix d'icône** (Réglages) : un bouton par catégorie ouvre une grille de boutons (`aria-pressed`, flèches pour se déplacer, Échap pour fermer sans fermer la fenêtre).

## Zones (polygones)

- Stockées comme les lignes, dans la colonne `geometry`, en WKT `POLYGON ((…))` : un seul anneau extérieur (les trous d'un polygone importé sont ignorés). Le WKT répète le premier sommet à la fin, comme l'exige le format ; en mémoire (`Model.getPath`), le contour est gardé ouvert, car Leaflet ferme lui-même le polygone. GeoJSON `Polygon` accepté à l'import.
- `Model.kind()` vaut `'point'`, `'line'` ou `'area'` ; `Model.isShape()` regroupe lignes et zones (tracé dans `geometry`). `setPath()` garde le type existant : déplacer un sommet d'une zone ne la transforme pas en ligne.
- Dessin : bouton « Zone », 3 sommets au moins, fermeture par double-clic, Entrée ou « Fermer la zone ». Mêmes poignées que les lignes (glisser, clic droit pour retirer, 3 sommets minimum) ; « Ajouter des sommets » ajoute à la fin de l'anneau (entre le dernier et le premier sommet).
- Aperçu pendant le tracé (lignes et zones) : segments posés en trait plein (`draft`), et pointillé du dernier sommet jusqu'au curseur (`ghost`, plus le retour au premier sommet pour une zone). Une étiquette près du curseur donne la longueur totale ou la superficie si on cliquait là. Rien au clavier ou au toucher (pas de curseur) : le tracé fonctionne comme avant.
- Superficie affichée dans la fiche (`Model.areaM2`) : projection locale simple, juste à l'échelle d'un quartier ou d'une ville (écart < 1 % sur un carré de 100 m, testé). Ce n'est qu'une indication.
- Carte publiée : polygone semi-transparent (opacité 0,22, 0,35 quand son point est sélectionné), dessiné sous les lignes.
- Une zone se rattache à un point exactement comme une ligne (section suivante).

## Ligne ou zone rattachée à un point

Demande : après avoir tracé une ligne, pouvoir la rattacher à un point existant (le tracé d'un projet dont le point porte la fiche).

- **Stockage** (même chose pour une zone) : la ligne garde sa propre rangée ; une colonne `parentId` (créée en fin de tableau au premier rattachement, comme `geometry`) contient l'identifiant du point (colonne id, `mapmeId` chez Mapme). Choix plutôt que de mettre le tracé dans la rangée du point : le point reste intact (fidélité à la source), une ligne peut être détachée ou rattachée ailleurs, et un point peut avoir plusieurs lignes. Le lien survit à l'export CSV et à la réimportation (testé).
- Un point sans identifiant en reçoit un (UUID) au moment du rattachement : c'est la seule écriture faite sur la rangée du point.
- `Model.getParent()` ne renvoie qu'un **point** existant ; un lien vers un lieu supprimé ou vers une ligne est ignoré. Supprimer un point détache ses lignes (la colonne est vidée, pas de lien orphelin dans le CSV) ; « Annuler » rétablit les deux.
- **Style** : `colorOf()` et `iconOf()` lisent les catégories du point pour une ligne rattachée. Changer la catégorie du point redessine aussi ses lignes.
- **Éditeur** : message « Ligne ajoutée » avec le bouton « Rattacher à un point » juste après le tracé ; dans la fiche de la ligne, bloc « Lieu rattaché » (choisir sur la carte, ou dans une liste déroulante pour le clavier ; ouvrir le lieu ; détacher) ; dans la fiche du point, « Lignes et zones rattachées ». Dans la liste, une ligne rattachée s'affiche « Ligne rattachée à « … » ».
- **Carte publiée** : une ligne rattachée ouvre la fiche de son point, s'affiche ou se masque avec lui (filtres, recherche), n'est pas comptée ni listée à part, et s'épaissit quand le point est sélectionné.

## Descriptions HTML

Les exports Mapme contiennent du HTML copié de Word ou de pages Web (`<font style="vertical-align: inherit">`, `<span style>`, `<br><br><br>`, divs imbriqués). `js/sanitize.js` garde la mise en forme simple (paragraphes, gras, listes, liens http/https/mailto), déballe le reste, retire scripts, images et iframes, et transforme les adresses Web en clair en liens. Ce nettoyage sert à l'affichage (éditeur et carte exportée). La valeur d'origine n'est remplacée que si on modifie la description dans l'éditeur visuel ; le bouton « HTML » montre et modifie le code d'origine sans nettoyage.

## Carte exportée

- Un seul fichier : Leaflet, `sanitize.js`, `model.js`, `viewer.js` et les styles sont lus depuis le site au moment de l'export (`fetch`) et intégrés. Pas de CDN, pas de GoatCounter (c'est le site d'accueil qui décide de sa mesure d'audience).
- Le projet est intégré en JSON dans `<script type="application/json" id="editeur-carte-projet">`, avec `<` échappé : une description qui contient `</script>` ne peut pas casser la page (testé).
- `#lieu=<uid>` dans l'adresse ouvre directement un lieu (lien à partager).
- Rendu en SVG (`circleMarker`), assez rapide pour quelques milliers de lieux. Au-delà, prévoir des grappes (Leaflet.markercluster).

## Limites connues

- Pas de géocodage d'adresse : un lieu sans position se place à la main. Nominatim serait possible, mais enverrait les adresses à un tiers : à ajouter seulement avec un consentement explicite et une mise à jour de `confidentialite.html`.
- Pas d'insertion de sommet au milieu d'une ligne ou d'une zone (on peut déplacer, retirer, ajouter au bout).
- Zones : un seul anneau, pas de trous ; pas de multipolygones.
- Images des descriptions retirées (chargement depuis des sites tiers).
- Les cartes enregistrées dans le navigateur peuvent disparaître si on efface les données du site : télécharger le projet pour les garder.

## Tests

- `tests/tests.html` : 69 vérifications automatiques (CSV, modèle, nettoyage, export, carte exportée dans un iframe).
- `tests/charger-exemple.html` : enregistre le CSV d'exemple comme carte et ouvre l'éditeur.
- Le scénario de bout en bout (glisser un point, annuler, ajouter un point et une ligne, supprimer, importer, mobile 375 px, mode sombre) a été vérifié avec Chromium sans interface, par le protocole DevTools ; le script n'est pas dans le dépôt.
