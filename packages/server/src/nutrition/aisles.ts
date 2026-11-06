import type { Aisle } from "@yamt/shared";

/**
 * The shopping list's aisle of a food (#49), deterministic: from what the food's data carries
 * (Open Food Facts `categories_tags`, the USDA food category), else from keywords in its name, then
 * in the recipe's description; "other" when nothing says. Keywords are German and English, matched
 * on folded words (lowercase, no diacritics, ß → ss): a plain keyword anywhere in a word ("reis" in
 * "Basmatireis"), one with `=` only as a whole word ("ei" is no egg in "Reis"). The groups are read
 * in order, so the more specific comes first: frozen, then pantry (canned "Kichererbsen (Dose)",
 * "Kokosmilch", "Paprikapulver" before produce and dairy), meat and fish, dairy, bakery, drinks
 * ("Orangensaft"), produce.
 */

/** Open Food Facts category tags, checked in this order (the first group with a hit wins). */
const OFF_TAGS: readonly [Aisle, readonly string[]][] = [
  ["frozen", ["en:frozen-foods", "en:frozen-vegetables", "en:frozen-fruits"]],
  [
    "pantry",
    [
      "en:canned-foods",
      "en:canned-vegetables",
      "en:canned-legumes",
      "en:condiments",
      "en:sauces",
      "en:spices",
      "en:fats",
      "en:vegetable-oils",
      "en:cereals-and-their-products",
      "en:pastas",
      "en:rices",
      "en:dried-legumes",
      "en:legumes-and-their-products",
      "en:nuts",
      "en:seeds",
      "en:breakfast-cereals",
      "en:sweeteners",
      "en:flours",
      "en:plant-milks",
      "en:coconut-milks",
      "en:broths",
      "en:snacks",
    ],
  ],
  ["meat_fish", ["en:meats", "en:poultries", "en:fishes", "en:seafood", "en:sausages", "en:hams"]],
  [
    "dairy_eggs",
    ["en:dairies", "en:cheeses", "en:eggs", "en:yogurts", "en:milks", "en:creams", "en:butters"],
  ],
  ["bakery", ["en:breads", "en:pastries", "en:viennoiseries"]],
  ["produce", ["en:fresh-vegetables", "en:fresh-fruits", "en:vegetables", "en:fruits", "en:fresh-herbs"]],
  ["drinks", ["en:beverages", "en:waters", "en:juices"]],
];

/** USDA FoodData Central food categories (SR Legacy, Foundation; branded categories by word). */
const FDC_CATEGORIES: readonly [Aisle, readonly string[]][] = [
  ["frozen", ["frozen"]],
  [
    "produce",
    ["vegetables and vegetable products", "fruits and fruit juices", "pre-packaged fruit & vegetables"],
  ],
  [
    "meat_fish",
    [
      "poultry products",
      "beef products",
      "pork products",
      "lamb, veal, and game products",
      "finfish and shellfish products",
      "sausages and luncheon meats",
      "meat",
      "fish",
      "seafood",
    ],
  ],
  ["dairy_eggs", ["dairy and egg products", "cheese", "milk", "yogurt", "eggs"]],
  ["bakery", ["baked products", "bread"]],
  [
    "pantry",
    [
      "legumes and legume products",
      "cereal grains and pasta",
      "fats and oils",
      "spices and herbs",
      "nut and seed products",
      "soups, sauces, and gravies",
      "sweets",
      "snacks",
      "breakfast cereals",
      "plant-based milk",
      "canned",
      "pasta",
      "rice",
      "oil",
    ],
  ],
  ["drinks", ["beverages"]],
];

