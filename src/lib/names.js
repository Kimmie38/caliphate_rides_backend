// Comparing the name a bank has on an account with the driver's name ("ABUBAKAR MUSA SANI" vs "Musa Abubakar").

const words = (s) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 2);

/** True when at least two of the driver's names (or all of them, if they gave fewer) are on the account. */
export function namesMatch(bankName, driverName) {
  const bank = new Set(words(bankName));
  const mine = [...new Set(words(driverName))];
  if (!bank.size || !mine.length) return false;
  const found = mine.filter((w) => bank.has(w)).length;
  return found >= Math.min(2, mine.length);
}
