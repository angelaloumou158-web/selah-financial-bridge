const $ = id => document.getElementById(id);
let recognition = null;
let lastCommand = '';

// ---------- Langue de l'interface du popup (français / anglais) ----------
// Détectée d'après la langue de la page ; le bouton FR | EN permet de changer.
// Rien n'est mémorisé : en rouvrant le popup, la détection automatique reprend.
const STR = {
  fr: {
    intro: "Traduisez l'interface (française ou anglaise, détectée automatiquement) et écoutez les explications dans la langue choisie.",
    translateTo: 'Traduire vers', optPidgin: 'Pidgin camerounais',
    translateBtn: "Traduire l'interface", restoreBtn: "Afficher le texte d'origine",
    voiceLabel: 'Langue des commandes vocales', micBtn: '🎙️ Parler à Selah', listenBtn: '🔊 Écouter',
    note1: 'Pidgin et Duala : voix enregistrée par l’équipe. Fulfulde : voix française du navigateur (voix enregistrée prévue plus tard).',
    note2: 'Commandes vocales (français ou anglais) : solde, frais, transfert, récapitulatif, avertissement, annuler, répéter. La réponse s’affiche et se dit à voix haute. Une commande vocale ne valide jamais une opération.',
    noTab: 'Aucun onglet actif.', noComm: 'Impossible de communiquer avec cette page. Recharge-la puis réessaie.',
    noDict: 'Dictionnaire indisponible.', translating: 'Traduction en cours…', transFailed: 'La traduction a échoué.',
    done: (n, src, u) => `${n} élément(s) traduit(s) — source : ${src}. ${u} texte(s) non traduit(s) (soulignés en pointillés). Montants et noms restent inchangés.`,
    restored: 'Texte d’origine rétabli.', restoreFail: 'Restauration impossible.',
    voiceOpen: 'Le panneau Selah est ouvert sur la page : appuyez sur « Parler », puis posez votre question.',
    voiceFail: 'Commande vocale indisponible.', voiceStartFail: 'Impossible de démarrer la commande vocale.',
    listenFail: 'Lecture impossible.', listenFail2: 'Lecture impossible. Vérifie que la page est ouverte.'
  },
  en: {
    intro: 'Translate the interface (French or English, detected automatically) and listen to the explanations in the chosen language.',
    translateTo: 'Translate to', optPidgin: 'Cameroonian Pidgin',
    translateBtn: 'Translate the interface', restoreBtn: 'Show original text',
    voiceLabel: 'Voice command language', micBtn: '🎙️ Talk to Selah', listenBtn: '🔊 Listen',
    note1: 'Pidgin and Duala: voice recorded by the team. Fulfulde: the browser’s French voice (recorded voice planned for later).',
    note2: 'Voice commands (French or English): balance, fees, transfer, summary, warning, cancel, repeat. The answer is shown and spoken aloud. A voice command never confirms an operation.',
    noTab: 'No active tab.', noComm: 'Cannot communicate with this page. Reload it and try again.',
    noDict: 'Dictionary unavailable.', translating: 'Translating…', transFailed: 'Translation failed.',
    done: (n, src, u) => `${n} item(s) translated — source: ${src}. ${u} text(s) not translated (dotted underline). Amounts and names are left unchanged.`,
    restored: 'Original text restored.', restoreFail: 'Could not restore the page.',
    voiceOpen: 'The Selah panel is open on the page: press “Speak”, then ask your question.',
    voiceFail: 'Voice command unavailable.', voiceStartFail: 'Could not start the voice command.',
    listenFail: 'Playback failed.', listenFail2: 'Playback failed. Check that the page is open.'
  }
};
let uiLang = 'fr';
const t = (key, ...args) => { const v = STR[uiLang][key]; return typeof v === 'function' ? v(...args) : v; };
function applyUiLang(lang) {
  uiLang = lang === 'en' ? 'en' : 'fr';
  document.documentElement.lang = uiLang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $('uiFr').setAttribute('aria-pressed', String(uiLang === 'fr'));
  $('uiEn').setAttribute('aria-pressed', String(uiLang === 'en'));
}
$('uiFr').addEventListener('click', () => applyUiLang('fr'));
$('uiEn').addEventListener('click', () => applyUiLang('en'));

