---
name: Backlog Board
description: L'établi d'IDE — un poste de travail dense pour piloter des agents de code en local.
colors:
  canvas: "#f7f8fa"
  chrome: "#f9fafb"
  surface: "#ffffff"
  elevated: "#ffffff"
  input: "#ffffff"
  hover: "#f2f4f7"
  active: "#eef2f6"
  text-strong: "#101828"
  text-primary: "#1d2939"
  text-body: "#344054"
  text-secondary: "#475467"
  text-muted: "#636b7d"
  text-subtle: "#7f8899"
  text-inverse: "#ffffff"
  text-on-fill: "#ffffff"
  text-on-solid: "#101828"
  border-strong: "#d0d5dd"
  border-default: "#e4e7ec"
  border-subtle: "#eef0f3"
  border-field: "#7f8899"
  accent: "#1570ef"
  accent-hover: "#155eef"
  accent-bg: "#eff8ff"
  accent-text: "#175cd3"
  accent-on: "#ffffff"
  success: "#027a48"
  success-bg: "#d1fadf"
  success-on: "#ffffff"
  warning: "#b54708"
  warning-bg: "#fef0c7"
  warning-on: "#ffffff"
  danger: "#b42318"
  danger-bg: "#fee4e2"
  danger-on: "#ffffff"
  apply: "#7c3aed"
  apply-hover: "#6d28d9"
  apply-text: "#6d28d9"
  apply-on: "#ffffff"
  priority-p0: "#d92d20"
  priority-p1: "#c2410c"
  priority-p2: "#2563eb"
  priority-p3: "#667085"
  console-bg: "#0c111d"
  console-text: "#d0d5dd"
  console-border: "#344054"
  console-line: "#1d2939"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "normal"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  dense:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  pill: "999px"
spacing:
  hairline: "2px"
  xs: "4px"
  sm: "6px"
  base: "8px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  2xl: "20px"
  3xl: "32px"
components:
  button-default:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.text-body}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-default-hover:
    backgroundColor: "{colors.active}"
    textColor: "{colors.text-primary}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-on}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.accent-on}"
  button-primary-disabled:
    backgroundColor: "{colors.text-muted}"
    textColor: "{colors.text-inverse}"
  button-apply:
    backgroundColor: "{colors.apply}"
    textColor: "{colors.apply-on}"
    typography: "{typography.dense}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  button-apply-hover:
    backgroundColor: "{colors.apply-hover}"
    textColor: "{colors.apply-on}"
  button-discard:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.danger}"
    typography: "{typography.dense}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  button-run:
    backgroundColor: "{colors.success}"
    textColor: "{colors.success-on}"
    typography: "{typography.dense}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  input-field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text-primary}"
    borderColor: "{colors.border-field}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
  card-task:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  chip:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.micro}"
    rounded: "{rounded.xs}"
    padding: "1px 6px"
  badge-running:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success}"
    typography: "{typography.micro}"
    rounded: "{rounded.xs}"
    padding: "2px 6px"
  badge-review:
    backgroundColor: "{colors.accent-bg}"
    textColor: "{colors.accent-text}"
    typography: "{typography.micro}"
    rounded: "{rounded.xs}"
    padding: "2px 6px"
  badge-blocked:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
    typography: "{typography.micro}"
    rounded: "{rounded.xs}"
    padding: "2px 6px"
  nav-item:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.text-body}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
  nav-item-active:
    backgroundColor: "{colors.accent-bg}"
    textColor: "{colors.accent-text}"
  modal:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    width: "min(92%, 460px)"
  console-surface:
    backgroundColor: "{colors.console-bg}"
    textColor: "{colors.console-text}"
    typography: "{typography.mono}"
    padding: "8px 10px"
---

# Design System: Backlog Board

## Overview

**Creative North Star: "L'établi d'IDE"**

Le board n'est pas une application web posée sur un produit local : c'est un
établi. La filiation est explicite dans le code lui-même — navigateur à
gauche, canvas au centre, inspecteur à droite, zone de console en bas,
séparateurs déplaçables entre les quatre. Xcode, Linear et le mode sombre de
GitHub sont la famille ; le navigateur web n'est que le châssis. Chaque
décision visuelle se juge à cette aune : est-ce qu'un IDE ferait ça ?

