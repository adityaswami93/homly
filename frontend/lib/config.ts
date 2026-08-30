// Central config — update this file to change branding across the app
const config = {
  appName:      "Homly",
  tagline:      "The agent that runs your household.",
  description:  "Homly manages what a household actually runs on — money, supplies, schedule and cover. It reads what it needs, remembers what matters, and raises things before they become problems. Reach it in your group chat or on the dashboard.",
  elevator:     "An AI agent that runs the household — money, supplies, schedule and insurance — reachable from your family group chat or a dashboard.",
  twitterHandle: "",
  supportEmail: "",
  siteUrl:      process.env.NEXT_PUBLIC_SITE_URL || "https://homly-six.vercel.app",
};

export default config;
