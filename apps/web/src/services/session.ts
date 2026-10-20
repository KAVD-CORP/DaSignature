/**
 * In-memory, per-session state that must never be persisted: PDF passwords the user typed
 * ("DaSignature won't store the password") and the PDF bytes of the open document.
 */
const passwords = new Map<string, string>();

export const session = {
  password: (docId: string) => passwords.get(docId),
  rememberPassword: (docId: string, pw: string | undefined) => {
    if (pw === undefined) passwords.delete(docId);
    else passwords.set(docId, pw);
  },
  forget: (docId: string) => passwords.delete(docId),
  clear: () => {
    passwords.clear();
  },
};
