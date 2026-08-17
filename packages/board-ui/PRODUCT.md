# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Un seul utilisateur : le propriétaire du fork, développeur, qui pilote ses
propres agents Claude Code sur ses propres dépôts. Pas d'onboarding pour
inconnus, pas de rôles, pas de coordination entre humains — `users.yaml`
existe dans le domaine mais n'est pas un scénario d'usage réel ici.

Le travail qu'il fait devant le board : décrire une intention, la découper en
subtasks par dépôt, lancer des runs, **surveiller** ce que les agents font en
direct, puis relire diffs et commits pour accepter ou rejeter.

## Product Purpose

Le board est la surface visuelle de Backlog, orchestrateur local d'agents de
code. Il rend observable et pilotable ce qui se passe sinon en aveugle dans un
terminal : quelles tâches attendent, quels agents tournent, quels fichiers sont
verrouillés par un claim, quel outil l'agent appelle à cet instant, et ce que
le run a réellement produit.

Réussite : l'utilisateur sait, en un coup d'œil, si le système avance, s'il est
bloqué, et où intervenir — sans lire de logs.

## Positioning

Tout est local : fichiers sur disque (`.backlog/`), serveur HTTP local, binaire
unique, aucun backend hébergé. La couche cloud héritée de l'amont est
neutralisée et ne doit jamais être réanimée dans l'UI.

Le différenciateur exécutable : les **claims** (verrous de fichiers appliqués
au commit par un hook git) et les **worktrees isolés** permettent plusieurs
agents en parallèle sur le même dépôt sans collision. Le board est le seul
endroit où cet état concurrent devient lisible.

Claude Code est l'exécuteur de référence, pas un provider parmi d'autres. Les
autres exécuteurs restent fonctionnels mais ne dictent plus la conception.

## Operating Context

Le board est regardé dans quatre scènes réelles, toutes légitimes :

1. **Demi-écran à côté du terminal** (~700–900 px de large) — surveillance
   pendant que les agents tournent. C'est la scène la plus fréquente.
2. **Plein écran, 1440 px et plus** — session de pilotage dédiée : lecture de
   diffs, revue de runs, gestion des dépôts.
3. **Second écran, en ambiance** — affiché en permanence, lu de loin :
   l'état global doit se lire sans zoomer ni cliquer.
4. **Mobile / tablette** — consultation à distance pour vérifier l'avancement.

Le flux de travail encadrant : le dépôt git est la vérité, l'utilisateur
travaille en parallèle dans son éditeur et son terminal, et le board partage
l'écran avec eux plutôt que de le monopoliser.

## Capabilities and Constraints

**Vocabulaire du domaine** (contraignant, y compris dans les libellés) :
project · repository · task · subtask · run · claim · agent · orchestrator.
Jamais « repo », jamais « workspace » dans une nouvelle copie visible.

**Surfaces existantes** : board kanban (tasks/subtasks), claims, runs et leur
flux d'événements en direct, commits et diffs, dépôts, agents, orchestrateur,
hooks git, intégrations, réglages, usage.

**Contraintes techniques qui touchent le design :**

- Svelte 5 avec runes ; l'UI est compilée par Vite puis **embarquée dans le
  binaire**. Les noms de fichiers d'assets sont figés (pas de hash) et chaque
  nouvel asset doit être importé explicitement.
- Toute chaîne visible passe par `t()` et existe dans `i18n/en.json` **et**
  `i18n/fr.json` (1119 clés, alignées).
- Deux thèmes à parité, pilotés par les tokens de `src/app.css`
  (`data-theme="dark"`). Aucune valeur hex en dur dans un composant.
- L'état arrive par SSE (`/api/v1/events`) et par `events.ndjson` : l'UI doit
  supporter le flux continu, la reconnexion, et le silence prolongé.
- Une seule frontière réseau : le serveur local. Aucune ressource distante
  (police, CDN, image) ne doit être introduite.

**Contraintes de comportement produit :**

- Retirer un dépôt = le détacher de Backlog. Jamais supprimer de fichiers,
  jamais de cascade.
- Toute opération git destructrice exige une confirmation explicite.
- Un claim expiré ne doit jamais bloquer un commit.

**Non décidé :** aucune stratégie de découpage de code ni de tests UI n'est
arrêtée ; le bundle est aujourd'hui monolithique et non testé côté interface.

## Brand Commitments

Nom : **Backlog**. Fork personnel de osmove/backlog (Apache-2.0), en
divergence assumée. Aucun logo, aucune identité graphique héritée à préserver.

Registre : outil d'opérateur. Dense, factuel, proche d'un Linear / Xcode /
GitHub sombre. Aucune mise en page promotionnelle, aucun argumentaire, aucune
illustration décorative à l'intérieur de l'application.

Langues de l'interface : anglais et français, à parité.

## Evidence on Hand

- Code de l'interface : `packages/board-ui/src` (~29 k lignes, `App.svelte`
  seul en fait 2026).
- Tokens de thème réels et commentés : `packages/board-ui/src/app.css`.
- Catalogue de chaînes : `packages/board-ui/src/lib/i18n/{en,fr}.json`.
- Référence produit et architecture : `CLAUDE.md` à la racine, plus
  `docs/DEVELOPMENT.md` et `docs/TROUBLESHOOTING.md`.

Absences à ne jamais combler par invention : aucun client, aucun témoignage,
aucun chiffre d'adoption, aucun benchmark, aucune offre payante, aucun compte.
Le produit n'est ni publié ni vendu.

## Product Principles

1. **L'état avant l'action.** La valeur du board est de rendre lisible un
   système concurrent. Ce qui tourne, ce qui bloque et ce qui attend doit se
   lire avant tout contrôle.
2. **Simplicité de l'interface.** Priorité explicite du propriétaire :
   simplifier plutôt qu'ajouter, et corriger les défauts visuels existants
   plutôt que d'empiler de nouveaux écrans. Une 153ᵉ fonctionnalité ne vaut
   pas un flux enfin fini.
3. **Densité d'outil, jamais de marketing.** L'interface est un poste de
   pilotage. La personnalité passe par la précision des détails, pas par la
   décoration.
4. **Local jusqu'au pixel.** Rien ne sort de la machine : pas de compte, pas
   de télémétrie, pas d'asset distant. Le design ne doit jamais suggérer un
   service hébergé.
5. **Bilingue et bi-thème par construction.** EN/FR et clair/sombre ne sont
   pas des variantes à valider en fin de course : une surface non traduite ou
   cassée en sombre n'est pas terminée.

## Accessibility & Inclusion

Aucune obligation réglementaire. Exigences issues de l'usage réel :

- **Lisible de loin** (scène « second écran ») : les états critiques ne
  doivent pas dépendre d'un texte de 11 px ni de la couleur seule.
- **Lisible en fenêtre étroite** : le board doit rester utilisable autour de
  700–900 px, et consultable sur mobile.
- Le clavier et les rôles ARIA sont déjà présents par endroits
  (`aria-label`, `aria-modal`, focus des dialogues) et doivent le rester.