Un établi se reconnaît à deux choses. D'abord la **densité** : l'information
est au premier plan, la chrome se retire. Le corps de texte réel est à 12–13 px,
les libellés à 10–11 px en capitales espacées, les rayons à 4 px, les
respirations à 8 px. Ce n'est pas de la petitesse : c'est le refus de faire
payer de la place à ce qui n'est pas de la donnée. Ensuite la **partition
spatiale** : le canvas central est la pièce où l'on travaille, les panneaux
qui l'entourent sont l'outillage, et le sombre marque toujours ce qui est
« la machine qui parle » — la console reste noire dans les deux thèmes, parce
que la sortie d'un agent n'est pas un document, c'est un flux.

Le système est calme au repos et bavard uniquement quand un état change. La
couleur ne décore rien : chaque teinte non neutre porte un statut, et une
carte au repos est grise. La personnalité passe par la précision — un liseré
de 3 px qui code la priorité, un point vert qui pulse pendant qu'un agent
tourne, un compteur qui s'aligne en monospace — jamais par l'ornement.

**Key Characteristics:**

- Quatre zones redimensionnables autour d'un canvas, à la manière d'un IDE.
- Densité assumée : 12 px de corps, 4 px de rayon, rythme de 8 px.
- Deux thèmes à parité stricte, pilotés uniquement par tokens.
- La console reste sombre dans les deux thèmes : le sombre signifie « machine ».
- Couleur strictement porteuse de statut ; le gris est l'état normal.
- Monospace réservé aux identifiants machine.
- Composants sûrs et discrets : bordure fine, transition de 120 ms, aucun éclat au repos.

## Colors

Une base de gris froids quasi neutres, traversée par un bleu interactif unique
et quatre teintes de statut. Toute couleur visible répond à la question
« quel est l'état de ce truc ? ».

Les valeurs du frontmatter sont celles du thème clair, source normative.
Chaque token a un pendant sombre défini dans `src/app.css` et repris dans
`.impeccable/design.json` (`extensions.darkTheme`) ; **aucun composant ne doit
lire une valeur autrement que par sa variable CSS.**

### Primary

- **Bleu Signal** (`--accent`) : la seule couleur d'interaction. Focus, lien,
  élément de navigation actif, bouton d'action confirmante, poignée de
  séparateur survolée. Son fond pâle (`--accent-bg`) porte l'état actif de la
  navigation et le badge « en revue ».

### Secondary

- **Violet Applique** (`--apply`) : réservé à un seul geste de tout le produit —
  accepter le travail d'un agent (bouton « Appliquer » sur une carte en revue,
  et son écho dans le panneau de diff). C'est la seule décision irréversible
  et positive de l'interface ; elle mérite une couleur qui n'appartient qu'à
  elle. Promue en token : elle ne doit plus être écrite en dur.
  Le geste reste violet et reste un **bouton plein** ; c'est cette double
  contrainte qui a forcé le clair à descendre de violet-400 à **violet-600
  (`#7c3aed`, survol `#6d28d9`)** — l'ancien violet ne portait le blanc qu'à
  2.72:1, il le porte maintenant à 5.70:1. Le sombre garde `#a78bfa` et fait
  basculer l'encre à la place. **`--apply` est le seul token du système dont
  la valeur diverge par thème**, et c'est une exception de contraste, pas une
  licence : rien d'autre n'a le droit de diverger. Sa variante texte
  `--apply-text` (`#6d28d9` en clair) est plus sombre que le remplissage,
  exactement comme `--accent` / `--accent-text`.

### Tertiary

- **Rampe de priorité** (`--priority-p0` … `--priority-p3`) : rouge `#d92d20`,
  orange `#c2410c`, bleu `#2563eb`, gris `#667085`. Invariante par thème,
  encre blanche unique (`--text-on-fill`). Elle ne vit que sur le liseré
  gauche de 3 px des cartes et sur la pastille P0–P3, et reste délibérément
  distincte des couleurs de statut : une priorité n'est pas un incident —
  `#c2410c` n'est pas `--warning` `#b54708`, et `#2563eb` n'est ni `--accent`
  ni `--accent-solid`.
  La rampe a été assombrie pour une raison mesurée : elle doit satisfaire
  **deux** seuils, pas un. La pastille exige 4.5:1 pour son texte, mais le
  liseré de 3 px est un élément non textuel porteur d'information et exige
  3:1 **sur les quatre fonds du système** — `#ffffff`, `#f7f8fa`, `#1f1f23`,
  `#050507`. L'ancienne rampe laissait le liseré P1 à 2.35:1 et P3 à 2.58:1
  sur une carte blanche : la priorité était invisible là où elle compte le
  plus. La nouvelle passe partout (liseré : 3.17 à 5.18 selon le fond ;
  pastille : 4.83 à 5.18). P3 tient désormais son propre littéral — il ne
  s'adosse plus à `--text-subtle`, qui n'est plus une couleur de contenu.

