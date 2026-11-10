# Éditeur de carte

Outil pour monter une carte de lieux à partir d'un fichier CSV (par exemple un
export Mapme), la corriger, puis la publier en une page HTML autonome à
intégrer dans un autre site. Pour qui gère une carte de lieux (élu·es,
organismes) sans outil payant. Tout se passe dans le navigateur : aucun
serveur, aucune donnée envoyée.

**En ligne :** [mapedit.gabfortin.com](https://mapedit.gabfortin.com)

## Contenu

| Fonction | Détail |
|---|---|
| Importer | CSV (virgule, point-virgule ou tabulation ; UTF-8 ou Windows-1252), page HTML exportée par l'outil, fichier de projet `.json`. Bouton « Importer » ou glisser-déposer sur la page. |
| Rapport d'import | Nombre de lignes lues, de points, de lignes, de lieux sans position ou à plus de 100 km des autres, colonnes reconnues. Rien n'est supprimé ni corrigé automatiquement. |
| Modifier | Nom, catégories, adresse, description (mise en forme simple, ou code HTML d'origine), lien, autres colonnes du fichier. Glisser un point, glisser les sommets d'une ligne ou d'une zone, clic droit sur un sommet pour le retirer, prolonger une ligne ou ajouter des sommets à une zone. La fiche d'une zone donne sa superficie approximative. |
| Ajouter | Points, lignes et zones (polygones), en cliquant sur la carte (boutons « Point », « Ligne », « Zone »). Une zone se ferme par double-clic, Entrée ou « Fermer la zone » (3 sommets au moins). Pendant le tracé, un pointillé relie le dernier sommet au curseur (et, pour une zone, revient au premier sommet), avec la longueur totale ou la superficie qu'on obtiendrait en cliquant, comme l'outil Mesurer de Google Maps. Retour arrière retire le dernier sommet. |
| Rattacher une ligne ou une zone à un point | Après le tracé (bouton « Rattacher à un point » du message) ou dans sa fiche : cliquer sur un point de la carte, ou le choisir dans la liste. Le tracé prend la couleur et l'icône du point ; sur la carte publiée, il ouvre la fiche du point, suit ses filtres et n'est pas listé à part. « Détacher » défait le lien. |
| Annuler | Bouton « Annuler » ou Ctrl+Z (60 étapes). |
| Style | Couleur et icône par catégorie (« Réglages de la carte »), parmi 72 pictogrammes. Un lieu prend celles de sa première catégorie et s'affiche en disque de couleur avec une icône blanche, comme dans Mapme. Une couleur et une icône sont proposées d'office selon le nom de la catégorie (ex. « Espaces verts » → arbres, vert). Enregistré dans le projet et la page exportée, jamais dans le CSV. |
| Enregistrer | Automatique, dans le navigateur (IndexedDB). « Mes cartes » liste les cartes enregistrées sur cet appareil. |
| Exporter | **Page HTML** autonome (carte, données, Leaflet et code intégrés) + code d'`iframe` ; **CSV** (mêmes colonnes et même ordre que le fichier importé) ; **projet** `.json`. |

### Publier une carte

1. Exporter → Télécharger la page HTML.
2. Mettre le fichier en ligne (GitHub Pages, site Web).
3. L'intégrer avec le code d'`iframe` fourni, en remplaçant l'adresse.

La page exportée n'a ni mesure d'audience ni dépendance externe, sauf les tuiles OpenStreetMap. Ouverte directement depuis le disque (`file://`), elle peut afficher des tuiles bloquées : OpenStreetMap exige un site d'origine. Une fois en ligne, tout s'affiche.

La page exportée contient le projet complet : on peut la rouvrir dans l'éditeur (Importer) pour la modifier.

## Données

Les données sont celles que la personne importe : l'outil n'a pas de source
à lui. Colonnes reconnues, format des tracés et fidélité à la source
(un CSV importé puis exporté sans modification est identique, octet pour
octet) : [DONNEES.md](DONNEES.md).

## Utilisation locale

```bash
python3 -m http.server 8000
```

- Éditeur : http://localhost:8000/
- Charger l'exemple : http://localhost:8000/tests/charger-exemple.html (enregistre `tests/exemple-mapme.csv` comme carte et ouvre l'éditeur)

## Tests

Dans le navigateur, avec le serveur local : <http://localhost:8000/tests/tests.html>
(CSV, nettoyage HTML, modèle, export, carte exportée).

## Architecture

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

HTML/CSS/JS vanilla, sans build. Leaflet 1.9.4 hébergé dans `vendor/` (il est aussi intégré tel quel dans les pages exportées). Pictogrammes : 72 icônes de [Lucide](https://lucide.dev) 0.460.0 (licence ISC, `vendor/lucide-0.460.0/LICENSE`) copiées dans `js/icons.js`. Polices Inter et Poppins dans `fonts/` (OFL). Système de design des cartes (`~/Developer/MAP-DESIGN-SYSTEM.md`), dialecte `gf-`, couleur sarcelle, mode sombre selon l'appareil.

## Publication

GitHub Pages, branche `main`, domaine dans `CNAME`. Ce site n'a pas encore le
numéro de version x.y.z des autres sites : à chaque mise en ligne, changer le
numéro `?v=` dans `index.html` (balises `<link>`/`<script>` et
`<meta name="app-version">`, qui sert aussi aux fichiers intégrés dans les
pages exportées).

## Confidentialité

Aucun cookie, aucun compte, aucune donnée envoyée : les cartes sont
enregistrées dans le navigateur (IndexedDB).

| Quand | Ce qui est envoyé | À qui |
|---|---|---|
| Chaque visite | Page, site d'origine, appareil, pays | GoatCounter (mesure d'audience anonyme) |
| Carte | Requêtes de tuiles de la zone affichée | OpenStreetMap |

La page exportée n'a ni mesure d'audience ni dépendance externe, sauf les
tuiles OpenStreetMap. Détails : [confidentialite.html](confidentialite.html).

## Crédits

- [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause), hébergé dans `vendor/`
- 72 pictogrammes de [Lucide](https://lucide.dev) 0.460.0 (ISC), copiés dans `js/icons.js` (licence dans `vendor/lucide-0.460.0/LICENSE`)
- Polices Inter et Poppins (SIL OFL 1.1), hébergées dans `fonts/`
- Fond de carte © les contributeurs d'[OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL)

## Auteur

Développé par [Gabriel Fortin](https://gabfortin.com). Projet personnel : ce
n'est pas un service de la Ville de Montréal ni d'un arrondissement.

## Documentation détaillée

| Fichier | Contenu |
|---|---|
| [DONNEES.md](DONNEES.md) | Colonnes du CSV reconnues, tracés, fidélité à la source |
| [NOTES.md](NOTES.md) | Décisions : tout dans le navigateur, le projet est la table du CSV… |
