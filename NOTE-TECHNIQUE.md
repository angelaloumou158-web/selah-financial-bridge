# NOTE TECHNIQUE — Selah Financial Bridge (version 3.0.1)

**Équipe : DAE TECH DAME** — SAFINUM Innovate Challenge

Extension Chrome qui rend un service financier numérique compréhensible en **Pidgin camerounais**, **Duala** et **Fulfulde**, sans modifier le code du service. Prototype du SAFINUM Innovate Challenge (équipe DAE TECH DAME). Toutes les opérations sont simulées.

## Objectif : écouter, c'est comprendre
Beaucoup de personnes connaissent bien leur langue **parlée** mais pas sa version **écrite**. Pour elles, un texte traduit ne suffit pas. Le cœur de Selah est donc la **synthèse vocale** : le bouton *Écouter* lit la page dans la langue de l'utilisateur, pour que les locuteurs natifs comprennent réellement les montants, les frais et les avertissements, et pour aider aussi les personnes qui ne voient pas.

La **commande vocale** est un plus technologique : elle montre que l'outil peut aussi dialoguer, même avec quelques mots (*solde*, *frais*, *transfert*, etc.). Elle ne remplace pas la lecture à voix haute et ne rend pas encore l'outil entièrement utilisable sans la vue (le bouton *Parler* doit encore être activé).

## Contenu du dossier

| Dossier / fichier | Rôle |
|---|---|
| `extension/` | L'extension à installer dans Chrome (manifest, scripts, dictionnaires, voix). |
| `demo/test-banque.html` | Interface bancaire simulée pour la démonstration (code de démonstration : `1234`). |
| `docs/` | `GLOSSAIRE-TRADUCTIONS.html` (toutes les traductions, pour la vérification linguistique) et pages d'écoute des voix Pidgin et Duala. |
| `sources-audio/` | Enregistrements d'origine (traçabilité, non utilisés par l'extension). |
| `LICENCE` | Licence du projet. |

## Installation (environ 2 minutes)
1. Ouvrir `chrome://extensions` dans Chrome (version 139 ou plus récente conseillée).
2. Activer le **Mode développeur** (en haut à droite).
3. Cliquer sur **Charger l'extension non empaquetée** et choisir le dossier **`extension`** (celui qui contient `manifest.json`). Supprimer d'abord toute ancienne version de Selah.
4. Pour tester avec le microphone, ouvrir `demo/test-banque.html` depuis `http://localhost` (par exemple avec VS Code Live Server) et autoriser le microphone. Une page ouverte en `file://` peut bloquer la reconnaissance vocale.

## Utilisation
- **Langue du popup** : le popup de l'extension s'affiche en anglais quand la page est en anglais, en français sinon. Les boutons FR | EN en haut à droite permettent de changer ; rouvrir le popup ou recharger la page rétablit la détection automatique.
- **Traduction** : ouvrir la page, cliquer sur l'icône Selah, choisir Pidgin, Duala ou Fulfulde. Les montants, frais, noms de bénéficiaires et avertissements de sécurité sont recopiés tels quels.
- **Langue du site (démo)** : à l'arrivée sur `demo/test-banque.html`, une fenêtre demande si le site doit s'afficher en français ou en anglais. L'extension reconnaît automatiquement la langue de la page (français et anglais sont utilisés ensemble) et traduit vers Pidgin, Duala ou Fulfulde.
- **Panneau Selah** : il s'ouvre en bas à gauche, se déplace en faisant glisser son titre et se réduit avec le bouton « – » pour ne pas cacher le site.
- **Écouter** : lit la page. Pidgin et Duala utilisent les voix enregistrées par l'équipe (une phrase n'est lue que si le texte affiché est identique à la phrase enregistrée). Fulfulde utilise la voix française du navigateur.
- **Commande vocale** (français ou anglais) : appuyer sur Parler, puis dire *solde*, *frais*, *transfert*, *récapitulatif*, *avertissement*, *répéter* ou *aide*. Selah répond à voix haute et par écrit. Elle ne valide jamais une opération.
- **Contenu inédit** : les messages ajoutés par le jury sont traduits s'ils figurent dans les dictionnaires (voir `docs/GLOSSAIRE-TRADUCTIONS.html`) ou s'ils suivent un modèle connu (« Transfert de {montant} vers {nom} »). Un texte inconnu reste dans sa langue d'origine, sans traduction inventée.

## Mode hors ligne
La reconnaissance vocale se fait sur l'ordinateur, sans Internet, quand le modèle de langue de Chrome est installé. Une fois, avec Internet : ouvrir la commande vocale, appuyer sur Parler et dire « solde » ; le modèle se télécharge. Le symbole 📴 s'affiche ensuite à côté de la phrase entendue. Sans le modèle, Selah utilise la reconnaissance en ligne de Chrome. Traductions, voix Pidgin/Duala et icônes fonctionnent sans Internet. Non disponible sur ChromeOS.

