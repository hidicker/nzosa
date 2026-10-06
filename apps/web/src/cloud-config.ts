/**
 * Where the hosted copy keeps its books.
 *
 * Both of these are public. The publishable key identifies the project to
 * Supabase and nothing more: it carries no rights of its own, and every row it
 * can reach is decided by the policies in the database and by who is signed
 * in. It ships inside the page, as it is meant to, and lives in the repository
 * for the same reason the page does.
 *
 * A build with no project named here has no cloud option at all: the app is
 * then exactly what it was, a folder or a browser.
 */
interface CloudProject {
  url: string;
  publishableKey: string;
  /**
   * Google sign-in straight to this site. Google names the address it returns
   * to on its sign-in screen; returning to Supabase showed the project's
   * random address there. With these set, a page at `googleReturn` has Google
   * come back to it and hands Google's token to Supabase itself. The client ID
   * is public (it is in every sign-in address), and `googleReturn` must be an
   * authorised redirect URI on that client. Blank: through Supabase, as before.
   */
  googleClientId: string;
  googleReturn: string;
}

// Not `as const`: a build with the project blanked out is a build with no
// cloud in it, and the check below has to stay a question rather than become
// a contradiction the compiler rejects.
export const CLOUD: CloudProject = {
  url: "https://ronancqtbbqmsiatxmfn.supabase.co",
  publishableKey: "sb_publishable_IS6I8qzIGjmWzWUSXW5IhA_TFLO1A5M",
  googleClientId: "542220598161-qcg2d23ci9hpj3vr2nm3lnl2tji43qj1.apps.googleusercontent.com",
  googleReturn: "https://nbparagliding.nz/nzosa/",
};

export function cloudConfigured(): boolean {
  return CLOUD.url !== "" && CLOUD.publishableKey !== "";
}