### Neutral

- **Toile** (`--bg-app`) : le canvas central, la zone la plus profonde du
  clair comme du sombre. En sombre elle vire au noir quasi pur (#050507) :
  c'est le vide dans lequel on travaille.
- **Chrome** (`--bg-muted`) : panneaux latéraux, en-têtes, pieds. Toujours
  plus clair que la toile en sombre, pour lire comme l'outillage autour.
- **Surface** (`--bg-surface`) / **Élevé** (`--bg-elevated`) : cartes,
  modales, popovers, puis survols et chips.
- **Encres** (`--text-strong` → `--text-muted`) : **six niveaux de texte, plus
  un plancher non textuel.** Le corps de texte est `--text-body`, jamais
  `--text-strong`.
  **`--text-subtle` n'est plus une couleur de texte.** C'est le plancher 3:1
  des éléments non textuels : glyphe d'un bouton désactivé, séparateur
  décoratif « · », chevron, `text-decoration-color` d'un titre barré, contour
  de composant. Il n'est jamais non plus un fond. Le « méta effacé » descend
  d'un cran et vit sur `--text-muted` (`#636b7d` en clair, `#97979f` en
  sombre), qui devient l'encre secondaire **minimale** : plus rien de lisible
  ne passe en dessous.
  La raison est structurelle, pas cosmétique. `--text-subtle` ne peut pas
  atteindre 4.5:1 sur blanc sans devenir `--text-muted` : le niveau
  n'existait qu'en apparence. Et en sombre, atteindre 4.5:1 sur
  `--bg-surface` `#1f1f23` impose une luminance relative ≥ 0.234 — le thème
  sombre ne peut tout simplement pas héberger sept niveaux d'encre lisibles.
  Six est le nombre que les deux thèmes peuvent tenir ensemble.
- **Traits** (`--border-strong` / `--border-default` / `--border-subtle` /
  `--border-field`) : la structure passe d'abord par des filets de 1 px, pas
  par des ombres.
  `--border-field` est le quatrième trait, **réservé aux composants de
  saisie** — `input`, `textarea`, `select`, et bouton à fond transparent posé
  sur une surface. WCAG 1.4.11 exige 3:1 pour le contour d'un composant
  d'interface, et `--border-strong` n'atteint que 1.47:1 sur un champ blanc
  (`#3f3f46` sur `#050507` ne fait que 1.95:1 en sombre) : un champ vide était
  littéralement invisible. `--border-field` alias `--text-subtle` — même
  plancher 3:1, ils doivent bouger ensemble.
  `--border-strong` n'est **pas** remonté, délibérément : il porte les
  séparateurs de panneaux, les filets de tableau et les bordures de boutons
  déjà remplis, où 3:1 alourdirait toute la chrome sans rien rendre plus
  utilisable.

### Statut

- **Vert Marche** (`--success`) : un run est en cours ou a réussi. Porte aussi
  le bouton ▶.
- **Ambre Attente** (`--warning`) : bloqué, verrou concurrent, dépôt sale.
  Jamais utilisé pour une erreur.
- **Rouge Échec** (`--danger`) : run en échec, suppression, action destructive.
- **Noir Console** (`--console-bg` + `--console-text`) : le flux d'événements
  d'agent, identique dans les deux thèmes.

### Named Rules

**La règle de l'accent unique.** Un seul bleu interactif dans tout le produit.
Une nouvelle teinte n'entre dans le système que si elle nomme un état qu'aucun
token existant ne nomme déjà.

**La règle du gris au repos.** Un objet qui ne se passe rien est gris. Si une
couleur apparaît sur un écran calme, c'est un bug de design.

**La règle du sombre-machine.** Le fond sombre signifie « sortie de machine ».
Il ne s'applique jamais à une zone de saisie humaine, quel que soit le thème.

