// Supabase's OAuth server sends a person here to allow an AI app to
// connect. The app answers it (src/connect-consent.ts): pass the request on.
// A file of its own, as the site's security policy runs no inline script.
document.getElementById("go").href = "../../" + location.search;
location.replace("../../" + location.search);
