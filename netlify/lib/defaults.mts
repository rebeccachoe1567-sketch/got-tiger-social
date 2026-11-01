// Default business profile for Got Tiger (K-Dog · Boba · Good Vibes).
// Built from the shop's real Instagram (@got_tiger_k.dog.boba). The owner can edit
// every field from the "Business profile" tab. Menu and prices come from the shop's
// K-Dog menu and Colorado Mills drink menu. A price of 0 means "not on file":
// the agents never mention a price for that item, and the checks block any that do.

export type MenuItem = {
  name: string;
  price: number; // regular / base price; 0 = not on file
  category: string;
  tags: string[];
  sizes?: { label: string; price: number }[]; // other sizes or versions, e.g. Large, Bulb Cup, "with Potato"
  description?: string; // flavors, toppings, allergens
};

export type Profile = {
  name: string;
  former_name: string;
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
  former_name: "ThirsTea Tiger (old name, still on some cups and signs while the rebrand finishes)",
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
    "Think you can handle the heat? 🌋🔥 Try our NEW Volcano with Buldak Mayo: spicy, crunchy, and seriously addictive!",
    "As fall arrives, every sip gets a little sweeter. 🍁 Indulge in rich brown sugar and chewy boba…",
  ],
  hashtags: ["denverfoodie", "denverdrinks", "denvercolorado", "colorado", "boba", "kdog", "koreancorndog", "lakewoodco"],
  slow_times: "Weekday afternoons (confirm with owner)",
  banned_phrases: ["best in the world", "healthy", "guaranteed", "cheap", "#1 in town", "cure", "gluten-free", "dairy-free", "allergen-free"],
  promotions: [],
  events: [],
  platforms: ["Instagram", "TikTok", "Facebook", "Bluesky"],
  menu: [
    // K-Dogs (ThirsTea Tiger menu). Fillings: Beef Sausage or Mozzarella included; upgrades below.
    { name: "K-Dog Classic", price: 5.25, category: "K-Dog", tags: ["classic", "bread crumbs"], description: "Wrapped in bread crumbs. Contains egg, milk, wheat." },
    { name: "K-Dog Potato", price: 6.25, category: "K-Dog", tags: ["crunchy", "fan favorite"], description: "Wrapped in potatoes. Contains egg, milk, wheat." },
    { name: "Crispy Ramen K-Dog", price: 6.25, category: "K-Dog", tags: ["crunchy", "ramen"], description: "Wrapped in ramen. Contains egg, milk, wheat." },
    { name: "Flamin Hot K-Dog", price: 6.25, category: "K-Dog", tags: ["spicy", "viral"], sizes: [{ label: "with Potato", price: 7.25 }], description: "Signature spicy sauce topped with Cheetos. Contains egg, milk, wheat." },
    { name: "Cheese Monster K-Dog", price: 6.25, category: "K-Dog", tags: ["cheesy", "loaded"], sizes: [{ label: "with Potato", price: 7.25 }], description: "Topped with nacho cheese. Contains egg, milk, wheat." },
    { name: "K-Dog Elote", price: 8, category: "K-Dog", tags: ["loaded", "street corn"], sizes: [{ label: "with Potato", price: 9 }], description: "Topped with mayo, corn and parmesan cheese. Contains egg, milk, wheat." },
    { name: "Volcano K-Dog with Buldak Mayo", price: 0, category: "K-Dog", tags: ["new", "limited time", "spicy", "crunchy"], description: "New limited-time K-Dog with spicy Buldak mayo. Price not on file yet." },
    { name: "Filling upgrade", price: 1, category: "Add-on", tags: ["add-on"], sizes: [{ label: "Spicy Half & Half", price: 1.25 }], description: "Beef Sausage or Mozzarella included. Half & Half, Beef Spicy Sausage or Pepper Jack Cheese +$1; Spicy Half & Half +$1.25." },
    // Drinks (Colorado Mills menu)
    { name: "Brown Sugar Boba", price: 6.85, category: "Boba", tags: ["bestseller", "fall favorite"], description: "One size. Flavors: Milk Tea, Coconut, Thai Tea, Taro. Contains milk." },
    { name: "Coconut Brown Sugar", price: 6.85, category: "Boba", tags: ["creamy", "swirls"], description: "Brown Sugar Boba, coconut flavor. One size. Contains milk." },
    { name: "Milk Tea Boba", price: 5, category: "Boba", tags: ["classic"], sizes: [{ label: "Large", price: 6 }, { label: "Bulb Cup", price: 12.5 }], description: "Flavors: Chocolate, Coconut, Coffee, Green Tea, Honeydew, Mango, Milk Tea, Strawberry, Taro, Thai Tea. Contains milk." },
    { name: "Fruit Tea Boba", price: 6.5, category: "Boba", tags: ["fruity", "refreshing"], description: "One size. Flavors: Blueberry, Lychee, Mango, Passion Fruit, Peach, Pineapple, Raspberry, Strawberry." },
    { name: "Electric Slush Boba", price: 6.5, category: "Slush", tags: ["energy drink", "slush"], description: "Energy drink slush, one size. Flavors: Blueberry, Blood Orange, Green Apple, Mango, Passion Fruit, Peach, Pineapple, Pomegranate, Raspberry, Strawberry, Kiwi, Watermelon." },
    { name: "Ghost Charge Green Apple Energy Slush", price: 6.5, category: "Slush", tags: ["Halloween special, check it's still available"], description: "Halloween name for the Green Apple Electric Slush Boba." },
    { name: "Mangonada Boba", price: 8.25, category: "Slush", tags: ["photogenic", "sweet and spicy"], description: "Mango slush with chamoy, tajin, mixed jelly and mangoes. One size." },
    { name: "Galaxyade Boba", price: 6.5, category: "Lemonade", tags: ["photogenic", "colorful"], description: "Galaxy-colored lemonade with mixed jelly. One size." },
    { name: "Sunshine Boba", price: 6.5, category: "Lemonade", tags: ["bright", "refreshing"], description: "Passion tea lemonade with strawberry jelly. One size." },
    { name: "Lemonade", price: 4.25, category: "Lemonade", tags: ["refreshing"], sizes: [{ label: "Large", price: 4.75 }], description: "Flavors: Blueberry, Blood Orange, Green Apple, Mango, Passion Fruit, Peach, Pineapple, Pomegranate, Raspberry, Strawberry, Kiwi, Watermelon." },
    { name: "Bulb Soda", price: 6, category: "Soda", tags: ["photogenic", "bulb cup"], sizes: [{ label: "Bulb Cup", price: 12.5 }], description: "Flavors: Blueberry, Blood Orange, Cherry Lime, Cotton Candy, Green Apple, Mango, Passion Fruit, Peach, Pineapple, Pomegranate, Raspberry, Strawberry, Kiwi, Watermelon." },
  ],
  sample: false,
};

export type PlatformRules = { max_chars: number; ideal_chars: string; hashtags: [number, number]; format: string; tips: string };
export const PLATFORM_RULES: Record<string, PlatformRules> = {
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
