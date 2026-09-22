export type DetectedLanguage = 'en' | 'hi' | 'hinglish'

// Romanised Hindi words that are unambiguous — deliberately excluding words that are also common
// English ("to", "me", "main", "do", "hi", "or", "us", "par", "ab") so ordinary English is never misread.
const ROMAN_HINDI = new Set(
  `hai hain tha thi the hoon hun ho hogi hoga honge nahi nahin nhi mat kya kyun kyon kaise kab kahan kaun kis kitna kitni kitne
   mera meri mere mujhe mujhko hamara hamari hamare humara tumhara tumhari apna apni apne aapka aapki aapke aap tum humko hum
   ko ka ki ke se mein mai ne par pe liye lie wala wali wale waala waali
   aur ya lekin par kyunki isliye phir bhi hi toh tho sirf bas abhi kabhi hamesha
   kar karna karo kariye karunga karungi kiya kiye karta karti karte chahta chahti chahte chahiye chahunga chahungi
   dena de do dijiye diya dungi dunga denge milna milega milegi mile lena lo liya
   ghar makaan makan zameen jameen jaidad sampatti paisa paise rupaye rupay lakh crore
   beta beti bete betiyan patni pati biwi maa mummy papa pita bhai behen bahen behan parivar bachche bachhe bacche
   sab sabhi kuch koi kai bahut zyada jyada thoda kam achha accha theek thik sahi galat
   samajh samjha samjhi bataiye batao bata bolo boliye sunna suniye haan han ji jee
   dhanyavaad shukriya namaste namaskar
   wasiyat vasiyat nomination nominee gawah gavah vakil`
    .split(/\s+/)
    .filter(Boolean),
)

const DEVANAGARI = /[\u0900-\u097F]/g

// English loanwords that speech recognition writes in Devanagari ("प्रॉपर्टी", "वाइफ") — Hindi speech that
// uses them is Hinglish, not pure Hindi.
const DEVANAGARI_LOANWORDS = new Set(
  `प्रॉपर्टी प्रोपर्टी फ्लैट हाउस बैंक अकाउंट वाइफ हसबैंड सन डॉटर इंश्योरेंस पॉलिसी नॉमिनी एक्ज़ीक्यूटर एक्सीक्यूटर विल लोन प्लॉट
   कार मोबाइल ओके थैंक्स सॉरी प्लीज़ प्लीज़ कन्फर्म वैल्यू शेयर फंड म्यूचुअल इन्वेस्टमेंट लॉकर गार्जियन विटनेस रजिस्ट्रेशन डॉक्यूमेंट`
    .split(/\s+/)
    .filter(Boolean),
)

/**
 * Classify what the user said so Samaira can answer in kind:
 *  - Devanagari only                          → "hi"       (pure Hindi)
 *  - Devanagari with any English word/loanword → "hinglish" (this is how speech recognition writes spoken Hinglish)
 *  - Latin script with Hindi words             → "hinglish" (romanised Hindi mixed with English)
 *  - otherwise                                 → "en"
 */
export function detectLanguage(text: string): DetectedLanguage {
  if ((text.match(DEVANAGARI) ?? []).length > 0) {
    const hasEnglishWord = /[A-Za-z]{2,}/.test(text)
    const hasLoanword = (text.match(/[\u0900-\u097F]+/g) ?? []).some((word) => DEVANAGARI_LOANWORDS.has(word))
    return hasEnglishWord || hasLoanword ? 'hinglish' : 'hi'
  }

  const tokens = text.toLowerCase().match(/[a-z]+/g) ?? []
  if (tokens.length === 0) return 'en'
  const hindiWords = tokens.filter((token) => ROMAN_HINDI.has(token)).length
  const share = hindiWords / tokens.length
  // Two or more clear Hindi words, or a short phrase dominated by them ("meri beti ko ghar dena hai").
  return hindiWords >= 2 && share >= 0.2 ? 'hinglish' : hindiWords >= 1 && tokens.length <= 3 && share >= 0.5 ? 'hinglish' : 'en'
}
