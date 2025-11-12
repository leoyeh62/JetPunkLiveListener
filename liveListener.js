const puppeteer = require('puppeteer');
const { WebcastPushConnection } = require('tiktok-live-connector');
const fs = require('fs');

const countries = JSON.parse(fs.readFileSync('./countries.json', 'utf8'));
const guessedCountries = new Set();
let joueurs = [];

let browser, page;

function playerExists(username) {
  for (let i = 0; i < joueurs.length; i++) {
    if (joueurs[i].pseudo == username) {
      return true;
    }
  }
  return false;
}

function getPlayerScore(username) {
  for (let i = 0; i < joueurs.length; i++) {
    if (joueurs[i].pseudo == username) {
      return joueurs[i].score;
    }
  }
  return 0;
}

async function openPage() {
  browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,
    defaultViewport: null,
    args: ['--start-maximized'],
  });
  page = await browser.newPage();
  await page.goto('https://www.jetpunk.com/quizzes/how-many-countries-can-you-name');
  
  // attendre un peu que la page charge
  await page.waitForSelector('body');
  await new Promise(resolve => setTimeout(resolve, 5000));
  handleConsent();
}

async function enterCountryIntoQuiz(country) {
  try {
    await page.waitForSelector('#txt-answer-box');
    await page.type('#txt-answer-box', country);
    await page.keyboard.press('Enter');
    console.log('Pays entré:', country);
  } catch (error) {
    console.log('Erreur:', error);
  }
}

async function handleConsent() {
  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    const found = await page.evaluate(() => {
      function deepQuerySelector(root, selector) {
        const el = root.querySelector(selector);
        if (el) return el;

        const shadowHosts = root.querySelectorAll('*');
        for (const host of shadowHosts) {
          if (host.shadowRoot) {
            const elInShadow = deepQuerySelector(host.shadowRoot, selector);
            if (elInShadow) return elInShadow;
          }
        }
        return null;
      }

      const btn = deepQuerySelector(document, 'a.cmpboxbtn.cmpboxbtnyes');
      if (btn) {
        btn.scrollIntoView();
        btn.click();
        return true;
      }
      return false;
    });
    
    if (found) {
      console.log('Cookies acceptés');
    }
  } catch (err) {
  }
}

async function pressStartButton() {
  try {
    await page.waitForSelector('#start-button');
    await page.click('#start-button');
    console.log('Quiz démarré');
  } catch (e) {
    console.log('Bouton start pas trouvé');
  }
}

async function isFinished() {
  while (true) {
    try {
      const retake = await page.waitForSelector('#retake-quiz', { visible: true, timeout: 5000 });
      if (retake) {
        console.log('Quiz terminé !');
        await leaderboardDisplay();
        await new Promise(resolve => setTimeout(resolve, 10000));
        leaderboardHide();
        
        // reset tout
        await page.evaluate(() => {
          const btn = document.querySelector('#blue close auto-focus');
          const btn1 = document.querySelector('#retake-quiz');
          if (btn) btn.click();
          if (btn1) btn1.click();
        });
        
        joueurs = [];
        guessedCountries.clear();
        pressStartButton();
      }
    } catch (e) {
    }
  }
}

async function showGuessOnScreen(username, country) {
  // ajouter ou update le score
  let found = false;
  for (let i = 0; i < joueurs.length; i++) {
    if (joueurs[i].pseudo == username) {
      joueurs[i].score++;
      found = true;
      break;
    }
  }
  if (!found) {
    joueurs.push({ pseudo: username, score: 1 });
  }
  
  const score = getPlayerScore(username);

  await page.evaluate(
    (user, ctry, scr) => {
      const div = document.createElement('div');
      div.innerHTML = `<div style="font-size: 20px; color: white; background-color: rgba(0,0,0,0.5); padding: 10px; margin: 5px; border-radius: 5px; position: fixed; top: 10px; left: 10px; z-index: 9999;">
                        <strong>@${user}</strong> found: <em>${ctry}</em> (Score: <strong>${scr}</strong>)
                      </div>`;
      document.body.appendChild(div);
      setTimeout(() => div.remove(), 10000);
    },
    username,
    country,
    score
  );
  
  console.log(`@${username} a trouvé ${country}`);
}

function isValidCountry(msg) {
  for (let i = 0; i < countries.length; i++) {
    if (msg.toLowerCase() === countries[i].toLowerCase()) {
      return true;
    }
  }
  return false;
}

async function leaderboardDisplay() {
  // trier les joueurs par score
  let topPlayers = [];
  for (let i = 0; i < joueurs.length; i++) {
    topPlayers.push(joueurs[i]);
  }
  topPlayers.sort((a, b) => b.score - a.score);
  topPlayers = topPlayers.slice(0, 10);

  await page.evaluate((players) => {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '10px';
    container.style.right = '10px';
    container.style.zIndex = '9999';
    container.style.background = 'rgba(0,0,0,0.7)';
    container.style.padding = '10px';
    container.style.borderRadius = '8px';
    container.style.color = 'white';
    container.style.fontFamily = 'Arial';
    container.style.maxWidth = '400px';

    const title = document.createElement('div');
    title.innerHTML = '<strong>Leaderboard</strong>';
    title.style.marginBottom = '10px';
    title.style.textAlign = 'center';
    container.appendChild(title);

    for (let i = 0; i < players.length; i++) {
      const entry = document.createElement('div');
      let fontSize = '16px';
      if (i === 0) fontSize = '24px';
      else if (i === 1) fontSize = '20px';
      else if (i === 2) fontSize = '18px';
      
      entry.style.fontSize = fontSize;
      entry.style.marginBottom = '5px';
      entry.innerHTML = `<strong>#${i + 1} ${players[i].pseudo}</strong>: ${players[i].score} pts`;
      container.appendChild(entry);
    }

    const old = document.getElementById('leaderboard');
    if (old) old.remove();

    container.id = 'leaderboard';
    document.body.appendChild(container);
  }, topPlayers);
}

async function leaderboardHide() {
  await page.evaluate(() => {
    const el = document.getElementById('leaderboard');
    if (el) el.remove();
  });
}

async function connectToLiveChatWithRetry(username, retries = 5, delay = 3000) {
  let attempt = 0;
  
  while (attempt < retries) {
    try {
      const connection = new WebcastPushConnection(username, { processInitialData: false });
      
      connection.on('chat', async (data) => {
        const msg = data.comment.trim();

        if (isValidCountry(msg) && !guessedCountries.has(msg)) {
          guessedCountries.add(msg);
          console.log(`${data.uniqueId}: ${msg}`);
          await enterCountryIntoQuiz(msg);
          await showGuessOnScreen(data.uniqueId, msg);
        }
      });

      await connection.connect();
      console.log(`Connecté au live de ${username}`);
      await pressStartButton();
      return;
    } catch (err) {
      attempt++;
      console.log(`Tentative ${attempt} échouée`);
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
}

(async () => {
  try {
    await openPage();
    const username = 'shadowkirutiktok';
    await connectToLiveChatWithRetry(username);
    await page.evaluate(() => window.scrollBy(0, 500));
    isFinished();
  } catch (error) {
    console.error('Erreur:', error);
    process.exit(1);
  }
})();
