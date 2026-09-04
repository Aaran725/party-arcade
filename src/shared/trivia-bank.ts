export interface TriviaQuestion {
  question: string;
  choices: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  category: string;
}

// ~160 general-knowledge questions across nine categories, architected as plain data
// so more can be appended later without touching any game logic.
export const TRIVIA_BANK: TriviaQuestion[] = [
  // Geography
  { question: "What is the capital of Australia?", choices: ["Sydney", "Melbourne", "Canberra", "Perth"], correctIndex: 2, category: "Geography" },
  { question: "Which is the longest river in the world?", choices: ["Amazon", "Nile", "Yangtze", "Mississippi"], correctIndex: 1, category: "Geography" },
  { question: "Which country has the most time zones?", choices: ["Russia", "USA", "France", "China"], correctIndex: 2, category: "Geography" },
  { question: "What is the smallest country in the world?", choices: ["Monaco", "San Marino", "Vatican City", "Liechtenstein"], correctIndex: 2, category: "Geography" },
  { question: "Mount Kilimanjaro is located in which country?", choices: ["Kenya", "Tanzania", "Uganda", "Ethiopia"], correctIndex: 1, category: "Geography" },
  { question: "Which desert is the largest in the world?", choices: ["Sahara", "Gobi", "Antarctic", "Arabian"], correctIndex: 2, category: "Geography" },
  { question: "What is the capital of Canada?", choices: ["Toronto", "Vancouver", "Ottawa", "Montreal"], correctIndex: 2, category: "Geography" },
  { question: "Which ocean is the largest?", choices: ["Atlantic", "Indian", "Arctic", "Pacific"], correctIndex: 3, category: "Geography" },

  // Science
  { question: "What is the chemical symbol for gold?", choices: ["Go", "Gd", "Au", "Ag"], correctIndex: 2, category: "Science" },
  { question: "How many bones are in the adult human body?", choices: ["186", "206", "226", "246"], correctIndex: 1, category: "Science" },
  { question: "What planet is known as the Red Planet?", choices: ["Venus", "Jupiter", "Mars", "Saturn"], correctIndex: 2, category: "Science" },
  { question: "What gas do plants absorb from the atmosphere?", choices: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], correctIndex: 2, category: "Science" },
  { question: "What is the hardest natural substance on Earth?", choices: ["Gold", "Diamond", "Quartz", "Titanium"], correctIndex: 1, category: "Science" },
  { question: "What is the speed of light approximately?", choices: ["300,000 km/s", "150,000 km/s", "3,000 km/s", "30,000 km/s"], correctIndex: 0, category: "Science" },
  { question: "Which organ pumps blood through the body?", choices: ["Lungs", "Liver", "Heart", "Kidney"], correctIndex: 2, category: "Science" },
  { question: "What is the boiling point of water at sea level (Celsius)?", choices: ["90°C", "95°C", "100°C", "110°C"], correctIndex: 2, category: "Science" },
  { question: "What force keeps planets in orbit around the sun?", choices: ["Magnetism", "Gravity", "Friction", "Inertia"], correctIndex: 1, category: "Science" },

  // History
  { question: "In what year did World War II end?", choices: ["1943", "1945", "1947", "1950"], correctIndex: 1, category: "History" },
  { question: "Who was the first President of the United States?", choices: ["Thomas Jefferson", "John Adams", "George Washington", "Benjamin Franklin"], correctIndex: 2, category: "History" },
  { question: "Which ancient civilization built the pyramids of Giza?", choices: ["Romans", "Greeks", "Egyptians", "Mayans"], correctIndex: 2, category: "History" },
  { question: "The Great Wall was built primarily to defend which country?", choices: ["Japan", "China", "Mongolia", "Korea"], correctIndex: 1, category: "History" },
  { question: "Who painted the Mona Lisa?", choices: ["Michelangelo", "Leonardo da Vinci", "Raphael", "Donatello"], correctIndex: 1, category: "History" },
  { question: "In which year did the Titanic sink?", choices: ["1905", "1912", "1918", "1923"], correctIndex: 1, category: "History" },
  { question: "Which empire was ruled by Julius Caesar?", choices: ["Greek", "Ottoman", "Roman", "Persian"], correctIndex: 2, category: "History" },

  // Pop Culture / Entertainment
  { question: "Which movie franchise features a character named Frodo?", choices: ["Star Wars", "Harry Potter", "The Lord of the Rings", "Narnia"], correctIndex: 2, category: "Pop Culture" },
  { question: "Who directed the movie 'Jaws'?", choices: ["George Lucas", "Steven Spielberg", "James Cameron", "Martin Scorsese"], correctIndex: 1, category: "Pop Culture" },
  { question: "What is the best-selling video game of all time?", choices: ["Tetris", "Minecraft", "GTA V", "Wii Sports"], correctIndex: 1, category: "Pop Culture" },
  { question: "Which band released the album 'Abbey Road'?", choices: ["The Rolling Stones", "The Beatles", "Led Zeppelin", "Pink Floyd"], correctIndex: 1, category: "Pop Culture" },
  { question: "In which fictional city does Batman operate?", choices: ["Metropolis", "Gotham City", "Star City", "Central City"], correctIndex: 1, category: "Pop Culture" },
  { question: "What is the highest-grossing film of all time (unadjusted)?", choices: ["Titanic", "Avatar", "Avengers: Endgame", "Star Wars"], correctIndex: 1, category: "Pop Culture" },

  // Sports
  { question: "How many players are on a standard soccer team on the field?", choices: ["9", "10", "11", "12"], correctIndex: 2, category: "Sports" },
  { question: "In which sport would you perform a slam dunk?", choices: ["Volleyball", "Basketball", "Tennis", "Baseball"], correctIndex: 1, category: "Sports" },
  { question: "How often are the Summer Olympic Games held?", choices: ["Every 2 years", "Every 3 years", "Every 4 years", "Every 5 years"], correctIndex: 2, category: "Sports" },
  { question: "What sport is known as 'the beautiful game'?", choices: ["Basketball", "Cricket", "Soccer", "Rugby"], correctIndex: 2, category: "Sports" },
  { question: "In tennis, what is a score of zero called?", choices: ["Nil", "Love", "Zero", "Duck"], correctIndex: 1, category: "Sports" },

  // Food & Miscellaneous
  { question: "What is the main ingredient in guacamole?", choices: ["Tomato", "Avocado", "Onion", "Pepper"], correctIndex: 1, category: "Food" },
  { question: "Which country is the origin of pizza?", choices: ["France", "Spain", "Italy", "Greece"], correctIndex: 2, category: "Food" },
  { question: "What is the most consumed beverage in the world after water?", choices: ["Coffee", "Tea", "Milk", "Juice"], correctIndex: 1, category: "Food" },
  { question: "How many strings does a standard guitar have?", choices: ["4", "5", "6", "7"], correctIndex: 2, category: "Miscellaneous" },
  { question: "What is the largest mammal in the world?", choices: ["African elephant", "Blue whale", "Giraffe", "Polar bear"], correctIndex: 1, category: "Miscellaneous" },
  { question: "How many continents are there on Earth?", choices: ["5", "6", "7", "8"], correctIndex: 2, category: "Miscellaneous" },
  { question: "What is the currency of Japan?", choices: ["Yuan", "Won", "Yen", "Ringgit"], correctIndex: 2, category: "Miscellaneous" },
  { question: "Which language has the most native speakers worldwide?", choices: ["English", "Spanish", "Hindi", "Mandarin Chinese"], correctIndex: 3, category: "Miscellaneous" },
  { question: "What do bees produce that humans eat?", choices: ["Nectar", "Honey", "Pollen", "Wax"], correctIndex: 1, category: "Miscellaneous" },
  { question: "How many colors are in a rainbow?", choices: ["5", "6", "7", "8"], correctIndex: 2, category: "Miscellaneous" },
  { question: "What is the tallest animal in the world?", choices: ["Elephant", "Giraffe", "Ostrich", "Horse"], correctIndex: 1, category: "Miscellaneous" },
  { question: "Which planet has the most moons?", choices: ["Jupiter", "Saturn", "Uranus", "Neptune"], correctIndex: 1, category: "Science" },
  { question: "What shape has three sides?", choices: ["Square", "Pentagon", "Triangle", "Hexagon"], correctIndex: 2, category: "Miscellaneous" },
  { question: "What do you call a group of lions?", choices: ["Pack", "Herd", "Pride", "Flock"], correctIndex: 2, category: "Miscellaneous" },

  // Geography (more)
  { question: "What is the capital of Japan?", choices: ["Osaka", "Tokyo", "Kyoto", "Nagoya"], correctIndex: 1, category: "Geography" },
  { question: "Which continent is the Sahara Desert located on?", choices: ["Asia", "Africa", "Australia", "South America"], correctIndex: 1, category: "Geography" },
  { question: "What is the longest mountain range in the world?", choices: ["Himalayas", "Rocky Mountains", "Andes", "Alps"], correctIndex: 2, category: "Geography" },
  { question: "Which country is home to the Great Barrier Reef?", choices: ["Australia", "Indonesia", "Philippines", "Thailand"], correctIndex: 0, category: "Geography" },
  { question: "What is the capital of Egypt?", choices: ["Alexandria", "Cairo", "Giza", "Luxor"], correctIndex: 1, category: "Geography" },
  { question: "Which river flows through Paris?", choices: ["Rhine", "Seine", "Danube", "Loire"], correctIndex: 1, category: "Geography" },
  { question: "What is the smallest continent by land area?", choices: ["Europe", "Antarctica", "Australia", "South America"], correctIndex: 2, category: "Geography" },
  { question: "Which country has the most natural lakes?", choices: ["USA", "Russia", "Canada", "Finland"], correctIndex: 2, category: "Geography" },
  { question: "What is the capital of South Korea?", choices: ["Busan", "Seoul", "Incheon", "Daegu"], correctIndex: 1, category: "Geography" },
  { question: "Mount Everest sits on the border of Nepal and which other country?", choices: ["India", "Bhutan", "China", "Pakistan"], correctIndex: 2, category: "Geography" },

  // Science (more)
  { question: "What is the chemical symbol for sodium?", choices: ["So", "Sd", "Na", "Sn"], correctIndex: 2, category: "Science" },
  { question: "What part of the cell contains genetic material?", choices: ["Cytoplasm", "Nucleus", "Mitochondria", "Ribosome"], correctIndex: 1, category: "Science" },
  { question: "How many planets are in our solar system?", choices: ["7", "8", "9", "10"], correctIndex: 1, category: "Science" },
  { question: "What is the freezing point of water in Fahrenheit?", choices: ["0°F", "32°F", "100°F", "212°F"], correctIndex: 1, category: "Science" },
  { question: "What type of animal is a Komodo dragon?", choices: ["Snake", "Lizard", "Crocodile", "Amphibian"], correctIndex: 1, category: "Science" },
  { question: "What gas do humans exhale that plants use for photosynthesis?", choices: ["Oxygen", "Carbon dioxide", "Nitrogen", "Helium"], correctIndex: 1, category: "Science" },
  { question: "What is the study of earthquakes called?", choices: ["Geology", "Seismology", "Meteorology", "Volcanology"], correctIndex: 1, category: "Science" },
  { question: "Which blood type is known as the universal donor?", choices: ["A", "B", "AB", "O negative"], correctIndex: 3, category: "Science" },
  { question: "What is often called the powerhouse of the cell?", choices: ["Nucleus", "Ribosome", "Mitochondria", "Golgi body"], correctIndex: 2, category: "Science" },
  { question: "How many chromosomes do humans typically have?", choices: ["23", "46", "44", "48"], correctIndex: 1, category: "Science" },

  // History (more)
  { question: "Who was the first man to walk on the moon?", choices: ["Buzz Aldrin", "Neil Armstrong", "Yuri Gagarin", "John Glenn"], correctIndex: 1, category: "History" },
  { question: "In what year did the Berlin Wall fall?", choices: ["1987", "1989", "1991", "1993"], correctIndex: 1, category: "History" },
  { question: "Which country gifted the Statue of Liberty to the USA?", choices: ["England", "Spain", "France", "Italy"], correctIndex: 2, category: "History" },
  { question: "Who wrote the Declaration of Independence?", choices: ["Benjamin Franklin", "Thomas Jefferson", "John Adams", "Alexander Hamilton"], correctIndex: 1, category: "History" },
  { question: "The Renaissance began in which country?", choices: ["France", "Italy", "Spain", "Germany"], correctIndex: 1, category: "History" },
  { question: "The American Civil War was fought between which two regions?", choices: ["East and West", "North and South", "Coastal and Inland", "Federal and Colonial"], correctIndex: 1, category: "History" },
  { question: "Who was the first Emperor of Rome?", choices: ["Julius Caesar", "Nero", "Augustus", "Constantine"], correctIndex: 2, category: "History" },
  { question: "Which explorer is credited with reaching the Americas in 1492?", choices: ["Vasco da Gama", "Christopher Columbus", "Ferdinand Magellan", "Marco Polo"], correctIndex: 1, category: "History" },
  { question: "Ancient Rome was famously built on how many hills?", choices: ["5", "6", "7", "8"], correctIndex: 2, category: "History" },
  { question: "Which 1215 document limited the power of English kings?", choices: ["The Magna Carta", "The Bill of Rights", "The Domesday Book", "The Treaty of Versailles"], correctIndex: 0, category: "History" },

  // Pop Culture (more)
  { question: "Which streaming service produced 'Stranger Things'?", choices: ["Hulu", "Netflix", "Amazon Prime", "Disney+"], correctIndex: 1, category: "Pop Culture" },
  { question: "Who played Iron Man in the Marvel Cinematic Universe?", choices: ["Chris Evans", "Chris Hemsworth", "Robert Downey Jr.", "Mark Ruffalo"], correctIndex: 2, category: "Pop Culture" },
  { question: "What is the name of the wizarding school in Harry Potter?", choices: ["Hogwarts", "Beauxbatons", "Durmstrang", "Ilvermorny"], correctIndex: 0, category: "Pop Culture" },
  { question: "Which artist painted 'The Starry Night'?", choices: ["Claude Monet", "Vincent van Gogh", "Pablo Picasso", "Salvador Dalí"], correctIndex: 1, category: "Pop Culture" },
  { question: "What was Pixar's first feature film?", choices: ["Cars", "Finding Nemo", "Toy Story", "A Bug's Life"], correctIndex: 2, category: "Pop Culture" },
  { question: "In 'The Simpsons', what is the family dog's name?", choices: ["Snowball", "Santa's Little Helper", "Bart Jr.", "Rex"], correctIndex: 1, category: "Pop Culture" },
  { question: "Which show is set in the fictional town of Pawnee, Indiana?", choices: ["The Office", "Parks and Recreation", "Brooklyn Nine-Nine", "Community"], correctIndex: 1, category: "Pop Culture" },
  { question: "Who wrote the 'Harry Potter' book series?", choices: ["J.R.R. Tolkien", "J.K. Rowling", "C.S. Lewis", "Roald Dahl"], correctIndex: 1, category: "Pop Culture" },
  { question: "What color is Kermit the Frog?", choices: ["Blue", "Red", "Green", "Yellow"], correctIndex: 2, category: "Pop Culture" },
  { question: "Which movie features the song 'Let It Go'?", choices: ["Moana", "Frozen", "Tangled", "Encanto"], correctIndex: 1, category: "Pop Culture" },

  // Sports (more)
  { question: "How many holes are played in a standard round of golf?", choices: ["9", "12", "18", "21"], correctIndex: 2, category: "Sports" },
  { question: "In which country was cricket invented?", choices: ["Australia", "India", "England", "South Africa"], correctIndex: 2, category: "Sports" },
  { question: "How many players are on a basketball team on the court at once?", choices: ["4", "5", "6", "7"], correctIndex: 1, category: "Sports" },
  { question: "What is the maximum score possible in ten-pin bowling?", choices: ["200", "250", "300", "350"], correctIndex: 2, category: "Sports" },
  { question: "Which country has won the most FIFA World Cups?", choices: ["Germany", "Argentina", "Italy", "Brazil"], correctIndex: 3, category: "Sports" },
  { question: "In championship boxing, how many rounds are typically fought?", choices: ["8", "10", "12", "15"], correctIndex: 2, category: "Sports" },
  { question: "What sport uses a shuttlecock?", choices: ["Tennis", "Badminton", "Squash", "Table Tennis"], correctIndex: 1, category: "Sports" },
  { question: "How many players are on a rugby union team?", choices: ["11", "13", "15", "17"], correctIndex: 2, category: "Sports" },

  // Food (more)
  { question: "What type of pastry is closest to a croissant?", choices: ["Shortcrust", "Puff pastry", "Filo pastry", "Choux pastry"], correctIndex: 1, category: "Food" },
  { question: "Which fruit is known as the 'king of fruits' in Southeast Asia?", choices: ["Mango", "Durian", "Jackfruit", "Papaya"], correctIndex: 1, category: "Food" },
  { question: "What is sushi traditionally wrapped in?", choices: ["Lettuce", "Nori (seaweed)", "Rice paper", "Banana leaf"], correctIndex: 1, category: "Food" },
  { question: "Which spice is derived from the Crocus flower?", choices: ["Turmeric", "Saffron", "Paprika", "Cumin"], correctIndex: 1, category: "Food" },
  { question: "What is the main ingredient in traditional hummus?", choices: ["Lentils", "Chickpeas", "Black beans", "Peas"], correctIndex: 1, category: "Food" },
  { question: "Traditional mozzarella di bufala is made from which animal's milk?", choices: ["Cow's milk", "Buffalo milk", "Goat milk", "Sheep milk"], correctIndex: 1, category: "Food" },
  { question: "What is the most expensive spice in the world by weight?", choices: ["Vanilla", "Cardamom", "Saffron", "Cinnamon"], correctIndex: 2, category: "Food" },
  { question: "Which vegetable is the primary ingredient in coleslaw?", choices: ["Lettuce", "Cabbage", "Spinach", "Kale"], correctIndex: 1, category: "Food" },

  // Miscellaneous (more)
  { question: "How many sides does a hexagon have?", choices: ["5", "6", "7", "8"], correctIndex: 1, category: "Miscellaneous" },
  { question: "What is the largest organ in the human body?", choices: ["Liver", "Brain", "Skin", "Heart"], correctIndex: 2, category: "Miscellaneous" },
  { question: "How many minutes are in a full day?", choices: ["1140", "1400", "1440", "1500"], correctIndex: 2, category: "Miscellaneous" },
  { question: "What do you call a baby kangaroo?", choices: ["Cub", "Joey", "Kit", "Pup"], correctIndex: 1, category: "Miscellaneous" },
  { question: "Which instrument has 88 keys?", choices: ["Organ", "Piano", "Accordion", "Harpsichord"], correctIndex: 1, category: "Miscellaneous" },
  { question: "What is the national flower of Japan?", choices: ["Rose", "Cherry Blossom", "Lotus", "Tulip"], correctIndex: 1, category: "Miscellaneous" },
  { question: "How many letters are in the English alphabet?", choices: ["24", "25", "26", "27"], correctIndex: 2, category: "Miscellaneous" },
  { question: "Mixing blue and yellow paint primarily makes which color?", choices: ["Purple", "Orange", "Green", "Brown"], correctIndex: 2, category: "Miscellaneous" },

  // Technology
  { question: "Who co-founded Apple alongside Steve Jobs?", choices: ["Bill Gates", "Steve Wozniak", "Elon Musk", "Jeff Bezos"], correctIndex: 1, category: "Technology" },
  { question: "What does 'CPU' stand for?", choices: ["Central Process Unit", "Central Processing Unit", "Computer Personal Unit", "Central Processor Utility"], correctIndex: 1, category: "Technology" },
  { question: "What year was the first iPhone released?", choices: ["2005", "2007", "2009", "2010"], correctIndex: 1, category: "Technology" },
  { question: "What does 'WWW' stand for?", choices: ["World Wide Web", "World Wide Wire", "Web Wide World", "World Web Wire"], correctIndex: 0, category: "Technology" },
  { question: "Which company created the Android operating system?", choices: ["Apple", "Microsoft", "Google", "Samsung"], correctIndex: 2, category: "Technology" },
  { question: "What does 'HTML' stand for?", choices: ["Hyper Text Markup Language", "High Tech Modern Language", "Hyperlink Text Management Language", "Home Tool Markup Language"], correctIndex: 0, category: "Technology" },
  { question: "Which social platform historically used a bird as its logo?", choices: ["Facebook", "Instagram", "Twitter/X", "LinkedIn"], correctIndex: 2, category: "Technology" },
  { question: "What does 'GPU' stand for?", choices: ["General Processing Unit", "Graphics Processing Unit", "Global Processing Unit", "Game Processing Unit"], correctIndex: 1, category: "Technology" },
  { question: "Who is considered a founder of Microsoft?", choices: ["Steve Jobs", "Bill Gates", "Larry Page", "Mark Zuckerberg"], correctIndex: 1, category: "Technology" },
  { question: "What is the name of Amazon's virtual assistant?", choices: ["Siri", "Cortana", "Alexa", "Bixby"], correctIndex: 2, category: "Technology" },
  { question: "What does 'USB' stand for?", choices: ["Universal Serial Bus", "United System Bus", "Universal System Board", "Unified Serial Board"], correctIndex: 0, category: "Technology" },
  { question: "Which company developed the PlayStation console?", choices: ["Microsoft", "Nintendo", "Sony", "Sega"], correctIndex: 2, category: "Technology" },
  { question: "Which language is primarily used for styling web pages?", choices: ["HTML", "CSS", "Python", "Java"], correctIndex: 1, category: "Technology" },
  { question: "What does 'AI' commonly stand for?", choices: ["Automated Interface", "Artificial Intelligence", "Applied Informatics", "Advanced Integration"], correctIndex: 1, category: "Technology" },
  { question: "Which company owns YouTube?", choices: ["Microsoft", "Google", "Apple", "Amazon"], correctIndex: 1, category: "Technology" },

  // Music
  { question: "How many strings does a standard violin have?", choices: ["3", "4", "5", "6"], correctIndex: 1, category: "Music" },
  { question: "Which composer wrote his Ninth Symphony while completely deaf?", choices: ["Mozart", "Bach", "Beethoven", "Chopin"], correctIndex: 2, category: "Music" },
  { question: "What is the term for singing without instrumental accompaniment?", choices: ["Falsetto", "A cappella", "Vibrato", "Staccato"], correctIndex: 1, category: "Music" },
  { question: "Which Beatle was known as the 'quiet one'?", choices: ["John Lennon", "Paul McCartney", "George Harrison", "Ringo Starr"], correctIndex: 2, category: "Music" },
  { question: "Which instrument has pedals plus black and white keys?", choices: ["Organ", "Piano", "Harp", "Xylophone"], correctIndex: 1, category: "Music" },
  { question: "Which pop star is known as the 'King of Pop'?", choices: ["Elvis Presley", "Michael Jackson", "Prince", "Justin Timberlake"], correctIndex: 1, category: "Music" },
  { question: "What genre of music originated in New Orleans in the early 20th century?", choices: ["Rock", "Jazz", "Blues", "Country"], correctIndex: 1, category: "Music" },
  { question: "Which artist released the album '1989'?", choices: ["Beyoncé", "Adele", "Taylor Swift", "Rihanna"], correctIndex: 2, category: "Music" },
  { question: "How many lines are on a standard musical staff?", choices: ["4", "5", "6", "7"], correctIndex: 1, category: "Music" },
  { question: "Which band performed 'Bohemian Rhapsody'?", choices: ["The Rolling Stones", "Queen", "Led Zeppelin", "Pink Floyd"], correctIndex: 1, category: "Music" },
  { question: "What is the fastest common tempo marking in music?", choices: ["Andante", "Allegro", "Presto", "Adagio"], correctIndex: 2, category: "Music" },
  { question: "Which instrument is Yo-Yo Ma famous for playing?", choices: ["Violin", "Piano", "Cello", "Flute"], correctIndex: 2, category: "Music" },
  { question: "What does 'DJ' stand for?", choices: ["Disc Jockey", "Dance Jockey", "Digital Jockey", "Disco Jockey"], correctIndex: 0, category: "Music" },
  { question: "Which country is credited as the birthplace of reggae music?", choices: ["Cuba", "Jamaica", "Brazil", "Trinidad and Tobago"], correctIndex: 1, category: "Music" },
  { question: "What is the highest common female singing voice type?", choices: ["Alto", "Mezzo-soprano", "Soprano", "Contralto"], correctIndex: 2, category: "Music" },

  // Animals
  { question: "What is the fastest land animal?", choices: ["Lion", "Cheetah", "Gazelle", "Horse"], correctIndex: 1, category: "Animals" },
  { question: "Which flightless bird is an excellent swimmer?", choices: ["Ostrich", "Penguin", "Emu", "Kiwi"], correctIndex: 1, category: "Animals" },
  { question: "How many legs does a spider have?", choices: ["6", "8", "10", "12"], correctIndex: 1, category: "Animals" },
  { question: "What is a group of wolves called?", choices: ["Pod", "Pack", "Herd", "Colony"], correctIndex: 1, category: "Animals" },
  { question: "Which mammal is famous for laying eggs?", choices: ["Kangaroo", "Platypus", "Koala", "Armadillo"], correctIndex: 1, category: "Animals" },
  { question: "What is the largest species of shark?", choices: ["Great White Shark", "Hammerhead Shark", "Whale Shark", "Tiger Shark"], correctIndex: 2, category: "Animals" },
  { question: "How many hearts does an octopus have?", choices: ["1", "2", "3", "4"], correctIndex: 2, category: "Animals" },
  { question: "Which animal is known as man's best friend?", choices: ["Cat", "Horse", "Dog", "Rabbit"], correctIndex: 2, category: "Animals" },
  { question: "What do you call a group of crows?", choices: ["Flock", "Murder", "Herd", "Swarm"], correctIndex: 1, category: "Animals" },
  { question: "Which big cat is unable to roar?", choices: ["Lion", "Tiger", "Cheetah", "Jaguar"], correctIndex: 2, category: "Animals" },
  { question: "What is the only mammal capable of true flight?", choices: ["Flying squirrel", "Bat", "Sugar glider", "Colugo"], correctIndex: 1, category: "Animals" },
  { question: "Which animal has one of the longest lifespans on average?", choices: ["Elephant", "Giant tortoise", "Blue whale", "Parrot"], correctIndex: 1, category: "Animals" },
  { question: "What is a baby cat called?", choices: ["Cub", "Pup", "Kitten", "Calf"], correctIndex: 2, category: "Animals" },
  { question: "What is considered the loudest animal on Earth?", choices: ["Blue whale", "African elephant", "Howler monkey", "Sperm whale"], correctIndex: 0, category: "Animals" },
  { question: "How many humps does a Bactrian camel have?", choices: ["One", "Two", "Three", "Four"], correctIndex: 1, category: "Animals" },
];

export function drawTriviaQuestions(count: number): TriviaQuestion[] {
  const pool = [...TRIVIA_BANK];
  const picked: TriviaQuestion[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}