function status(message, error=false) {
  $('status').textContent = message;
  $('status').style.background = error ? '#fef2f2' : '#ecfdf5';
  $('status').style.color = error ? '#991b1b' : '#065f46';
}
async function getActiveTab() {
  const tabs = await chrome.tabs.query({active:true,currentWindow:true});
  if (!tabs[0]?.id) throw new Error(t('noTab'));
  return tabs[0];
}
async function sendToPage(tab, message) {
  const send = async () => { try { return await chrome.tabs.sendMessage(tab.id, message); } catch { return null; } };
  let response = await send();
  if (response && typeof response.success === 'boolean') return response;
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
  response = await send();
  if (!response || typeof response.success !== 'boolean') {
    throw new Error(t('noComm'));
  }
  return response;
}
async function getDictionary() {
  const lang = $('languageSelect').value;
  const response = await fetch(chrome.runtime.getURL(`dictionaries/${lang}.json`));
  if (!response.ok) throw new Error(t('noDict'));
  return response.json();
}
async function getSourceLanguage(tab) {
  const [{result}] = await chrome.scripting.executeScript({
    target:{tabId:tab.id},
    func:() => {
      const htmlLang=(document.documentElement.lang||'').toLowerCase();
      if (htmlLang.startsWith('en')) return 'en';
      if (htmlLang.startsWith('fr')) return 'fr';
      const sample=(document.body?.innerText||'').slice(0,5000).toLowerCase();
      const fr=(sample.match(/\b(le|la|les|vous|votre|solde|transfert|compte|bienvenue|montant|frais)\b/g)||[]).length;
      const en=(sample.match(/\b(the|you|your|balance|transfer|account|welcome|amount|fees|send)\b/g)||[]).length;
      return en>fr?'en':'fr';
    }
  });
  return result || 'fr';
}

$('translateBtn').addEventListener('click', async () => {
  $('translateBtn').disabled = true;
  status(t('translating'));
  try {
    const tab=await getActiveTab();
    const sourceLanguage=await getSourceLanguage(tab);
    const file=await getDictionary();
    const result=await sendToPage(tab,{
      action:'translate',
      language:$('languageSelect').value,
      sourceLanguage,
      // Français et anglais sont fusionnés : une page mixte (boutons en anglais, textes en français) est traduite en une seule fois.
      dictionary:{...(file.translations||{}).en,...(file.translations||{}).fr},
      templates:{...(file.templates||{}).en,...(file.templates||{}).fr},
      fragments:{...(file.fragments||{}).en,...(file.fragments||{}).fr}
    });
    if(!result.success) throw new Error(result.error||t('transFailed'));
    status(t('done',result.translatedCount,sourceLanguage.toUpperCase(),result.unknownCount||0));
  } catch(err) {
    status(err.message,true);
  } finally {
    $('translateBtn').disabled=false;
  }
});

$('restoreBtn').addEventListener('click',async()=>{
  try {
    const tab=await getActiveTab();
    const r=await sendToPage(tab,{action:'restore'});
    status(r.success?t('restored'):t('restoreFail'),!r.success);
  } catch(e) {
    status(e.message,true);
  }
});

// Commande vocale : tout se passe dans la page (panneau Selah), car le popup se ferme
// dès que Chrome affiche la demande d'autorisation du microphone.
$('micBtn').addEventListener('click',async()=>{
  try {
    const tab=await getActiveTab();
    const r=await sendToPage(tab,{action:'startVoice',voiceLang:$('voiceLangSelect').value});
    status(r.success?t('voiceOpen'):t('voiceFail'),!r.success);
  } catch(e) {
    status(e.message||t('voiceStartFail'),true);
  }
});

// Un seul bouton « Écouter » :
// Pidgin et Duala = phrases enregistrées ; Fulfulde = voix française du navigateur.
$('listenBtn').addEventListener('click',async()=>{
  $('listenBtn').disabled=true;
  try {
    const tab=await getActiveTab();
    const language=$('languageSelect').value;
    let clips=[];
    if(language==='pidgin'||language==='duala'){
      try {
        const r=await fetch(chrome.runtime.getURL('audio/'+language+'/clips.json'));
        if(r.ok) clips=(await r.json()).clips.filter(c=>!c.speaks_amount&&!c.muted).map(c=>({text:c.text,file:c.file}));
      } catch {}
    }
    const result=await sendToPage(tab,{action:'listen',language,clips,uiLang});
    status(result.success?result.message:(result.error||t('listenFail')),!result.success);
  } catch(e) {
    status(e.message||t('listenFail2'),true);
  } finally {
    $('listenBtn').disabled=false;
  }
});

// Au chargement : langue du site -> langue du popup et des commandes vocales.
(async () => {
  try {
    const tab = await getActiveTab();
    const detected = await getSourceLanguage(tab);
    applyUiLang(detected);
    $('voiceLangSelect').value = detected;
  } catch {
    applyUiLang('fr'); // page protégée (chrome://…) ou aucun onglet : français par défaut
  }
})();
