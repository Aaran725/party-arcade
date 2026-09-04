export interface WordEntry {
  word: string;
  category: string;
  decoys: [string, string, string];
}

// Shared by Sleeper Agent (word + category + decoys for the redemption guess) and
// Doodle Relay (word only). Same plain-data-file pattern as trivia-bank.ts.
export const WORD_BANK: WordEntry[] = [
  { word: "Beach", category: "Places", decoys: ["Desert", "Forest", "Mountain"] },
  { word: "Airport", category: "Places", decoys: ["Train Station", "Harbor", "Bus Stop"] },
  { word: "Hospital", category: "Places", decoys: ["School", "Library", "Gym"] },
  { word: "Casino", category: "Places", decoys: ["Museum", "Theater", "Aquarium"] },
  { word: "Restaurant", category: "Places", decoys: ["Bakery", "Cafe", "Diner"] },
  { word: "Space Station", category: "Places", decoys: ["Submarine", "Lighthouse", "Castle"] },
  { word: "Farm", category: "Places", decoys: ["Ranch", "Vineyard", "Orchard"] },
  { word: "Circus", category: "Places", decoys: ["Carnival", "Parade", "Festival"] },

  { word: "Pizza", category: "Food", decoys: ["Burger", "Taco", "Sushi"] },
  { word: "Ice Cream", category: "Food", decoys: ["Cake", "Pie", "Donut"] },
  { word: "Pancakes", category: "Food", decoys: ["Waffles", "French Toast", "Cereal"] },
  { word: "Spaghetti", category: "Food", decoys: ["Ramen", "Lasagna", "Mac and Cheese"] },
  { word: "Popcorn", category: "Food", decoys: ["Pretzel", "Chips", "Nachos"] },
  { word: "Sandwich", category: "Food", decoys: ["Wrap", "Burrito", "Bagel"] },

  { word: "Elephant", category: "Animals", decoys: ["Rhino", "Hippo", "Giraffe"] },
  { word: "Penguin", category: "Animals", decoys: ["Seal", "Walrus", "Otter"] },
  { word: "Octopus", category: "Animals", decoys: ["Squid", "Jellyfish", "Crab"] },
  { word: "Kangaroo", category: "Animals", decoys: ["Koala", "Wallaby", "Wombat"] },
  { word: "Dragon", category: "Animals", decoys: ["Unicorn", "Phoenix", "Griffin"] },
  { word: "Owl", category: "Animals", decoys: ["Eagle", "Hawk", "Falcon"] },
  { word: "Chameleon", category: "Animals", decoys: ["Lizard", "Gecko", "Iguana"] },

  { word: "Superhero", category: "People", decoys: ["Villain", "Wizard", "Pirate"] },
  { word: "Astronaut", category: "People", decoys: ["Pilot", "Scientist", "Explorer"] },
  { word: "Chef", category: "People", decoys: ["Baker", "Waiter", "Farmer"] },
  { word: "Firefighter", category: "People", decoys: ["Police Officer", "Paramedic", "Lifeguard"] },
  { word: "Teacher", category: "People", decoys: ["Coach", "Librarian", "Principal"] },
  { word: "Ninja", category: "People", decoys: ["Samurai", "Knight", "Viking"] },

  { word: "Guitar", category: "Objects", decoys: ["Piano", "Drum", "Violin"] },
  { word: "Umbrella", category: "Objects", decoys: ["Raincoat", "Boots", "Hat"] },
  { word: "Telescope", category: "Objects", decoys: ["Microscope", "Binoculars", "Camera"] },
  { word: "Skateboard", category: "Objects", decoys: ["Bicycle", "Scooter", "Rollerblades"] },
  { word: "Backpack", category: "Objects", decoys: ["Suitcase", "Purse", "Wallet"] },
  { word: "Compass", category: "Objects", decoys: ["Map", "Flashlight", "Rope"] },
  { word: "Robot", category: "Objects", decoys: ["Drone", "Satellite", "Rocket"] },

  { word: "Soccer", category: "Sports", decoys: ["Basketball", "Baseball", "Hockey"] },
  { word: "Surfing", category: "Sports", decoys: ["Skiing", "Snowboarding", "Skating"] },
  { word: "Boxing", category: "Sports", decoys: ["Wrestling", "Fencing", "Karate"] },
  { word: "Bowling", category: "Sports", decoys: ["Golf", "Archery", "Darts"] },

  { word: "Volcano", category: "Nature", decoys: ["Glacier", "Waterfall", "Canyon"] },
  { word: "Rainbow", category: "Nature", decoys: ["Sunset", "Aurora", "Eclipse"] },
  { word: "Tornado", category: "Nature", decoys: ["Hurricane", "Blizzard", "Earthquake"] },
  { word: "Cactus", category: "Nature", decoys: ["Palm Tree", "Bamboo", "Fern"] },

  { word: "Vampire", category: "Fantasy", decoys: ["Zombie", "Ghost", "Werewolf"] },
  { word: "Wizard", category: "Fantasy", decoys: ["Witch", "Sorcerer", "Alchemist"] },
  { word: "Mermaid", category: "Fantasy", decoys: ["Fairy", "Elf", "Genie"] },
  { word: "Time Machine", category: "Fantasy", decoys: ["Portal", "Spaceship", "Crystal Ball"] },
];

export function drawWordEntries(count: number): WordEntry[] {
  const pool = [...WORD_BANK];
  const picked: WordEntry[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}
