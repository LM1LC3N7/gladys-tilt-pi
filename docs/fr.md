# Tilt Pi

**Connecteur non officiel, sans lien avec Tilt Hydrometer (Baron Brew
Equipment).** Il amène dans Gladys les densimètres **Tilt** qui flottent
dans vos fermenteurs (bière, vin, cidre, hydromel...), lus par l'application
**Tilt Pi** installée sur un Raspberry Pi de votre réseau, par son API HTTP
locale, sans cloud.

> **Cette intégration n'a jamais été testée avec un vrai Tilt Pi.** Elle suit
> la bibliothèque `tilt-pi` qu'utilise l'intégration Tilt Pi de Home
> Assistant. Merci de signaler ce que vous constatez sur le forum de Gladys.

## Ce qu'il faut

- Un ou plusieurs **Tilt** (ou Tilt Pro, Tilt HD).
- Un **Raspberry Pi avec l'application Tilt Pi** (l'image officielle Tilt
  Pi), sur le même réseau que Gladys, qui affiche vos Tilt sur sa page web
  (`http://<adresse du Raspberry Pi>:1880/`). C'est le Tilt Pi qui écoute
  les Tilt en **Bluetooth**, sur son Raspberry Pi : Gladys n'utilise jamais
  le Bluetooth (une intégration Gladys tourne dans un conteneur sans
  Bluetooth).

## Ce que vous obtenez

Un appareil Gladys par **couleur** de Tilt (« Tilt Red », « Tilt Blue »...) :

| Fonction              | Unité                  | Remarques                                                 |
| --------------------- | ---------------------- | --------------------------------------------------------- |
| Specific gravity (SG) | aucune (« SG » au nom) | la densité, environ 1,000 pour l'eau                      |
| Temperature           | °C                     | une sonde : hors de la moyenne de température de la pièce |

- Gladys n'a ni catégorie ni unité pour une densité : la densité est un
  capteur « inconnu » sans unité, l'unité (SG) est seulement écrite dans son
  nom. Aucune unité n'est inventée.
- La couleur est l'identité d'un Tilt sur un Tilt Pi : l'appareil d'une
  couleur reste le même, même si vous changez de Tilt de cette couleur.
- Les noms des fonctions sont en anglais ; renommez-les à la création si vous
  le souhaitez.

## Installation

1. Installez l'intégration depuis le catalogue de Gladys (Gladys 5.1 ou
   plus récent).