## Langues et voix
| Langue | Origine de la traduction | Voix |
|---|---|---|
| Pidgin camerounais | recherches en ligne (Google, mode IA), relues par une membre de l'équipe locutrice du pidgin | 62 clips enregistrés (`extension/audio/pidgin/`) |
| Duala | attestée du centre d'initiation à la culture Duala (CIDE-COLAD), dictionnaire en ligne Glosbe, mode IA de Google | 62 clips enregistrés, dont 1 muet (« Jěmea », seul, à réenregistrer) ; 16 clips ont été réenregistrés avec les mots vérifiés (`extension/audio/duala/`) |
| Fulfulde | mode IA de Google, confirmé par un locuteur fulfulde | voix française du navigateur |

Les voix Pidgin et Duala sont enregistrées par les membres de l'équipe. Les clips ont été découpés dans les enregistrements d'origine, nettoyés (bruit, volume) et sont écoutables dans `docs/verifier-voix-pidgin.html` et `docs/verifier-voix-duala.html`.

## Validation linguistique
Les traductions ont été préparées avec des outils d'aide en ligne (moteurs de recherche, mode IA de Google, dictionnaire Glosbe), **puis vérifiées par des personnes réelles, locutrices de chaque langue** :

| Langue | Outils d'aide | Vérification humaine |
|---|---|---|
| Fulfulde | recherches en ligne, mode IA de Google | une connaissance de l'équipe qui parle le fulfulde a relu et confirmé les traductions |
| Duala | recherches en ligne, dictionnaire Glosbe, mode IA de Google | une personne formée au centre d'initiation à la culture Duala (CIDE-COLAD), titulaire d'une attestation du centre (elle est donc qualifiée pour enseigner la langue), a fourni et vérifié les mots et phrases |
| Pidgin camerounais | recherches en ligne, mode IA de Google | Emmanuelle, membre de l'équipe locutrice du pidgin, a relu et vérifié phrase par phrase |

- **Principe** : aucun moteur de recherche ni outil d'IA n'a été considéré comme suffisant seul ; chaque langue a été vérifiée auprès d'au moins une personne qui la parle.
- **Voix** : enregistrées par des membres de l'équipe, puis vérifiées à l'écoute avec les pages de `docs/`.
- **Règle appliquée dans l'extension** : les montants, frais, noms de bénéficiaires et avertissements de sécurité ne sont jamais retraduits ni modifiés. Une phrase absente des dictionnaires reste dans sa langue d'origine plutôt que d'être inventée.
- **Limite** : cette vérification est celle d'une équipe de bénévoles, pas d'une validation académique ou institutionnelle.

## Architecture
- `content.js` : traduction de la page (textes, boutons, phrases à trous, mutations de la page), lecture vocale, commande vocale, panneau Selah. S'exécute dans la page, sans toucher au code du service.
- `popup.html` / `popup.js` : choix de la langue, lecture, ouverture de la commande vocale.
- `dictionaries/` : un fichier par langue (traductions, modèles à trous, fragments).
- `audio/` : clips vocaux et `clips.json` (texte exact de chaque clip).
- Permissions : `activeTab`, `scripting`. Aucun serveur, aucune donnée collectée, aucune API payante.

## Composants tiers déclarés
- API Web Speech de Chrome (reconnaissance et synthèse vocales), fournie par le navigateur. En mode en ligne, l'audio du micro peut être envoyé au fournisseur du navigateur : ne jamais dire de données confidentielles pendant la démonstration.
- Outils d'aide à la traduction utilisés pendant le développement (hors de l'extension) : mode IA de Google, dictionnaire en ligne Glosbe.
- Outil de traitement audio ffmpeg, utilisé une seule fois pour découper et nettoyer les enregistrements (non inclus dans l'extension).
- Aucune bibliothèque externe dans l'extension ni dans la page de démonstration.

## Sécurité
- Opérations exclusivement simulées : aucun compte réel, aucun mot de passe réel.
- Le solde est **masqué par défaut** ; pour l'afficher, il faut saisir le mot de passe de démonstration. L'envoi d'un transfert demande aussi le mot de passe. Même sur une page simulée, ce choix montre l'attention portée aux détails de sécurité.
- Le solde masqué n'est jamais révélé par Selah.
- Selah ne valide, ne paie et ne confirme jamais à la place de l'utilisateur.

## Améliorations futures
- **Traduction automatique de n'importe quel site**, même quand les mots ne sont pas dans notre bibliothèque, grâce à un modèle d'IA entraîné sur les mots et phrases déjà rassemblés, tout en gardant la règle de ne jamais modifier montants, frais, bénéficiaires et avertissements.
- **Enrichir les dictionnaires** avec davantage de mots et de phrases financières, vérifiés par des locuteurs.
- Ajouter d'autres langues nationales camerounaises.
- Rendre la commande vocale utilisable sans clic (activation à la voix), pour une vraie accessibilité aux personnes aveugles.

## Limites connues
- Un texte absent des dictionnaires et ne suivant aucun modèle connu n'est pas traduit.
- La commande vocale dépend de la reconnaissance de Chrome et de l'accent ; parler lentement, un mot à la fois.
- Le contenu des iframes est traduit mais pas lu par la commande vocale.
- Chrome sur Android ne gère pas les extensions.
- Les traductions doivent être validées par des locuteurs compétents avant tout usage réel.
