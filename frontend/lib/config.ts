// Central config — update this file to change branding across the app
const config = {
  appName:      "Homly",
  tagline:      "The household manager for families.",
  description:  "Homly manages what your household actually runs on — the money, the supplies, the schedule, the renewals. It reads what it needs, learns how you like things done, and comes to you only when something needs a decision.",
  elevator:     "A household manager for families — large households have always had someone running them; Homly is that role for everyone else, reachable from your group chat or a dashboard.",
  twitterHandle: "",
  supportEmail: "",
  siteUrl:      process.env.NEXT_PUBLIC_SITE_URL || "https://homly-six.vercel.app",
};

export default config;