**La règle du zéro-hex.** Aucune valeur de couleur littérale dans un
composant. Une couleur non tokenisée n'existe pas.

**La règle de l'encre appariée.** Tout remplissage saturé a un token d'encre
apparié — `--accent-on`, `--success-on`, `--warning-on`, `--danger-on`,
`--apply-on`. En clair l'encre est blanche, parce que les remplissages y sont
sombres ; en sombre elle devient quasi noire, parce qu'ils y sont clairs. Les
cinq ne sont que des alias de `--text-inverse` : ils basculent tout seuls, et
aucun d'eux n'ajoute de valeur au système. Deux exceptions, nommées et
fermées : `--text-on-solid` (`#101828`, identique dans les deux thèmes) pour
la famille `--*-solid`, vive des deux côtés ; `--text-on-fill` (`#ffffff`)
pour les remplissages qui restent sombres dans les deux thèmes — rampe de
priorité, `--console-bg`, `--console-line`, `--text-primary` employé en fond.
Poser une encre claire sur un fond de couleur sans passer par un de ces trois
tokens est une régression. Le test tient en une question : **ce fond
s'éclaircit-il en thème sombre ?** Si oui, il lui faut son token `-on` ; si
non, `--text-on-fill`.

## Typography

**Police d'interface :** pile système (`-apple-system, BlinkMacSystemFont,
"Segoe UI", system-ui, sans-serif`).
**Police machine :** pile monospace système (`ui-monospace, SFMono-Regular,
Menlo, Consolas, monospace`).
**Aucune police téléchargée**, jamais : le board est embarqué dans un binaire
unique et ne fait aucune requête sortante.

**Caractère :** neutre par construction. Le produit ne dit rien par ses
lettres ; il dit tout par la hiérarchie de taille et par le contraste entre
la voix de l'interface (sans-serif) et la voix de la machine (monospace).

### Hierarchy

- **Display** (600, 18 px, 1.3) : titre d'une vue plein écran ou d'un dialogue.
  Un seul par écran.
- **Headline** (600, 16 px, 1.35) : titre de section à l'intérieur d'une vue.
- **Title** (600, 14 px, 1.3) : titre de carte, en-tête de bloc.
- **Body** (400, 13 px, 1.45) : prose, libellés de formulaire, éléments de
  navigation, texte des boutons.
- **Dense** (400, 12 px, 1.4) : la vraie voix de travail du produit — lignes de
  liste, sous-tâches, tableaux, métadonnées lisibles.
- **Label** (600, 11 px) : méta secondaire, compteurs, badges.
- **Micro** (600, 10 px, 0.04em, capitales) : en-tête de colonne, étiquette de
  catégorie, pastille de priorité. La capitale espacée est le marqueur de
  « ceci est une étiquette, pas du contenu ».
- **Mono** (400, 12 px, 1.5) : identifiants machine.

### Named Rules

**La règle du monospace-identifiant.** Le monospace est réservé à ce que la
machine a produit et que l'humain doit pouvoir comparer caractère à
caractère : chemins, globs de scope, SHA, ids de run et de claim, branches,
diffs, sortie d'agent. Une durée, un pourcentage ou un compteur reste en
sans-serif. Le monospace n'est pas un effet de style technique, c'est une
promesse de comparabilité.

**La règle du plancher à 10 px.** 10 px est le plus petit corps du système, et
seulement en capitales à 600. Rien en dessous. Toute information qui doit
rester lisible depuis la scène « second écran » vit à 12 px minimum.

**La règle des deux voix.** Sur une même ligne, sans-serif et monospace se
partagent le rôle : la voix humaine nomme, la voix machine identifie. Ne pas
mélanger les deux à l'intérieur d'un même fragment.

## Layout

**Le squelette.** Une barre supérieure fixe (44 px minimum, grille en trois
colonnes `1fr auto 1fr`) surmonte une bande horizontale de quatre zones :
navigateur (gauche), canvas (centre), inspecteur (droite), console (bas).
Les trois séparateurs sont des filets de 1 px avec une zone de préhension de
7 px, et chaque panneau est repliable. Aucune zone ne défile la page : le
document fait exactement 100 vh, `overflow: hidden`, et le défilement se
produit à l'intérieur des panneaux.

**Le canvas.** Le board est une grille de colonnes de statut,
`repeat(var(--columns-count), minmax(240px, 1fr))`, gouttière de 12 px,
marge intérieure de 16 px. 240 px est le plancher d'une colonne lisible : en
dessous, une carte casse. Les colonnes s'étirent, elles ne se centrent jamais
dans un conteneur de largeur maximale — un établi occupe toute la table.

**Le rythme.** Base de 8 px, avec 4 px et 6 px comme demi-pas pour l'intérieur
des composants denses et 12 / 16 px pour la séparation entre blocs. 20 px et
32 px n'apparaissent que dans les dialogues et les états vides.

**Le responsive.** Les quatre scènes d'usage sont également légitimes : demi-
écran collé au terminal (~700–900 px), plein écran large, second écran lu de
loin, et consultation mobile. Le comportement attendu, par ordre de
dégradation : les panneaux latéraux se replient avant que le canvas ne se
comprime ; les colonnes du board passent au défilement horizontal plutôt que
sous les 240 px ; la console devient un onglet plutôt qu'une bande.

### Named Rules

**La règle du canvas souverain.** Quand la place manque, ce sont les panneaux
qui cèdent, jamais le canvas central.

**La règle des trois seuils.** Le système vise trois points de rupture —
640 px, 900 px, 1280 px — et rien d'autre. L'implémentation actuelle en
compte huit, hérités (600, 700, 760, 820, 860, 900, 980, 1100) ; tout travail
responsive futur converge vers les trois seuils au lieu d'en ajouter un
neuvième. Les requêtes de **capacité** de pointeur — `(pointer: coarse)`,
`(hover: none)` — ne comptent pas dans les trois seuils : elles ne parlent pas
de largeur.

**La règle des 24 px.** Toute cible de pointeur fait au moins 24 × 24 px en
boîte de bordure. C'est le plancher WCAG 2.5.8, valable dans les deux thèmes
et à **toutes** les largeurs : un bouton de 22 px n'est pas « acceptable en
desktop », il est hors norme partout. Le confort de 28 px s'obtient sous
`@media (pointer: coarse)` — jamais par un changement de `padding`, qui
déplacerait la mise en page en pointeur fin. Les deux valeurs sont
tokenisées : `--tap-size` (24 px, 28 px en pointeur grossier) et `--tap-gap`
(2 px, 4 px), qu'un contrôle consomme une fois en `min-width` / `min-height`
et en `gap`. Deux cibles conformes collées l'une à l'autre restent un raté :
la taille et l'écart vont ensemble. Le discriminant est la **capacité du
pointeur, pas la largeur** — une fenêtre desktop de 700 px a un pointeur fin
et un survol qui marche, un iPad de 1024 px a besoin des grandes cibles.

**La règle du survol facultatif.** Toute affordance masquée en `opacity: 0`
jusqu'au survol doit être révélée sous `@media (hover: none), (pointer:
coarse)`. Au doigt, le geste qui la révèle n'existe pas : l'action n'est alors
pas discrète, elle est absente. Un doublon par appui long ne la remplace pas —
il n'est pas découvrable.

## Elevation & Depth

Le système est **étagé**, pas plat. La hiérarchie vient d'abord de la valeur
des fonds — toile < chrome < surface < élevé, un empilement lisible dans les
deux thèmes — puis d'un filet de 1 px, et enfin seulement d'une ombre. Mais
l'ombre est un vrai niveau du système, pas un accident réservé aux modales :
une carte au repos porte une ombre, la même carte survolée en porte une plus
haute, et ce mouvement de 1 px vers le haut est ce qui rend le board
manipulable plutôt qu'imprimé.

Cinq niveaux, et cinq seulement. Le sombre ne réutilise pas les valeurs du
clair : une ombre colorée en gris-bleu disparaît sur un fond #050507, donc le
thème sombre passe en noir pur et en rayon plus large.

### Shadow Vocabulary

- **Flat** (`box-shadow: none`, filet 1 px) : chrome et rangs — éléments de
  navigation, onglets, lignes de liste, barre d'outils. Ce qui est solidaire
  du panneau ne se soulève pas.
- **Rest** (`0 1px 2px rgba(16, 24, 40, 0.10)` · sombre `0 1px 2px rgba(0, 0, 0, 0.5)`) :
  cartes et panneaux flottants au repos.
- **Lifted** (`0 2px 6px rgba(16, 24, 40, 0.12)` + `translateY(-1px)` · sombre
  `0 2px 8px rgba(0, 0, 0, 0.6)`) : survol d'une carte cliquable, carte en
  cours de glissement. Toujours accompagné du déplacement de 1 px — l'ombre
  seule ne suffit pas à dire « saisissable ». Sous
  `prefers-reduced-motion: reduce`, le déplacement saute et l'ombre reste :
  c'est la partie décorative qui cède, pas le signal.
- **Floating** (`0 12px 32px rgba(16, 24, 40, 0.18)` · sombre
  `0 12px 32px rgba(0, 0, 0, 0.7)`) : menus contextuels, popovers, toasts,
  panneau de diff en surimpression.
- **Modal** (`--shadow-modal` : `0 20px 24px rgba(16, 24, 40, 0.18)` · sombre
  `0 20px 50px rgba(0, 0, 0, 0.7)`) : dialogues, toujours accompagnés du
  `--backdrop`.

### Named Rules

**La règle des cinq marches.** Cinq niveaux d'élévation existent. Une sixième
valeur d'ombre écrite à la main est une régression, pas une nuance.

**La règle du fond d'abord.** Avant d'ajouter une ombre, vérifier qu'un
changement de fond ou un filet ne dit pas déjà la même chose. L'ombre est le
troisième recours.

**La règle de l'encre sur l'étage.** Une ombre ne dispense jamais de
l'appariement remplissage/encre : un objet qui monte d'un étage garde le
token `-on` de son fond. Une ombre plus haute ne rend pas un texte plus
lisible, et un bouton primaire flottant n'a pas d'autre encre qu'un bouton
primaire posé.

## Shapes

Une géométrie sobre et resserrée, en quatre rayons. **4 px** est le rayon par
défaut, celui des boutons, des champs, des éléments de navigation et des
petits contrôles. **3 px** est le rayon des micro-objets — pastilles,
étiquettes, badges — dont un rayon plus grand ferait une gélule. **6 px** est
le rayon des cartes, **8 px** celui des modales : plus l'objet est grand et
détaché, plus le coin s'adoucit. **999 px** est réservé aux objets
délibérément ronds — point d'activité, compteur de navigation.

Les bordures sont toujours de 1 px, sauf une exception signifiante : le
**liseré de priorité de 3 px** sur le bord gauche des cartes, la seule
géométrie du système qui porte une information à elle seule.

Aucun rognage, aucune forme organique, aucune silhouette décorative. La
séparation par filet est préférée à la séparation par espace quand la densité
compte.

### Named Rules

**La règle des quatre rayons.** 3, 4, 6, 8 (plus la gélule). Les valeurs
5, 7, 10, 12 et 16 présentes dans le code sont des dérives à résorber, pas
des paliers.

## Components

Le toucher général : **sûr et discret**. Un contrôle au repos est calme —
fond transparent ou gris, filet fin, aucune ombre propre. Il répond en 120 ms
et son état se lit d'abord à la teinte de son fond. Les commandes s'effacent
derrière la donnée qu'elles pilotent.

### Buttons

- **Forme :** rayon de 4 px, remplissage `6px 12px` (`4px 8px` sur les
  variantes compactes dans une carte ou une barre d'outils).
- **Par défaut :** fond `--bg-hover`, filet `--border-strong`, texte
  `--text-body`. C'est la variante majoritaire ; un bouton n'est pas bleu par
  défaut.
- **Primaire :** fond `--accent`, texte `--accent-on`, même filet que le fond.
  Un seul par dialogue ou par barre d'action.
- **Survol / focus :** transition de 120 ms sur `background` et `color` ;
  `outline: 2px solid var(--accent)` avec `outline-offset: 2px` au
  `:focus-visible`. Le focus n'est jamais supprimé.
- **Désactivé :** fond `--text-muted`, texte `--text-inverse`,
  `cursor: not-allowed`. C'est la paire de remplissage neutre du système
  (5.34:1 en clair, 6.86:1 en sombre) ; `--text-subtle` n'est plus jamais un
  fond. Pendant une action en vol, le libellé passe à `…` et le curseur à
  `wait` — l'objet ne disparaît pas.
- **Boutons d'action de carte :** `▶` en `--success` sur encre
  `--success-on`, `✓ Appliquer` en `--apply` sur encre `--apply-on`,
  `× Rejeter` en `--danger-bg` sur filet `--danger`, qui s'inverse au survol
  en fond `--danger` sur encre `--danger-on`. Ces trois-là sont la seule
  concentration de couleur autorisée dans une carte — et les trois seules
  encres à ne jamais écrire à la main.

### Chips

- **Style :** fond `--bg-elevated`, texte `--text-secondary`, rayon 3 px,
  remplissage `1px 6px`, corps micro (10 px). Sert à nommer un dépôt, un
  scope, un modèle.
- **Badges de statut :** paire fond pâle / texte saturé issue du même token —
  `--success-bg`/`--success` (en marche), `--accent-bg`/`--accent-text` (en
  revue), `--warning-bg`/`--warning` (bloqué). Jamais de fond saturé.
- **Pastille de priorité :** 9 px, 700, capitales, fond plein de la rampe
  `--priority-*`, encre `--text-on-fill`. C'est le doublon accessible du
  liseré de gauche : la couleur seule ne porte jamais la priorité. La rampe a
  été assombrie pour que les deux objets passent leur seuil respectif — la
  pastille ses 4.5:1 de texte, le liseré ses 3:1 d'élément non textuel, sur
  les quatre fonds du système.

### Cards / Containers

- **Coins :** 6 px.
- **Fond :** `--bg-surface` ; les sous-tâches en cours virent à `--success-bg`.
- **Élévation :** *Rest* au repos, *Lifted* + `translateY(-1px)` au survol
  quand la carte est cliquable. Une carte verrouillée par un run en vol ne se
  soulève pas et passe en `cursor: not-allowed`.
- **Bordure :** aucune, sauf le liseré gauche de 3 px porteur de la priorité.
- **Remplissage :** `10px 12px`, séparations internes par filet
  `--border-subtle`, pas par espace.
- **Actions :** rangée alignée à droite en pied de carte, isolée par un filet
  supérieur. Le menu ⋮ est en opacité 0 et n'apparaît qu'au survol ou au
  focus du conteneur.

### Inputs / Fields

- **Style :** fond `--bg-input`, filet 1 px `--border-field`, rayon 4 px,
  remplissage `6px 8px`, corps 13 px, `font-family: inherit`. Le filet d'un
  champ est un contour de composant au sens WCAG 1.4.11 : il lui faut 3:1, ce
  que `--border-strong` ne donne pas.
- **Focus :** filet `--accent` doublé d'un halo `0 0 0 3px var(--accent-bg)`.
- **Erreur :** filet `--danger` et halo `--danger-bg`, message en 11 px sous
  le champ ; jamais un simple contour rouge sans texte.
- **Zones de texte :** `resize: vertical` uniquement.

### Navigation

- **Navigateur (gauche) :** liste verticale sur `--bg-muted`, rangs de
  `6px 10px`, rayon 4 px, gouttière de 1 px, corps 13 px. Icône en glyphe
  Unicode dans une gouttière fixe de 18 px, libellé tronqué par ellipse.
- **États :** survol `--bg-active` ; actif `--accent-bg` + `--accent-text` +
  600, avec l'icône qui passe en `--accent`. L'état actif est le seul endroit
  où la navigation prend de la couleur.
- **Compteur :** gélule alignée à droite, `--warning-bg` sur filet ambre
  translucide, 11 px / 700. Il ne s'affiche qu'au-dessus de zéro.
- **Onglets (console, inspecteur) :** soulignement de 2 px en `--accent` sur
  l'onglet actif, chevauchant le filet du conteneur ; onglet inactif en
  `--text-muted`, sans fond.

### La console (composant signature)

La bande basse est la seule surface qui reste sombre dans les deux thèmes :
`--console-bg` en fond, `--console-text` en texte, monospace 12 px, lignes
séparées par `--console-line`. Elle affiche le flux `events.ndjson` en direct —
appels d'outil, éditions de fichier, sortie d'agent. Elle se lit comme un
terminal parce que c'en est un ; ni carte, ni bulle, ni avatar. Le seul accent
autorisé à l'intérieur est le vert de marche sur la ligne active.

### La carte de tâche (composant signature)

Le seul objet du produit qui agrège six informations sans devenir un tableau :
liseré de priorité, point d'activité pulsant, titre, chips de dépôt, liste de
sous-tâches avec leur run et leur verrou, barre de progression dégradée et
rangée de statistiques. Sa règle de survie est la hiérarchie stricte des
corps — 14 px pour le titre, 12 px pour les sous-tâches, 11 px pour le méta,
10 px pour les chips — et le fait que tout ce qui est actionnable disparaît
tant que le pointeur est ailleurs.

### Named Rules

**La règle du mouvement porteur.** Le système distingue le mouvement qui
décore du mouvement qui informe, et ne les traite jamais ensemble. Décoratif :
le déplacement de 1 px au survol, le glissement d'entrée d'un toast. Porteur :
le halo qui pulse pendant qu'un agent tourne, le spinner d'une requête en vol,
l'avancement d'une barre de progression. Sous
`prefers-reduced-motion: reduce`, le décoratif disparaît et le porteur est
**converti, pas supprimé** — le halo devient un anneau statique qui se
distingue toujours d'un point au repos, le spinner ralentit sans s'arrêter.
Le `* { animation: 0.01ms !important }` global est explicitement interdit dans
ce dépôt : sur ce board, il effacerait le seul signal disant « un agent
travaille en ce moment ». Un chargement sans aucun signal est pire que du
mouvement.

**La règle des trois durées.** `--state` 120 ms ease pour tout changement
d'état, `--reveal` 100 ms ease pour l'apparition d'un contrôle latent,
`progress` 400 ms ease-out pour une barre d'avancement. Ce sont des durées
canoniques documentées, pas des variables CSS : elles ne sont pas tokenisées
tant que les onze transitions du dépôt ne sont pas alignées, parce qu'un token
que personne ne consomme ment sur l'état réel du code. Écrire une quatrième
durée est une dérive ; les tokeniser est un chantier à part.

## Do's and Don'ts

### Do:

- **Do** ne peindre que ce qui porte un statut. Le gris est l'état normal
  d'un objet au repos.
- **Do** doubler toute information portée par la couleur d'un texte ou d'un
  glyphe : la pastille P0 double le liseré, le badge « ▶ 2 » double le point
  vert.
- **Do** consommer les tokens de `src/app.css` — y compris les nouveaux
  `--apply`, `--apply-hover` et `--priority-p0…p3` — et vérifier chaque écran
  dans les deux thèmes avant de le considérer fini.
- **Do** apparier tout remplissage saturé avec son token `-on`
  (`--accent-on`, `--success-on`, `--warning-on`, `--danger-on`,
  `--apply-on`) ; ne jamais poser `--text-on-fill` sur un fond qui s'éclaircit
  en thème sombre.
- **Do** rester dans les quatre rayons (3 / 4 / 6 / 8) et les cinq marches
  d'élévation.
- **Do** garder le monospace pour les identifiants machine, et le
  sans-serif pour tout ce qu'un humain a écrit ou compté.
- **Do** faire céder les panneaux avant le canvas quand la largeur manque.
- **Do** router chaque chaîne visible par `t()`, dans `en.json` **et**
  `fr.json`, dès la première écriture.

### Don't:

- **Don't** enrichir visuellement un composant qui fait déjà son travail.
  Un composant trop riche est un défaut, pas une amélioration : chaque
  élément ajouté doit remplacer quelque chose ou porter une information que
  rien d'autre ne porte. C'est le refus explicite de ce système.
- **Don't** empiler les indicateurs sur un même état — un point pulsant, un
  badge, une barre et un libellé qui disent tous « en cours » se neutralisent.
  Un état, un signal principal, un doublon accessible au plus.
- **Don't** écrire une valeur de couleur littérale dans un composant.
- **Don't** utiliser `--text-subtle` pour du texte lisible, ni comme fond.
  C'est le plancher 3:1 des glyphes désactivés, des séparateurs décoratifs et
  des contours de composants — rien d'autre.
- **Don't** introduire une police, une icône bitmap, une image ou toute autre
  ressource distante : le board est embarqué dans un binaire et ne fait
  aucune requête sortante.
- **Don't** ajouter un sixième niveau d'ombre ou un cinquième rayon.
- **Don't** descendre sous 10 px, ni utiliser 10 px hors capitales espacées.
- **Don't** ajouter un point de rupture hors des trois seuils visés
  (640 / 900 / 1280 px).
- **Don't** appliquer le fond sombre de la console à une zone de saisie
  humaine, ni éclaircir la console en thème clair.
- **Don't** introduire une mise en page promotionnelle — héros, colonnes
  centrées, illustration d'ambiance — à l'intérieur de l'application.
