// Default business profile for Got Tiger.
// The owner can edit every field from the "Business profile" tab in the app.
// Menu items and prices below are SAMPLE values until the owner replaces them.

export type MenuItem = { name: string; price: number; category: string; tags: string[] };

export type Profile = {
  name: string;
  tagline: string;
  city: string;
  latitude: number;
  longitude: number;
  timezone: string;
  hours: string;
  audience: string;
  voice: string;
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
  tagline: "Korean corn dogs & boba",
  city: "Boulder, CO",
  latitude: 40.015,
  longitude: -105.2705,
  timezone: "America/Denver",
  hours: "Mon–Thu 11am–9pm, Fri–Sat 11am–10pm, Sun 12pm–8pm",
  audience: "College students, families, and K-food fans looking for a fun, shareable snack",
  voice:
    "Playful, warm and family-owned. At most one light tiger pun per post (roar, grrr-eat, fierce). " +
    "Celebrate Korean street-food culture. Emojis welcome (🐯🌽🧋) but no more than 4. Never pushy, never salesy, no ALL CAPS shouting.",
  slow_times: "Tuesday and Wednesday afternoons, 2–5pm",
  banned_phrases: ["best in the world", "healthy", "guaranteed", "cheap", "#1 in town", "cure", "addictive"],
  promotions: ["Student Tuesday: 10% off any combo with a student ID (Tuesdays only)"],
  events: [],
  platforms: ["Instagram", "TikTok", "Facebook", "Bluesky"],
  menu: [
    { name: "Classic Sausage Dog", price: 4.99, category: "Corn dog", tags: ["bestseller", "classic"] },
    { name: "Mozzarella Dog", price: 5.49, category: "Corn dog", tags: ["cheese pull", "bestseller"] },
    { name: "Half & Half Dog", price: 5.49, category: "Corn dog", tags: ["cheese pull", "sausage"] },
    { name: "Potato Dog", price: 6.49, category: "Corn dog", tags: ["crunchy", "fan favorite"] },
    { name: "Hot Cheetos Dog", price: 6.49, category: "Corn dog", tags: ["spicy", "viral"] },
    { name: "Ramen Crunch Dog", price: 6.49, category: "Corn dog", tags: ["crunchy", "new"] },
    { name: "Classic Milk Tea", price: 5.75, category: "Boba", tags: ["classic", "iced or hot"] },
    { name: "Brown Sugar Boba Milk", price: 6.25, category: "Boba", tags: ["bestseller", "tiger stripes"] },
    { name: "Taro Milk Tea", price: 5.95, category: "Boba", tags: ["purple", "creamy"] },
    { name: "Mango Green Tea", price: 5.75, category: "Boba", tags: ["fruity", "iced", "refreshing"] },
    { name: "Strawberry Matcha Latte", price: 6.25, category: "Boba", tags: ["layered", "photogenic"] },
    { name: "Thai Tea", price: 5.75, category: "Boba", tags: ["sweet", "iced"] },
    { name: "Dog + Drink Combo", price: 10.49, category: "Combo", tags: ["value", "student favorite"] },
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