2. Dans l'écran **Configuration**, saisissez l'**adresse du Tilt Pi**
   (l'adresse IP du Raspberry Pi, par exemple `192.168.1.30`, avec
   `:port` seulement si ce n'est pas 1880).
3. Cliquez sur **Tester le Tilt Pi** : le message affiche la densité et la
   température de chaque Tilt.
4. Ouvrez l'onglet **Découverte** et ajoutez les appareils.

## Configuration

- **Adresse du Tilt Pi** : une adresse IP ou un nom, avec un port s'il
  n'est pas 1880 ; `http://` est accepté, pas `https://` (la page du Tilt Pi
  n'en a pas), ni chemin, ni utilisateur. Donnez au Raspberry Pi une adresse
  fixe dans votre box. Une nouvelle adresse est lue tout de suite (au plus
  une requête par minute).
- **Intervalle de lecture** : 5 minutes par défaut, de 1 à 60.
- Pas de réglage d'unité : l'API du Tilt Pi donne toujours la température
  en °F, même quand sa page affiche des °C (c'est ce que fait le flux
  officiel de l'application). L'intégration la convertit en °C, et Gladys
  l'affiche dans l'unité de votre profil. Si la température de l'API ne
  correspond pas à celle qu'affiche la page du Tilt Pi, elle n'est pas
  envoyée et le statut le signale.

## À quel rythme le Tilt Pi est lu

- Une lecture envoie **une requête** : `GET /macid/all` (tous les Tilt
  entendus par le Tilt Pi).
- **Jamais plus vite que l'intervalle**, compté depuis la dernière lecture
  sur une horloge monotone (un changement d'heure ne fait pas relire plus
  tôt) : ni par le bouton de test, ni par une reconnexion à Gladys, ni par
  une configuration enregistrée sans changement, ni par l'onglet Découverte,
  ni par un redémarrage du conteneur (l'heure de la dernière requête est
  gardée sous `/data`, écrite avant que la requête parte). Avant la fin de
  l'intervalle, le bouton de test affiche les dernières valeurs et l'heure
  de la prochaine lecture possible.
- **Lecture seule** : l'intégration n'écrit jamais rien sur le Tilt Pi.
- Quand le Tilt Pi répond **429 ou une erreur 5xx**, il est laissé
  tranquille pendant le délai `Retry-After` donné, sinon 5 minutes, puis 10,
  20... ; toujours entre 1 minute et 6 heures, aussi après un redémarrage.
- **Aucun Tilt entendu** (entre deux brassins, ou quand le Tilt Pi vient de
  vider ses emplacements après un Tilt muet plus de 2 minutes) est un cas
  normal : le Tilt Pi répond `{}`, le statut reste connecté et les Tilt
  connus passent en « pas de mesure récente ».
- Pas de réponse, une page qui n'est pas celle d'un Tilt Pi (404, réponse
  qui n'est ni une liste ni `{}`) ou un accès refusé : réessayé à l'intervalle
  suivant seulement.

## Quelles valeurs arrivent dans Gladys

- Chaque mesure n'est remise à Gladys **qu'une fois**. Une mesure est
  reconnue à son heure (`timeStamp`, que le Tilt Pi donne toujours), sinon à
  sa température, sa densité, son adresse MAC et son `timeStamp` brut
  (jamais au signal ni aux champs d'horloge que le Tilt Pi réécrit sans
  nouvelle mesure).
- Une mesure de 3 minutes au plus est envoyée comme valeur actuelle ; de 3
  à 15 minutes, elle est envoyée **datée** (Gladys l'enregistre à son heure
  et aucune scène ne se déclenche).
- Un Tilt **muet** (hors de portée, pile vide, sorti du fermenteur) n'est
  **jamais présenté comme vivant** : quand sa mesure ne change plus, rien
  n'est envoyé, et le statut affiche « pas de mesure récente ». Une mesure
  datée de plus de 15 minutes, mesurée avec l'horloge du Tilt Pi (la `Date`
  de sa réponse, l'âge seul décide : un Raspberry Pi remis à une heure
  ancienne ne fait perdre aucune mesure), n'est jamais envoyée. Sans heure, la première mesure vue
  d'un Tilt n'est pas envoyée : seule une mesure qui a changé depuis la
  lecture précédente prouve que le Tilt est vivant.
- Une valeur hors bornes (densité hors de 0,950 à 1,200, température hors de
  -10 à 60 °C, ce qu'un moût peut atteindre) n'est jamais envoyée ni
  ramenée dans les bornes ; le statut la signale. Les 0 °F que le Tilt Pi
  donne quand son étalonnage échoue sont ainsi écartés.
- **Deux Tilt de la même couleur** : sans l'option « ID by MAC » du Tilt Pi,
  celui-ci n'a qu'une entrée par couleur, remplie tour à tour par les deux.
  L'intégration garde une empreinte de l'adresse MAC de chaque couleur : si
  elle change, rien n'est envoyé pour cette couleur et le statut affiche
  « MAC changée : deux Tilt de cette couleur, ou Tilt remplacé ». Les
  valeurs reprennent quand la même nouvelle adresse est lue deux fois de
  suite (un Tilt remplacé) ; deux Tilt qui alternent ne reprennent jamais.
  Activez plutôt l'option **« ID by MAC »** du Tilt Pi : chaque Tilt a alors
  son entrée (`RED:aa:bb:...`), lue comme la couleur rouge ; si deux entrées
  ont la même couleur, aucune n'est envoyée (« deux Tilt de cette
  couleur »).
- Un appareil créé plus tard reçoit la dernière mesure, datée, si elle a
  moins de 15 minutes.

## Ce qui est gardé sous `/data`

L'adresse lue, l'heure de la dernière requête, la pause, et pour chaque
couleur rencontrée la clé de la dernière mesure vue (son heure, ou une
empreinte courte de l'entrée) et une empreinte de 8 caractères de l'adresse
MAC du Tilt (jamais l'adresse en clair), jamais les valeurs. Le fichier est écrit au plus une fois par minute, sauf pour une
pause ou une nouvelle couleur.

8 couleurs au plus ; 50 entrées au plus sont lues ; une réponse de plus de
256 Ko, ou de plus de 15 secondes, est abandonnée.

## Identifiants externes

`ext:tilt-pi:tilt:<couleur>` (`black`, `blue`, `green`, `orange`, `pink`,
`purple`, `red`, `yellow`), puis `:gravity` ou `:temperature`. Ces
identifiants ne changent jamais.

## Dépannage

- **« pas de réponse »** : vérifiez l'adresse et que la page
  `http://<adresse>:1880/` du Tilt Pi s'ouvre depuis votre réseau.
- **« pas de Tilt Pi à cette adresse (404) »** : un autre service répond à
  cette adresse ; vérifiez le port.
- **« pas de mesure récente »** : le Tilt Pi n'a pas entendu ce Tilt
  récemment (portée Bluetooth, pile, Tilt couché hors du liquide).
- Journaux : le niveau se règle avec la variable `LOG_LEVEL`.

## Vie privée

L'intégration ne parle qu'au Tilt Pi, sur votre réseau local, en HTTP. Elle
ne garde des réponses que la couleur, la densité et la température.

## Crédits

Construite d'après [michaelheyman/tilt-pi](https://github.com/michaelheyman/tilt-pi)
(MIT, Michael Heyman), la bibliothèque de l'intégration Tilt Pi de Home
Assistant : la route, les champs et leurs unités sont portés en JavaScript.
Sa notice est dans `THIRD_PARTY_NOTICES.md`. Tilt est une marque de son
propriétaire ; ce connecteur est gratuit et non officiel.
