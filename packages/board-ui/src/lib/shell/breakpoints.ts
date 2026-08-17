// Les trois seuils du système (DESIGN.md, « La règle des trois seuils »).
// Le shell n'utilise que NARROW et COMPACT ; WIDE est un seuil de vue feuille
// (bascule deux-panes → trois-panes). Les @media des vues feuilles DOIVENT
// répéter ces littéraux — CSS ne peut pas importer une constante TS. Aucun
// autre nombre n'a le droit d'apparaître dans un @media du board-ui.
export const BP_NARROW = 640;
export const BP_COMPACT = 900;
export const BP_WIDE = 1280;
