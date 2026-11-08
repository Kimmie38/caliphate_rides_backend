// Bank codes for the banks drivers can pick in the app. Traditional banks use their CBN codes, which
// both Flutterwave and Monnify accept; digital banks' codes differ between providers, so those (and
// any CBN code the provider doesn't list) are found by name in the provider's own bank list.

export const KNOWN_CODES = {
  "Access Bank": "044", Ecobank: "050", "Fidelity Bank": "070", "First Bank": "011", FCMB: "214",
  GTBank: "058", "Jaiz Bank": "301", "Keystone Bank": "082", "Polaris Bank": "076", "Providus Bank": "101",
  "Stanbic IBTC": "221", "Sterling Bank": "232", "TAJBank": "302", "Union Bank": "032", UBA: "033",
  "Unity Bank": "215", "Wema Bank": "035", "Zenith Bank": "057",
};

/** Words that identify each bank in a provider's list (lower case). */
const NAME_WORDS = {
  "Access Bank": ["access bank"], Ecobank: ["ecobank"], "Fidelity Bank": ["fidelity"], "First Bank": ["first bank"],
  FCMB: ["first city monument", "fcmb"], "Globus Bank": ["globus"], GTBank: ["guaranty trust", "gtbank"],
  "Jaiz Bank": ["jaiz"], "Keystone Bank": ["keystone"], "Polaris Bank": ["polaris"], "Providus Bank": ["providus"],
  "Stanbic IBTC": ["stanbic"], "Sterling Bank": ["sterling"], TAJBank: ["taj"], "Union Bank": ["union bank"],
  UBA: ["united bank for africa", "uba"], "Unity Bank": ["unity bank"], "Wema Bank": ["wema"], "Zenith Bank": ["zenith"],
  Kuda: ["kuda"], Moniepoint: ["moniepoint"], OPay: ["opay", "paycom"], PalmPay: ["palmpay"],
};

/** The provider's code for a bank name from the app's list, or null. `banks` is the provider's list ([] if unavailable). */
export function findBankCode(bankName, banks) {
  const known = KNOWN_CODES[bankName];
  if (known && (!banks.length || banks.some((b) => b.code === known))) return known;
  const words = NAME_WORDS[bankName] ?? [bankName.toLowerCase()];
  const match = banks.find((b) => words.some((w) => b.name.toLowerCase().includes(w)));
  return match?.code ?? known ?? null;
}
