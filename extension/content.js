(() => {
  if (window.__safinumTranslatorInstalled) return;
  window.__safinumTranslatorInstalled = true;

  let currentTarget = null;
  let currentSource = "fr";
  let dictionary = {};
  let originalNodes = new WeakMap();
  let originalAttributes = new WeakMap();
  let observer = null;
  let translating = false;
  let templateTimer = null;
  let lastVoiceMessage = "";

  const normalize = value => (value || "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  let templates = {};
  let fragments = {};
  let fragmentRe = null;
  let templateOriginals = new Map();

  // Normalise les clés (apostrophes, espaces, majuscules) pour que "l’extension" et "l'extension" soient équivalents.
  function prepareDictionary(raw) {
    const out = {};
    for (const [k, v] of Object.entries(raw || {})) out[normalize(k)] = v;
    return out;
  }

  // Garde-fou financier : les chiffres d'un texte traduit doivent être identiques à ceux de l'original.
  // Montant avec devise avant ou après : « 25 000 FCFA », « XAF 150,000 », « $20 ».
  const CUR = "(?:fcfa|f\\s?cfa|xaf|xof|eur|€|usd|\\$)";
  const NUM = "(?:\\d[\\d\\s.,]*\\d|\\d)";
  const MONEY_SRC = `(?:${CUR}\\s*${NUM}|${NUM}\\s*${CUR})`;

  const digitsOf = text => ((text || "").match(/\d+/g) || []).join("|");

  function rememberNode(node) {
    if (!originalNodes.has(node)) originalNodes.set(node, node.nodeValue);
    return originalNodes.get(node);
  }

  function rememberAttribute(element, attr) {
    let saved = originalAttributes.get(element);
    if (!saved) {
      saved = {};
      originalAttributes.set(element, saved);
    }
    if (!(attr in saved)) saved[attr] = element.getAttribute(attr);
    return saved[attr];
  }

  // Cherche la traduction d'un texte : phrase exacte, ou phrase avec « : » final,
  // ou phrase contenant des montants (« Transfert de {1} effectué. ») : les montants sont recopiés tels quels.
  function resolveText(original) {
    const key = normalize(original);
    if (!key) return null;
    if (hasOwn(dictionary, key)) return dictionary[key];
    const base = key.replace(/\s*:\s*$/, "");
    if (base !== key && hasOwn(dictionary, base)) {
      return dictionary[base] + (original.trim().match(/\s*:\s*$/) || [":"])[0];
    }
    const tokens = [];
    const pattern = original.trim().replace(new RegExp(MONEY_SRC, "gi"), m => { tokens.push(m); return "{" + tokens.length + "}"; });
    if (tokens.length) {
      const k = normalize(pattern);
      if (hasOwn(dictionary, k)) return dictionary[k].replace(/\{(\d+)\}/g, (m, i) => tokens[i - 1] !== undefined ? tokens[i - 1] : m);      // « Solde après opération : {1} » : libellé connu + « : » + montant recopié tel quel.
      const lab = pattern.match(/^(.*?)(\s*:\s*)(\{\d+\})$/);
      if (lab && hasOwn(dictionary, normalize(lab[1]))) {
        return dictionary[normalize(lab[1])] + lab[2] + lab[3].replace(/\{(\d+)\}/, (m, i) => tokens[i - 1]);
      }
    }
    return translateFragments(original);
  }

  // Petits mots de liaison (« vers », « Frais : », « Nouveau solde : ») traduits à l'intérieur d'une phrase
  // dont le reste est uniquement composé de montants et de noms propres (mots à majuscule), laissés intacts.
  function buildFragmentRe() {
    const keys = Object.keys(fragments).sort((a, b) => b.length - a.length);
    if (!keys.length) { fragmentRe = null; return; }
    const esc = k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    fragmentRe = new RegExp(`(${MONEY_SRC})|(?<![\\p{L}\\d])(${keys.map(esc).join("|")})(?![\\p{L}\\d])`, "giu");
  }
  const onlyNames = gap => gap.replace(/[\s.,:;!?'"()\-–]+/g, " ").trim().split(" ").filter(Boolean).every(w => /^\p{Lu}/u.test(w));
  function translateFragments(text) {
    if (!fragmentRe) return null;
    let out = "", last = 0, used = 0;
    for (const m of text.matchAll(fragmentRe)) {
      const gap = text.slice(last, m.index);
      if (!onlyNames(gap)) return null;
      out += gap + (m[1] ? m[1] : fragments[normalize(m[2])]);
      if (!m[1]) used++;
      last = m.index + m[0].length;
    }
    const tail = text.slice(last);
    if (!used || !onlyNames(tail)) return null;
    return out + tail;
  }

  function translateTextNode(node) {
    const original = rememberNode(node);
    const result = resolveText(original);
    if (result === null) return false;
    const translated = original.replace(original.trim(), () => result);
    // Ne réécrit pas un nœud déjà traduit (évite les boucles du MutationObserver).
    if (node.nodeValue === translated) return false;
    // Sécurité : jamais de changement de chiffres.
    if (digitsOf(original) !== digitsOf(translated)) return false;
    node.nodeValue = translated;
    return true;
  }

  const textAttributes = ["placeholder", "title", "aria-label", "alt"];

  function translateElement(element) {
    let count = 0;
    const isButtonInput = element.tagName === "INPUT" && /^(button|submit|reset)$/i.test(element.getAttribute("type") || "");
    for (const attr of (isButtonInput ? [...textAttributes, "value"] : textAttributes)) {
      if (!element.hasAttribute(attr)) continue;
      const original = rememberAttribute(element, attr);
      const key = normalize(original);
      if (Object.prototype.hasOwnProperty.call(dictionary, key) && element.getAttribute(attr) !== dictionary[key]) {
        element.setAttribute(attr, dictionary[key]);
        count++;
      }
    }
    return count;
  }

  // Phrases à trous : « Confirmez l'envoi de {1} vers {2}. » — les éléments (montant, nom) sont réutilisés tels quels.
  function applyTemplates(root) {
    if (!root || !Object.keys(templates).length || !root.querySelectorAll) return 0;
    let count = 0;
    for (const el of root.querySelectorAll("p,div,span,li,label,td,h1,h2,h3,h4")) {
      if (templateOriginals.has(el) || !el.children.length) continue;
      if (el.closest("script,style,[data-safinum-ignore]")) continue;
      const nodes = [...el.childNodes];
      const holes = [];
      let signature = "", ok = true;
      for (const n of nodes) {
        if (n.nodeType === Node.TEXT_NODE) signature += n.nodeValue;
        else if (n.nodeType === Node.ELEMENT_NODE && /^(STRONG|B|EM|I|SPAN|CODE|BDI)$/.test(n.tagName) && !n.children.length) {
          holes.push(n); signature += "{" + holes.length + "}";
        } else { ok = false; break; }
      }
      if (!ok || !holes.length) continue;
      const key = normalize(signature);
      if (!hasOwn(templates, key)) continue;
      const parts = templates[key].split(/(\{\d+\})/);
      const used = parts.filter(p => /^\{\d+\}$/.test(p)).map(p => Number(p.slice(1, -1)));
      if (used.length !== holes.length || used.some(i => i < 1 || i > holes.length)) continue;
      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        const m = part.match(/^\{(\d+)\}$/);
        if (m) fragment.appendChild(holes[Number(m[1]) - 1]);
        else if (part) fragment.appendChild(document.createTextNode(part));
      }
      templateOriginals.set(el, nodes);
      el.replaceChildren(fragment);
      el.setAttribute("data-selah-tpl", "1");
      count++;
    }
    if (observer) observer.takeRecords();
    return count;
  }

  function visit(root) {
    let count = applyTemplates(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest("script,style,noscript,textarea,input,select,option,[contenteditable='true'],[data-safinum-ignore]")) {
          return NodeFilter.FILTER_REJECT;
        }
        return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let node;
    while ((node = walker.nextNode())) if (translateTextNode(node)) count++;
    const elements = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const el of elements) count += translateElement(el);
    if (root.nodeType === Node.ELEMENT_NODE) count += translateElement(root);
    return count;
  }

  function restoreAll() {
    if (observer) observer.disconnect();
    for (const [el, nodes] of templateOriginals) {
      el.replaceChildren(...nodes);
      el.removeAttribute("data-selah-tpl");
    }
    templateOriginals = new Map();
    document.querySelectorAll("[data-selah-unknown]").forEach(el => el.removeAttribute("data-selah-unknown"));
    const unknownStyle = document.getElementById("selah-unknown-style");
    if (unknownStyle) unknownStyle.remove();
    // Restore text nodes known to the previous pass.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (originalNodes.has(node)) node.nodeValue = originalNodes.get(node);
    }
    document.querySelectorAll("*").forEach(el => {
      const saved = originalAttributes.get(el);
      if (saved) for (const [attr, value] of Object.entries(saved)) {
        if (value === null) el.removeAttribute(attr);
        else el.setAttribute(attr, value);
      }
    });
    originalNodes = new WeakMap();
    originalAttributes = new WeakMap();
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(records => {
      if (translating || !currentTarget) return;
      translating = true;
      for (const record of records) {
        if (record.type === "childList") {
          record.addedNodes.forEach(n => {
            const host = n.nodeType === Node.TEXT_NODE ? n.parentElement : n;
            if (host && host.closest && host.closest("[data-safinum-ignore]")) return;
            if (n.nodeType === Node.TEXT_NODE) translateTextNode(n);
            else if (n.nodeType === Node.ELEMENT_NODE) {
              const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
              let t; while ((t = walker.nextNode())) translateTextNode(t);
              translateElement(n);
              n.querySelectorAll && n.querySelectorAll("*").forEach(translateElement);
            }
          });
        } else if (record.type === "characterData") {
          translateTextNode(record.target);
        } else if (record.type === "attributes") {
          translateElement(record.target);
        }
      }
      translating = false;
      clearTimeout(templateTimer);
      templateTimer = setTimeout(() => { if (currentTarget) applyTemplates(document.body); }, 60);
    });
    observer.observe(document.body, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:[...textAttributes, "value"]});
  }

  // Textes visibles que le dictionnaire ne connaît pas : ils restent dans leur langue d'origine
  // et sont soulignés en pointillés pour être complétés puis validés. Aucune traduction inventée.
  function markUnknownText() {
    let count = 0;
    if (!document.getElementById("selah-unknown-style")) {
      const style = document.createElement("style");
      style.id = "selah-unknown-style";
      style.setAttribute("data-safinum-ignore", "true");
      style.textContent = "[data-selah-unknown]{border-bottom:2px dotted #f59e0b !important}";
      document.head.appendChild(style);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest("script,style,noscript,textarea,[data-safinum-ignore],[data-selah-tpl]")) continue;
      const original = originalNodes.has(node) ? originalNodes.get(node) : node.nodeValue;
      if (node.nodeValue !== original) continue; // déjà traduit
      const value = normalize(original);
      if (value.length < 4 || !/[a-zA-ZÀ-ÿ]/.test(value)) continue;
      if (/^(fcfa|xaf|xof|f cfa|€|\$)?\s*[\d\s.,:+\-–\/%]*\s*(fcfa|xaf|xof|f cfa|€|\$)?$/i.test(value)) continue; // montants seuls
      if (resolveText(original) !== null) continue;
      parent.setAttribute("data-selah-unknown", "1");
      count++;
    }
    return count;
  }

  // ===================== Commande vocale (FR / EN) =====================
  // L'utilisateur parle en français ou en anglais ; Selah lit l'information sur la page,
  // l'affiche dans un panneau ET la dit à voix haute. Aucune commande ne valide un paiement.
  const AMOUNT_RE = new RegExp(MONEY_SRC, "i");
  const HIDDEN_RE = /[•*●]{3,}/;
  const SENSITIVE_RE = /d[ée]monstration|demo|mot de passe|password|\bcode\b|\bpin\b|\botp\b/i;
  const plain = s => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  const origText = node => originalNodes.has(node) ? originalNodes.get(node) : node.nodeValue;
  const isVisible = el => !!(el && el.getClientRects().length) && getComputedStyle(el).visibility !== "hidden";

  const BALANCE_LABEL = /^(solde|solde actuel|solde courant|solde disponible|votre solde|balance|current balance|available balance|your balance)$/;
  const FEES_LABEL = /^(frais|frais de transaction|frais de transfert|frais du transfert|frais de l'operation|fees?|transaction fees?|transfer fees?|charges?)$/;
  let voiceLang = "fr";
  let recognition = null;
  let audioQueueToken = 0;

  function visibleTextNodes(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (p.closest("script,style,noscript,textarea,[data-safinum-ignore]")) return NodeFilter.FILTER_REJECT;
        return isVisible(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let n; while ((n = walker.nextNode())) out.push(n);
    return out;
  }

  // Texte d'origine (français/anglais) d'un bloc, même si la page est affichée en langue locale.
  function origElementText(el, skipSensitive) {
    if (el.nodeType === Node.TEXT_NODE) {
      const t = origText(el).replace(/\s+/g, " ").trim();
      return skipSensitive && SENSITIVE_RE.test(t) ? "" : t;
    }
    if (el.nodeType !== Node.ELEMENT_NODE) return "";
    if (el.closest("[data-safinum-ignore]") || /^(SCRIPT|STYLE|NOSCRIPT|INPUT|SELECT|TEXTAREA|BUTTON|SVG|I)$/.test(el.tagName)) return "";
    if (!el.getClientRects().length) return "";
    const kids = templateOriginals.has(el) ? templateOriginals.get(el) : [...el.childNodes];
    return kids.map(k => origElementText(k, skipSensitive)).filter(Boolean).join(" ");
  }
  const tidy = text => text.replace(/\s+/g, " ").replace(/\s+([.,!?;])/g, "$1").trim();

  function flash(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const old = el.style.outline;
    el.style.outline = "3px solid #7c3aed";
    setTimeout(() => { el.style.outline = old; }, 2600);
  }

  // Cherche le montant situé près d'une étiquette (« Solde », « Balance », « Frais »…).
  function findAmountNear(labelRe) {
    for (const node of visibleTextNodes(document.body)) {
      const label = plain(origText(node)).replace(/\s*:\s*$/, "");
      if (!labelRe.test(label)) continue;
      let el = node.parentElement;
      for (let i = 0; i < 5 && el; i++, el = el.parentElement) {
        const text = visibleTextNodes(el).map(n => n.nodeValue.trim()).join(" ");
        const money = text.match(AMOUNT_RE), hidden = text.match(HIDDEN_RE);
        if (money || hidden) {
          const useHidden = hidden && (!money || hidden.index < money.index);
          return { el, hidden: !!useHidden, value: useHidden ? null : money[0].replace(/\s+/g, " ").trim() };
        }
      }
    }
    return null;
  }

  function findInputNear(labelRe) {
    for (const node of visibleTextNodes(document.body)) {
      if (!labelRe.test(plain(origText(node)).replace(/\s*:\s*$/, ""))) continue;
      let el = node.parentElement;
      for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
        const input = el.querySelector("input,select,textarea");
        if (input) return input;
      }
    }
    return null;
  }

  function openDialog() {
    const list = document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open],[aria-modal="true"],.modal');
    return [...list].find(el => !el.closest("[data-safinum-ignore]") && isVisible(el)) || null;
  }

  const T = {
    fr: {
      title: "Selah — Commande vocale", speak: "🎙️ Parler", repeat: "🔊 Répéter", close: "Fermer",
      pressSpeak: "Appuyez sur « 🎙️ Parler », puis dites : solde, frais, transfert, récapitulatif, avertissement ou aide.",
      listening: "Je vous écoute… Dites : solde, frais, transfert, récapitulatif, avertissement ou aide.",
      heard: "Entendu : ", noMic: "Le microphone est bloqué pour ce site. Autorisez-le dans les paramètres du site (page en https ou localhost).",
      noSpeech: "Aucune parole détectée. Appuyez sur Parler et réessayez.", noSR: "La reconnaissance vocale n'est pas disponible dans ce navigateur.",
      balance: v => `Votre solde est de ${v}.`, balanceHidden: "Le solde est masqué. Affichez-le vous-même sur la page : je ne contourne pas cette protection.",
      balanceNone: "Je ne trouve pas le solde sur cette page.",
      fees: v => `Les frais sont de ${v}.`, feesNone: "Je ne trouve pas les frais sur cette page.",
      transfer: (a, r, f) => `Transfert en préparation : ${a ? a : "montant non renseigné"} vers ${r ? r : "bénéficiaire non renseigné"}${f ? `. Frais : ${f}` : ""}. Rien n'est envoyé : vérifiez puis validez vous-même sur la page.`,
      transferHiddenAmount: "le montant est masqué", transferNone: "Je ne vois pas de formulaire de transfert sur cette page.",
      recap: t => `Récapitulatif : ${t}`, recapNone: "Aucune fenêtre de confirmation n'est ouverte.",
      warning: t => `Avertissement : ${t}`, warningNone: "Je ne vois pas d'avertissement sur cette page.",
      cancelDone: "J'ai fermé la confirmation. Rien n'a été envoyé.", cancelNone: "Aucune fenêtre de confirmation à annuler.",
      refuse: "Je ne peux pas valider ni envoyer une opération. Pour votre sécurité, validez vous-même sur la page.",
      repeatNone: "Aucun message à répéter.",
      help: "Vous pouvez dire : solde, frais, transfert, récapitulatif, avertissement, annuler ou répéter. Je ne valide jamais une opération."
    },
    en: {
      title: "Selah — Voice command", speak: "🎙️ Speak", repeat: "🔊 Repeat", close: "Close",
      pressSpeak: "Press “🎙️ Speak”, then say: balance, fees, transfer, summary, warning or help.",
      listening: "Listening… Say: balance, fees, transfer, summary, warning or help.",
      heard: "Heard: ", noMic: "The microphone is blocked for this site. Allow it in the site settings (https or localhost page).",
      noSpeech: "No speech detected. Press Speak and try again.", noSR: "Speech recognition is not available in this browser.",
      balance: v => `Your balance is ${v}.`, balanceHidden: "The balance is hidden. Please reveal it yourself on the page: I do not bypass this protection.",
      balanceNone: "I cannot find the balance on this page.",
      fees: v => `The fees are ${v}.`, feesNone: "I cannot find the fees on this page.",
      transfer: (a, r, f) => `Transfer being prepared: ${a ? a : "amount not filled in"} to ${r ? r : "beneficiary not filled in"}${f ? `. Fees: ${f}` : ""}. Nothing has been sent: please check, then confirm yourself on the page.`,
      transferHiddenAmount: "the amount is hidden", transferNone: "I do not see a transfer form on this page.",
      recap: t => `Summary: ${t}`, recapNone: "No confirmation window is open.",
      warning: t => `Warning: ${t}`, warningNone: "I do not see a warning on this page.",
      cancelDone: "I closed the confirmation. Nothing was sent.", cancelNone: "No confirmation window to cancel.",
      refuse: "I cannot confirm or send an operation. For your safety, please confirm yourself on the page.",
      repeatNone: "Nothing to repeat.",
      help: "You can say: balance, fees, transfer, summary, warning, cancel or repeat. I never confirm an operation."
    }
  };

  function detectIntent(transcript) {
    const t = plain(transcript);
    if (/\b(annul\w*|cancel|abandon\w*)\b/.test(t)) return "cancel";
    if (/\b(recapitulatif|recap|summary|review|details?)\b/.test(t)) return "recap";
    if (/\b(valid\w*|confirm\w*|approuv\w*|approve|pay\w*|paye\w*|submit|execut\w*)\b/.test(t)) return "refuse";
    if (/\b(avertissement|warning|securite|security|attention|alerte|alert)\b/.test(t)) return "warning";
    if (/\b(solde|balance|il me reste|money left|how much)\b/.test(t)) return "balance";
    if (/\b(frais|fees?|charges?|commission|cout|cost)\b/.test(t)) return "fees";
    if (/\b(transfert|transfer|virement|envoy\w*|send)\b/.test(t)) return "transfer";
    if (/\b(repet\w*|repeat|encore|again|redis)\b/.test(t)) return "repeat";
    return "help";
  }

  // Tolérance aux mots mal entendus (accent, « sol de » au lieu de « solde », etc.).
  const FUZZY_WORDS = {
    balance:  ["solde","soldes","balance","sol","sold","soude","sole","saul","sol de"],
    fees:     ["frais","fees","fret","fray","frai","frei","free","commission"],
    transfer: ["transfert","transferts","transfer","transfere","virement","envoyer"],
    warning:  ["avertissement","warning","securite","attention","alerte"],
    recap:    ["recapitulatif","recap","summary","resume"],
    repeat:   ["repeter","repete","repeat","encore","again"],
    cancel:   ["annuler","annule","cancel"]
  };
  function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function fuzzyIntent(alternatives) {
    let best = null;
    for (const alt of alternatives) {
      const tokens = plain(alt).split(/[^a-z0-9]+/).filter(Boolean);
      const cands = new Set(tokens.filter(w => w.length >= 3));
      for (let i = 0; i < tokens.length - 1; i++) cands.add(tokens[i] + tokens[i + 1]);   // « sol de » -> « solde »
      for (const [intent, words] of Object.entries(FUZZY_WORDS)) {
        for (const w of words) {
          const key = w.replace(/ /g, "");
          const max = w.length >= 9 ? 2 : (w.length >= 5 ? 1 : 0);
          for (const c of cands) {
            const dist = editDistance(c, key);
            if (dist <= max && (!best || dist < best.dist)) best = { intent, dist };
          }
        }
      }
    }
    return best ? best.intent : null;
  }
  // Essaie toutes les hypothèses du navigateur : d'abord exact, puis approchant.
  function detectIntentFrom(alternatives) {
    for (const alt of alternatives) { const i = detectIntent(alt); if (i !== "help") return i; }
    return fuzzyIntent(alternatives) || "help";
  }

  function answerFor(intent, lang) {
    const L = T[lang];
    if (intent === "balance") {
      const r = findAmountNear(BALANCE_LABEL);
      if (!r) return L.balanceNone;
      flash(r.el);
      return r.hidden ? L.balanceHidden : L.balance(r.value);
    }
    if (intent === "fees") {
      const r = findAmountNear(FEES_LABEL);
      if (!r) return L.feesNone;
      flash(r.el);
      return r.hidden ? L.balanceHidden : L.fees(r.value);
    }
    if (intent === "transfer") {
      const amountInput = findInputNear(/^(montant|amount)$/);
      const recipientInput = findInputNear(/^(beneficiaire|beneficiary|destinataire|recipient)$/);
      if (!amountInput && !recipientInput) return L.transferNone;
      const fees = findAmountNear(FEES_LABEL);
      const balance = findAmountNear(BALANCE_LABEL);
      const currency = (((balance && balance.value) || (fees && fees.value) || "").match(new RegExp(CUR, "i")) || [""])[0];
      let amount = "";
      if (amountInput) {
        amount = amountInput.type === "password" ? L.transferHiddenAmount : (amountInput.value ? `${amountInput.value} ${currency}`.trim() : "");
      }
      flash((amountInput || recipientInput).closest("div") || amountInput || recipientInput);
      return L.transfer(amount, recipientInput ? recipientInput.value.trim() : "", fees && !fees.hidden ? fees.value : "");
    }
    if (intent === "recap") {
      const dialog = openDialog();
      if (!dialog) return L.recapNone;
      const text = tidy(origElementText(dialog, true));
      return text ? L.recap(text) : L.recapNone;
    }
    if (intent === "warning") {
      const el = [...document.querySelectorAll('[role="alert"],[role="alertdialog"],.alert,.alert-box,.warning,[class*="warning"],[class*="alert"]')]
        .find(e => !e.closest("[data-safinum-ignore]") && isVisible(e));
      const text = el ? tidy(origElementText(el, true)).replace(/^(avertissement|warning|attention)\s*:?\s*/i, "") : "";
      if (!text) return L.warningNone;
      flash(el);
      return L.warning(text);
    }
    if (intent === "cancel") {
      speechSynthesis.cancel();
      const dialog = openDialog();
      const button = dialog && [...dialog.querySelectorAll('button,[role="button"]')].find(b => [...b.childNodes].some(n => n.nodeType === 3 && /^(annuler|cancel)$/.test(plain(origText(n)))));
      if (button) { button.click(); return L.cancelDone; }
      return L.cancelNone;
    }
    if (intent === "repeat") return lastVoiceMessage || L.repeatNone;
    if (intent === "refuse") return L.refuse;
    return L.help;
  }

  function speak(text, lang) {
    if (!("speechSynthesis" in window) || !text) return;
    speechSynthesis.cancel();
    const code = lang === "en" ? "en-US" : "fr-FR";
    const u = new SpeechSynthesisUtterance(text);
    u.lang = code; u.rate = 0.95;
    u.onerror = e => { if (e.error === "not-allowed") showGestureButton(lang === "en" ? "🔊 Tap to hear it" : "🔊 Appuyer pour écouter", () => speak(text, lang)); };
    const voices = speechSynthesis.getVoices();
    // Voix installée sur l'appareil en priorité (fonctionne sans Internet).
    const voice = voices.find(v => v.lang === code && v.localService) || voices.find(v => v.lang.startsWith(code.slice(0, 2)) && v.localService) || voices.find(v => v.lang === code) || voices.find(v => v.lang.startsWith(code.slice(0, 2)));
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  }

  // ---------- Panneau Selah (réponse affichée) ----------
  function ensurePanel() {
    let panel = document.getElementById("selah-voice-panel");
    if (panel) return panel;
    panel = document.createElement("aside");
    panel.id = "selah-voice-panel";
    panel.setAttribute("data-safinum-ignore", "true");
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "Selah");
    panel.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483646;width:min(320px,calc(100vw - 32px));max-height:50vh;overflow:auto;background:#fff;color:#172033;border:1px solid #dbe3ee;border-radius:14px;padding:14px;box-shadow:0 10px 32px #0f172a30;font:14px/1.45 system-ui,Segoe UI,Arial,sans-serif";
    const mk = (tag, id, css, text) => { const e = document.createElement(tag); if (id) e.id = id; if (css) e.style.cssText = css; if (text) e.textContent = text; return e; };
    const btn = "border:0;border-radius:8px;padding:8px 11px;font-weight:600;cursor:pointer;font-size:13px;";
    const head = mk("div", null, "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px");
    const ctrls = mk("div", null, "display:flex;gap:6px");
    const minBtn = mk("button", "selah-vp-min", btn + "background:#f1f5f9;color:#334155;padding:8px 12px", "–");
    minBtn.setAttribute("aria-label", "Réduire / Minimize"); minBtn.title = "Réduire / Minimize";
    ctrls.append(minBtn, mk("button", "selah-vp-close", btn + "background:#f1f5f9;color:#334155"));
    const title = mk("strong", "selah-vp-title", "color:#6d28d9;cursor:move;flex:1;user-select:none");
    head.append(title, ctrls);
    const heard = mk("div", "selah-vp-heard", "font-size:12px;color:#64748b;min-height:16px");
    const answer = mk("div", "selah-vp-answer", "margin:6px 0 10px;min-height:40px;padding:9px;background:#f5f3ff;border-radius:8px");
    answer.setAttribute("aria-live", "polite");
    const row = mk("div", null, "display:flex;gap:6px;flex-wrap:wrap");
    row.append(mk("button", "selah-vp-mic", btn + "background:#6d28d9;color:#fff"), mk("button", "selah-vp-repeat", btn + "background:#2563eb;color:#fff"), mk("button", "selah-vp-lang", btn + "background:#e2e8f0;color:#172033"));
    panel.append(head, heard, answer, row);
    document.body.appendChild(panel);
    panel.querySelector("#selah-vp-close").addEventListener("click", () => { stopAll(); panel.remove(); });
    // Réduire : seule la barre du titre reste visible, pour ne plus cacher le site (bouton Envoyer, etc.).
    minBtn.addEventListener("click", () => {
      const small = panel.dataset.min !== "1";
      panel.dataset.min = small ? "1" : "0";
      for (const el of [heard, answer, row, ...panel.querySelectorAll("#selah-vp-gesture")]) el.style.display = small ? "none" : "";
      head.style.marginBottom = small ? "0" : "8px";
      minBtn.textContent = small ? "▢" : "–";
    });
    // Déplacer : on fait glisser la barre du titre où l'on veut.
    let drag = null;
    head.addEventListener("pointerdown", e => {
      if (e.target.closest("button")) return;
      const r = panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener("pointermove", e => {
      if (!drag) return;
      const x = Math.min(Math.max(0, e.clientX - drag.dx), window.innerWidth - 80);
      const y = Math.min(Math.max(0, e.clientY - drag.dy), window.innerHeight - 40);
      panel.style.left = x + "px"; panel.style.top = y + "px"; panel.style.bottom = "auto"; panel.style.right = "auto";
    });
    head.addEventListener("pointerup", () => { drag = null; });
    panel.querySelector("#selah-vp-mic").addEventListener("click", startListening);
    setTimeout(() => { try { prepareOfflineSpeech(); } catch {} }, 0);
    panel.querySelector("#selah-vp-repeat").addEventListener("click", () => { if (lastVoiceMessage) { setAnswer(lastVoiceMessage); speak(lastVoiceMessage, voiceLang); } });
    panel.querySelector("#selah-vp-lang").addEventListener("click", () => { voiceLang = voiceLang === "fr" ? "en" : "fr"; relabel(); });
    relabel();
    return panel;
  }
  function relabel() {
    const L = T[voiceLang], q = id => document.getElementById(id);
    if (!q("selah-vp-title")) return;
    q("selah-vp-title").textContent = L.title;
    q("selah-vp-close").textContent = L.close;
    q("selah-vp-mic").textContent = L.speak;
    q("selah-vp-repeat").textContent = L.repeat;
    q("selah-vp-lang").textContent = voiceLang === "fr" ? "FR → EN" : "EN → FR";
  }
  // Chrome refuse parfois de lire sans clic dans la page : on propose un bouton de secours.
  function showGestureButton(label, fn) {
    ensurePanel();
    document.querySelectorAll("#selah-vp-gesture").forEach(e => e.remove());
    const b = document.createElement("button");
    b.id = "selah-vp-gesture";
    b.textContent = label;
    b.style.cssText = "margin-top:8px;border:0;border-radius:8px;padding:9px 13px;font-weight:700;cursor:pointer;font-size:14px;background:#16a34a;color:#fff;width:100%";
    b.addEventListener("click", () => { b.remove(); fn(); });
    const pn = document.getElementById("selah-voice-panel");
    if (pn.dataset.min === "1") b.style.display = "none";
    pn.appendChild(b);
  }
  function setAnswer(text) { ensurePanel(); document.getElementById("selah-vp-answer").textContent = text; }
  function setHeard(text) { ensurePanel(); document.getElementById("selah-vp-heard").textContent = text; }
  function stopAll() {
    audioQueueToken++;
    if (recognition) { try { recognition.abort(); } catch {} recognition = null; }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    document.querySelectorAll("#selah-vp-gesture").forEach(e => e.remove());
  }

  function respondTo(transcript, alternatives) {
    const intent = detectIntentFrom(alternatives && alternatives.length ? alternatives : [transcript]);
    const message = answerFor(intent, voiceLang);
    if (intent !== "repeat") lastVoiceMessage = message;
    setAnswer(message);
    speak(message, voiceLang);
  }

  // Reconnaissance vocale : sur l'appareil (sans Internet) si le modèle de langue est installé,
  // sinon via le service du navigateur (Internet obligatoire). Chrome 139 ou plus récent.
  async function localSpeechMode(code) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || typeof SR.available !== "function") return "unsupported";
    try {
      let status = await SR.available({ langs: [code], processLocally: true });
      if (status === "available") return "local";
      if (typeof SR.install === "function" && navigator.onLine) {
        try { if (await SR.install({ langs: [code], processLocally: true })) return "local"; } catch {}
        status = await SR.available({ langs: [code], processLocally: true });
        if (status === "available") return "local";
      }
    } catch {}
    return "cloud";
  }
  // Prépare le mode hors ligne dès l'ouverture du panneau (si Internet est disponible à ce moment).
  function prepareOfflineSpeech() { localSpeechMode(voiceLang === "en" ? "en-US" : "fr-FR"); }

  async function startListening() {
    ensurePanel();
    const L = T[voiceLang];
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setAnswer(L.noSR); return; }
    stopAll();
    setHeard(""); setAnswer(L.listening);
    const code = voiceLang === "en" ? "en-US" : "fr-FR";
    const mode = await localSpeechMode(code);
    if (mode !== "local" && !navigator.onLine) {
      setAnswer(voiceLang === "en"
        ? "No internet and the offline speech model is not installed. Connect once, press Speak again, then it will work offline."
        : "Pas d'Internet et le modèle vocal hors ligne n'est pas installé. Connectez-vous une fois, appuyez de nouveau sur Parler, puis ça marchera hors ligne.");
      return;
    }
    try {
      const rec = new SR();
      recognition = rec;
      rec.lang = code;
      if (mode === "local") rec.processLocally = true;
      rec.interimResults = false; rec.maxAlternatives = 5;
      rec.onresult = e => {
        const alts = Array.from(e.results[0]).map(r => r.transcript);
        setHeard(L.heard + "« " + alts[0] + " »" + (mode === "local" ? " 📴" : ""));
        respondTo(alts[0], alts);
      };
      rec.onerror = e => setAnswer(e.error === "not-allowed" || e.error === "service-not-allowed" ? L.noMic : e.error === "no-speech" ? L.noSpeech : e.error === "network" ? (voiceLang === "en" ? "Network error: the speech service needs internet." : "Erreur réseau : le service vocal a besoin d'Internet.") : "Micro : " + e.error);
      rec.onend = () => { if (recognition === rec) recognition = null; };
      rec.start();
    } catch (err) { setAnswer(String(err && err.message || err)); }
  }


  // Module indépendant de proposition de traduction vers l'anglais.
  // Il ne remplace pas les trois langues locales proposées dans le popup Selah.
  const englishDictionary = {
    "tableau de bord":"Dashboard",
    "transfert":"Transfer",
    "compte":"Account",
    "paramètres":"Settings",
    "sécurisé":"Secure",
    "portail financier inclusif":"Inclusive Financial Portal",
    "gérez vos opérations en toute simplicité":"Manage your transactions with ease",
    "bienvenue angela !":"Welcome, Angela!",
    "solde":"Balance",
    "solde disponible":"Available balance",
    "frais":"Fees",
    "montant":"Amount",
    "bénéficiaire":"Beneficiary",
    "envoyer":"Send",
    "valider":"Confirm",
    "annuler":"Cancel",
    "avertissement":"Warning",
    "confirmer le transfert":"Confirm transfer",
    "vérifiez bien le montant avant de valider votre transfert":"Please check the amount carefully before confirming your transfer.",
    "veuillez saisir un bénéficiaire.":"Please enter a beneficiary.",
    "veuillez saisir un montant valide.":"Please enter a valid amount.",
    "mot de passe incorrect. réessayez.":"Incorrect demo password. Please try again.",
    "montant invalide.":"Invalid amount.",
    "solde insuffisant pour couvrir le montant et les frais.":"Insufficient balance to cover the amount and fees.",
    "total débité":"Total debited",
    "mot de passe de démonstration":"Demo password",
    "saisir le code de démonstration":"Enter the demo code",
    "code de démonstration : 1234. n'utilisez jamais un vrai mot de passe bancaire.":"Demo code: 1234. Never use a real bank password.",
    "confirmer et envoyer":"Confirm and send",
    "transfert annulé":"Transfer cancelled",
    "transfert effectué avec succès !":"Transfer completed successfully!",
    "aucun message précédent à répéter.":"There is no previous message to repeat."
  };

  function showEnglishSuggestion() {
    if (document.getElementById("selah-english-suggestion")) return;
    const pageLanguage = (document.documentElement.lang || "").toLowerCase().split("-")[0];
    const browserLanguage = (navigator.languages && navigator.languages[0] || navigator.language || "").toLowerCase().split("-")[0];
    // La proposition est réservée au navigateur configuré en anglais et à une page explicitement française.
    if (pageLanguage !== "fr" || browserLanguage !== "en") return;

    const box = document.createElement("section");
    box.id = "selah-english-suggestion";
    box.setAttribute("data-safinum-ignore", "true");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Selah page translation");
    box.innerHTML = `
      <style>
        #selah-english-suggestion{position:fixed;top:16px;right:16px;z-index:2147483647;width:min(360px,calc(100vw - 32px));padding:18px;background:#fff;color:#172033;border:1px solid #dbe3ee;border-radius:14px;box-shadow:0 12px 38px rgba(15,23,42,.22);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
        #selah-english-suggestion strong{display:block;font-size:15px;margin-bottom:6px}
        #selah-english-suggestion p{margin:0 0 14px;color:#475569}
        #selah-english-suggestion .selah-actions{display:flex;justify-content:flex-end;gap:8px}
        #selah-english-suggestion button{border:0;border-radius:8px;padding:9px 13px;font-weight:600;cursor:pointer}
        #selah-english-suggestion .selah-dismiss{background:#f1f5f9;color:#334155}
        #selah-english-suggestion .selah-translate{background:#059669;color:#fff}
      </style>
      <strong>This webpage seems to be in French.</strong>
      <p>Would you like to translate it into English?</p>
      <div class="selah-actions">
        <button type="button" class="selah-dismiss">No, thanks</button>
        <button type="button" class="selah-translate">Translate</button>
      </div>`;
    (document.body || document.documentElement).appendChild(box);

    box.querySelector(".selah-dismiss").addEventListener("click", () => box.remove());
    box.querySelector(".selah-translate").addEventListener("click", () => {
      // Toujours repartir du texte source, jamais d'une version locale déjà traduite.
      restoreAll();
      dictionary = prepareDictionary(englishDictionary);
      templates = prepareDictionary({"confirmez l'envoi de {1} vers {2}.": "Confirm sending {1} to {2}."});
      fragments = prepareDictionary({"vers": "to", "frais": "Fees", "nouveau solde": "New balance"}); buildFragmentRe();
      currentTarget = "english";
      currentSource = "fr";
      visit(document.body);
      startObserver();
      box.remove();
    });
  }

  const isTopFrame = window === window.top;
  if (isTopFrame) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", showEnglishSuggestion, {once:true});
    } else {
      showEnglishSuggestion();
    }
  }



  // ---------- Lecture à voix haute ----------
  // Pidgin et Duala : phrases enregistrées par le locuteur, jouées une à une quand le texte affiché correspond EXACTEMENT
  // à la phrase enregistrée (un montant ou un nom différent => pas de lecture, pour ne jamais dire un faux montant).
  // Fulfulde (et repli) : voix française du navigateur, comme décidé par l'équipe.
  function collectReadableBlocks() {
    const blocks = [], seenTpl = new Set(), seen = new Set();
    const push = text => {
      const t = text.replace(/\s+/g, " ").trim();
      const key = normalize(t).replace(/[\s.!?:]+$/, "");
      if (key.length < 2 || seen.has(key)) return;
      seen.add(key); blocks.push({ text: t, key });
    };
    for (const node of visibleTextNodes(document.body)) {
      const tpl = node.parentElement.closest("[data-selah-tpl]");
      if (tpl) { if (!seenTpl.has(tpl)) { seenTpl.add(tpl); push(tpl.textContent); } continue; }
      push(node.nodeValue);
    }
    return blocks;
  }

  async function listenCurrent(language, clips, uiLang) {
    const en = uiLang === "en";
    if (uiLang) { voiceLang = en ? "en" : "fr"; relabel(); }
    stopAll();
    const blocks = collectReadableBlocks();
    if (!blocks.length) return { success: false, error: en ? "No visible text to read." : "Aucun texte visible à lire." };
    ensurePanel();
    if ((language === "pidgin" || language === "duala") && Array.isArray(clips) && clips.length) {
      const map = new Map(clips.map(c => [normalize(c.text).replace(/[\s.!?:]+$/, ""), c.file]));
      // Un libellé suivi d'un montant (« Charges : 500 FCFA ») : on dit seulement le libellé enregistré ;
      // le montant reste affiché à l'écran (jamais lu avec une voix enregistrée).
      const clipFor = b => {
        if (map.has(b.key)) return map.get(b.key);
        const at = b.text.search(new RegExp(MONEY_SRC, "i"));
        if (at > 0) { const prefix = normalize(b.text.slice(0, at)).replace(/[\s.!?:]+$/, ""); if (map.has(prefix)) return map.get(prefix); }
        return null;
      };
      const queue = blocks.filter(b => clipFor(b)).map(b => ({ text: b.text, url: chrome.runtime.getURL(clipFor(b)) }));
      const skipped = blocks.length - queue.length;
      if (!queue.length) return { success: false, error: en ? `No sentence on the page matches the recorded voices. Translate the page into ${language === "duala" ? "Duala" : "Pidgin"} first.` : `Aucune phrase de la page ne correspond aux voix enregistrées. Traduisez d'abord la page en ${language === "duala" ? "Duala" : "Pidgin"}.` };
      const token = ++audioQueueToken;
      setHeard(en
        ? `🔊 ${language === "duala" ? "Duala" : "Pidgin"} — ${queue.length} recorded sentence(s)${skipped ? `, ${skipped} without voice (amounts, names: read them on screen)` : ""}`
        : `🔊 ${language === "duala" ? "Duala" : "Pidgin"} — ${queue.length} phrase(s) enregistrée(s)${skipped ? `, ${skipped} sans voix (montants, noms : lisez-les à l'écran)` : ""}`);
      (async () => {
        for (let i = 0; i < queue.length; i++) {
          if (token !== audioQueueToken) return;
          setAnswer(`(${i + 1}/${queue.length}) ${queue[i].text}`);
          let blocked = false;
          await new Promise(resolve => {
            const audio = new Audio(queue[i].url);
            audio.onended = resolve; audio.onerror = resolve;
            audio.play().catch(err => { blocked = err && err.name === "NotAllowedError"; resolve(); });
          });
          if (blocked) {
            setAnswer(voiceLang === "en" ? "Chrome needs a tap to start the audio." : "Chrome demande un clic pour lancer le son.");
            showGestureButton(voiceLang === "en" ? "▶ Start playback" : "▶ Lancer la lecture", () => listenCurrent(language, clips, uiLang));
            return;
          }
          await new Promise(r => setTimeout(r, 250));
        }
        if (token === audioQueueToken) setAnswer("✔ " + (voiceLang === "en" ? "Done." : "Lecture terminée."));
      })();
      return { success: true, message: en
        ? `Playing ${queue.length} sentence(s) in ${language === "duala" ? "Duala" : "Pidgin"}${skipped ? ` — ${skipped} text(s) without recorded voice` : ""}.`
        : `Lecture de ${queue.length} phrase(s) en ${language === "duala" ? "Duala" : "Pidgin"}${skipped ? ` — ${skipped} texte(s) sans voix enregistrée` : ""}.` };
    }
    // Fulfulde : voix française du navigateur (voix enregistrées prévues plus tard)
    const text = blocks.map(b => b.text).join(". ");
    setHeard("🔊 " + (language === "duala" ? "Duala" : "Fulfulde") + (en ? " — browser's French voice" : " — voix française du navigateur"));
    setAnswer(text.length > 220 ? text.slice(0, 220) + "…" : text);
    speak(text, "fr");
    return { success: true, message: (en ? "Playing with the browser's French voice (" : "Lecture avec la voix française du navigateur (") + (language === "duala" ? "Duala" : "Fulfulde") + ")." };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate") {
      (async () => {
        try {
          if (!["pidgin","duala","fulfulde"].includes(request.language)) {
            throw new Error("Langue cible non prise en charge.");
          }
          restoreAll();
          currentSource = request.sourceLanguage || "fr";
          if (!request.dictionary || typeof request.dictionary !== "object") {
            throw new Error("Dictionnaire indisponible.");
          }
          dictionary = prepareDictionary(request.dictionary);
          templates = prepareDictionary(request.templates);
          fragments = prepareDictionary(request.fragments); buildFragmentRe();
          currentTarget = request.language;
          const count = visit(document.body) + visit(document.head);
          startObserver();
          if (!isTopFrame) return;
          sendResponse({
            success:true,
            language:currentTarget,
            sourceLanguage:currentSource,
            translatedCount:count,
            unknownCount:markUnknownText(),
            glossaryEntries:Object.keys(dictionary).length,
            mode:"exact-label-and-template"
          });
        } catch (error) {
          sendResponse({success:false,error:error.message});
        }
      })();
      return true;
    }

    // Panneau vocal et lecture : uniquement dans la page principale (les iframes ne répondent pas).
    if (!isTopFrame && (request.action === "listen" || request.action === "startVoice")) return false;

    if (request.action === "listen") {
      listenCurrent(request.language, request.clips, request.uiLang).then(sendResponse, e => sendResponse({success:false,error:e.message}));
      return true;
    }

    if (request.action === "startVoice") {
      voiceLang = request.voiceLang === "en" ? "en" : "fr";
      ensurePanel(); relabel();
      setHeard(""); setAnswer(T[voiceLang].pressSpeak);
      sendResponse({success:true});
      return false;
    }

    if (request.action === "restore") {
      restoreAll();
      currentTarget = null;
      if (observer) observer.disconnect();
      sendResponse({success:true});
      return false;
    }
  });
})();