/** Keywords by aisle, in the order they are checked. `=word`: a whole word only. */
export const AISLE_KEYWORDS: readonly [Aisle, readonly string[]][] = [
  ["frozen", ["tiefkuhl", "=tk", "gefroren", "frozen"]],
  [
    "pantry",
    [
      "dose",
      "konserve",
      "canned",
      "passiert",
      "tomatenmark",
      "kokosmilch",
      "coconut milk",
      "pulver",
      "gewurz",
      "paste",
      "bruhe",
      "fond",
      "reis",
      "rice",
      "nudel",
      "pasta",
      "spaghetti",
      "penne",
      "linsen",
      "lentil",
      "kichererbse",
      "chickpea",
      "bohnen",
      "beans",
      "mehl",
      "flour",
      "zucker",
      "sugar",
      "honig",
      "=ol",
      "olivenol",
      "rapsol",
      "sesamol",
      "=oil",
      "olive oil",
      "essig",
      "vinegar",
      "senf",
      "sauce",
      "sosse",
      "haferflocken",
      "oats",
      "quinoa",
      "couscous",
      "bulgur",
      "polenta",
      "nuss",
      "nusse",
      "=nut",
      "=nuts",
      "mandel",
      "almond",
      "samen",
      "kerne",
      "seed",
      "=salz",
      "=salt",
      "pfeffer",
      "black pepper",
      "kreuzkummel",
      "kurkuma",
      "zimt",
      "oregano",
      "chiliflocken",
      "brühwürfel",
      "starke",
      "tahin",
      "erdnussbutter",
      "rosinen",
      "backpulver",
      "hefe",
    ],
  ],
  [
    "meat_fish",
    [
      "hahnchen",
      "huhn",
      "chicken",
      "pute",
      "truthahn",
      "turkey",
      "rind",
      "beef",
      "schwein",
      "pork",
      "hack",
      "lamm",
      "lamb",
      "speck",
      "bacon",
      "schinken",
      "=ham",
      "wurst",
      "salami",
      "chorizo",
      "lachs",
      "salmon",
      "thunfisch",
      "tuna",
      "fisch",
      "fish",
      "kabeljau",
      "seelachs",
      "garnele",
      "shrimp",
      "prawn",
    ],
  ],
  [
    "dairy_eggs",
    [
      "milch",
      "milk",
      "joghurt",
      "yogurt",
      "yoghurt",
      "quark",
      "skyr",
      "kase",
      "cheese",
      "feta",
      "mozzarella",
      "parmesan",
      "gouda",
      "halloumi",
      "ricotta",
      "sahne",
      "cream",
      "schmand",
      "creme fraiche",
      "butter",
      "=ei",
      "=eier",
      "=egg",
      "=eggs",
      "tofu",
    ],
  ],
  [
    "bakery",
    ["brot", "bread", "brotchen", "toast", "baguette", "tortilla", "wrap", "fladen", "naan", "pita"],
  ],
  [
    "drinks",
    ["saft", "juice", "=wasser", "mineralwasser", "=water", "limonade", "kaffee", "coffee", "=tee", "=tea"],
  ],
  [
    "produce",
    [
      "kurbis",
      "hokkaido",
      "butternut",
      "pumpkin",
      "zwiebel",
      "onion",
      "schalotte",
      "knoblauch",
      "garlic",
      "ingwer",
      "ginger",
      "spinat",
      "spinach",
      "paprika",
      "tomate",
      "tomato",
      "karotte",
      "mohre",
      "carrot",
      "kartoffel",
      "potato",
      "zucchini",
      "aubergine",
      "brokkoli",
      "broccoli",
      "blumenkohl",
      "cauliflower",
      "kohl",
      "salat",
      "lettuce",
      "gurke",
      "cucumber",
      "lauch",
      "porree",
      "leek",
      "pilz",
      "champignon",
      "mushroom",
      "sellerie",
      "celery",
      "fenchel",
      "mangold",
      "rote bete",
      "radieschen",
      "spargel",
      "erbsen",
      "mais",
      "avocado",
      "limette",
      "=lime",
      "zitrone",
      "lemon",
      "apfel",
      "apple",
      "banane",
      "banana",
      "beere",
      "berry",
      "orange",
      "birne",
      "pear",
      "traube",
      "mango",
      "koriander",
      "cilantro",
      "petersilie",
      "parsley",
      "basilikum",
      "basil",
      "schnittlauch",
      "minze",
      "mint",
      "dill",
      "rucola",
      "chili",
      "fruhlingszwiebel",
    ],
  ],
];

/** Lowercase, without diacritics, ß → ss, the rest of the punctuation as spaces. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The first aisle whose keyword is in `text` (folded words), else null. */
export function aisleByKeyword(text: string): Aisle | null {
  const folded = fold(text);
  if (!folded) return null;
  const words = new Set(folded.split(" "));
  for (const [aisle, keywords] of AISLE_KEYWORDS) {
    for (const k of keywords) {
      if (k.startsWith("=") ? words.has(k.slice(1)) : folded.includes(fold(k))) return aisle;
    }
  }
  return null;
}

/** The first aisle a food's categories name (OFF tags, USDA categories), else null. */
export function aisleByCategories(categories: readonly string[]): Aisle | null {
  if (categories.length === 0) return null;
  const tags = new Set(categories.filter((c) => /^[a-z]{2}:/.test(c)));
  for (const [aisle, wanted] of OFF_TAGS) if (wanted.some((t) => tags.has(t))) return aisle;
  const names = categories.filter((c) => !/^[a-z]{2}:/.test(c)).map((c) => c.toLowerCase());
  for (const [aisle, wanted] of FDC_CATEGORIES) {
    if (names.some((n) => wanted.some((w) => n === w || n.includes(w)))) return aisle;
  }
  return null;
}

/**
 * A line's aisle: the food's categories, else a keyword in the food's name, else in the
 * description, else "other".
 */
export function aisleOf(
  food: { name: string; categories: readonly string[] } | null,
  description: string,
): Aisle {
  return (
    (food ? (aisleByCategories(food.categories) ?? aisleByKeyword(food.name)) : null) ??
    aisleByKeyword(description) ??
    "other"
  );
}
