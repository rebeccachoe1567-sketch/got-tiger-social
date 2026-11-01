// Default business profile for Got Tiger (K-Dog · Boba · Good Vibes).
// Built from the shop's real Instagram (@got_tiger_k.dog.boba). The owner can edit
// every field from the "Business profile" tab. A price of 0 means "not on file":
// the agents never mention a price for that item, and the checks block any that do.

export type MenuItem = { name: string; price: number; category: string; tags: string[] };

export type Profile = {
  name: string;
  tagline: string;
  instagram: string;
  city: string;
  locations: string;
  latitude: number;
  longitude: number;
  timezone: string;
  hours: string;
  audience: string;
  voice: string;
  example_posts: string[];
  hashtags: string[];
  slow_times: string;
  banned_phrases: string[];
  promotions: string[];
  events: { date: string; name: string }[];
  platforms: string[];
  menu: MenuItem[];
  sample: boolean;
};

export const DEFAULT_PROFILE: Profile = {
  name: "Got Tiger",
  tagline: "K-Dog · Boba · Good Vibes",
  instagram: "got_tiger_k.dog.boba",
  city: "Lakewood, CO",
  locations: "Colorado Mills (Lakewood) and Denver Premium Outlets (Thornton)",
  latitude: 39.7357,
  longitude: -105.1608,
  timezone: "America/Denver",
  hours: "Mall hours (exact hours not on file: don't state times)",
  audience: "Denver-area foodies, mall shoppers, students and families who love K-food, boba and bold flavors",
  voice:
    "Short, punchy hook first (often a question or a pop-culture nod), then one line on the flavor. " +
    "Bold and fun, food-forward and sensory (sweet swirls, crunchy, creamy). Seasonal when it fits. " +
    "2–4 emojis that match the item (🤎🥥🧋🌋🔥🍁). Call corn dogs \"K-Dogs\". No long paragraphs, no corporate tone.",
  example_posts: [
    "Who you gon call? (Ghost Charge, a Green Apple Energy Slush, for spooky season)",
    "Sweet swirls. Creamy coconut. Your next boba crush. 🤎🥥🧋 Coconut Brown Sugar is calling!",
    "Think you can handle the heat? 🌋🔥 Try our NEW Volcano with Buldak Mayo — spicy, crunchy, and seriously addictive!",
    "As fall arrives, every sip gets a little sweeter. 🍁 Indulge in rich brown sugar and chewy boba…",
  ],
  hashtags: ["denverfoodie", "denverdrinks", "denvercolorado", "colorado", "boba", "kdog", "koreancorndog", "lakewoodco"],
  slow_times: "Weekday afternoons (confirm with owner)",
  banned_phrases: ["best in the world", "healthy", "guaranteed", "cheap", "#1 in town", "cure"],
  promotions: [],
  events: [],
  platforms: ["Instagram", "TikTok", "Facebook", "Bluesky"],
  menu: [
    { name: "Volcano K-Dog with Buldak Mayo", price: 0, category: "K-Dog", tags: ["new", "limited time", "spicy", "crunchy"] },
    { name: "Brown Sugar Boba", price: 0, category: "Boba", tags: ["bestseller", "fall favorite"] },
    { name: "Coconut Brown Sugar", price: 0, category: "Boba", tags: ["creamy", "swirls"] },
    { name: "Ghost Charge Green Apple Energy Slush", price: 0, category: "Slush", tags: ["energy drink", "Halloween special — check it's still available"] },
    { name: "Classic K-Dog", price: 0, category: "K-Dog", tags: ["classic", "confirm with owner"] },
    { name: "Mozzarella K-Dog", price: 0, category: "K-Dog", tags: ["cheese pull", "confirm with owner"] },
    { name: "Potato K-Dog", price: 0, category: "K-Dog", tags: ["crunchy", "confirm with owner"] },
  ],
  sample: true,
};

export const PLATFORM_RULES: Record<string, any> = {
  Instagram: {
    max_chars: 2200,
    ideal_chars: "125–300 characters before hashtags",
    hashtags: [3, 8],
    format: "Photo, carousel or Reel. Needs a strong visual (cheese pull, tiger-stripe boba).",
    tips: "Hook in the first line. Put hashtags at the end. Mention location or 'link in bio' for the menu.",
  },
  TikTok: {
    max_chars: 2200,
    ideal_chars: "under 150 characters",
    hashtags: [3, 5],
    format: "Short vertical video (7–20s). Caption supports the video, it is not the main content.",
    tips: "Describe the video hook (e.g., slow-motion cheese pull). Trend-friendly, casual tone.",
  },
  Facebook: {
    max_chars: 2000,
    ideal_chars: "80–250 characters",
    hashtags: [0, 3],
    format: "Photo post. Audience skews toward families and locals.",
    tips: "Friendly and informative. Include hours or a clear reason to visit today.",
  },
  Bluesky: {
    max_chars: 300,
    ideal_chars: "under 280 characters INCLUDING hashtags (hard limit 300)",
    hashtags: [0, 3],
    format: "Text post (image optional).",
    tips: "Conversational and concise. The 300-character limit is strict.",
  },
};
