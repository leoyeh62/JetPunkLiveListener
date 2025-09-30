const { WebcastPushConnection } = require('tiktok-live-connector');
const fs = require('fs');
const puppeteer = require('puppeteer');

// Load the list of countries from the countries.json file
const countries = JSON.parse(fs.readFileSync('./countries.json', 'utf8'));

// Set to track guessed countries and user scores
const guessedCountries = new Set();
const usersScores = {};

// Function to check if the message is a valid country
const isValidCountry = (msg) => {
  return countries.some((country) => msg.toLowerCase() === country.toLowerCase());
};

// Function to enter the country into the quiz
const enterCountryIntoQuiz = async (page, country) => {
  try {
    // Wait for the input field to be available and type the country
    await page.waitForSelector('#txt-answer-box', { timeout: 10000 });
    await page.type('#txt-answer-box', country);
    await page.keyboard.press('Enter');
    console.log(`Entered country: ${country}`);
  } catch (error) {
    console.error('Error entering country:', error);
  }
};

// Function to open the JetPunk quiz once and return the page object
const openJetPunkQuizOnce = async () => {
  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = await browser.newPage();
  await page.goto('https://www.jetpunk.com/quizzes/how-many-countries-can-you-name');
  console.log('JetPunk quiz opened successfully!');

  // Return the browser and page objects to reuse them
  return { browser, page };
};

// Function to connect to the live chat and listen for messages
const connectToLiveChat = async (username, page) => {
  const connection = new WebcastPushConnection(username);

  try {
    await connection.connect();
    console.log(`Connected to livestream room of user: ${username}`);

    connection.on('chat', async (data) => {
      const msg = data.comment.trim();
      const user = data.uniqueId;

      // Check if the message is a valid country and hasn't been guessed before
      if (isValidCountry(msg) && !guessedCountries.has(msg)) {
        guessedCountries.add(msg);

        // Update user's score
        if (!usersScores[user]) {
          usersScores[user] = 0;
        }
        usersScores[user]++;
        console.log(`✅ ${user} guessed: ${msg}`);
        console.log(`${user}'s Score: ${usersScores[user]}`);

        // Enter the country into the JetPunk quiz
        await enterCountryIntoQuiz(page, msg);
      }
    });
  } catch (error) {
    console.error('Error connecting to live chat:', error);
  }
};

// Main function to start the entire process
const startLiveQuizInteraction = async () => {
  // Open the JetPunk quiz once
  const { browser, page } = await openJetPunkQuizOnce();

  // Replace 'your_tiktok_username' with your actual TikTok username
  const username = 'romain_gauvin'; // Make sure this username is correct and the user is live

  // Try connecting to live chat and listen for guesses
  await connectToLiveChat(username, page);

  // Force Node.js to stay active and wait indefinitely
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000)); // keeps running in an infinite loop
  }
};

// Start the process
startLiveQuizInteraction();
