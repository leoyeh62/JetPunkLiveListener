const puppeteer = require('puppeteer');
const { WebcastPushConnection } = require('tiktok-live-connector');
const fs = require('fs');

const countries = JSON.parse(fs.readFileSync('./countries.json', 'utf8'));
const guessedCountries = new Set();

let browser, page;
let joueurs = [];

function playerExists(username) {
  for (let i = 0; i < joueurs.length; i++) {
    if (joueurs[i].pseudo == username) {
      return true;
    }
  }
  return false;
}
function getPlayerIndex(username) {
  for (let i = 0; i < joueurs.length; i++) {
    if (joueurs[i].pseudo == username) {
      return i;
    }
  }
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
  console.log('JetPunk quiz ouvert.');

  await page.waitForSelector('body', { timeout: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await handleConsent(page);
}

async function enterCountryIntoQuiz(country) {
  try {
    await page.waitForSelector('#txt-answer-box', { timeout: 10000 });
    await page.type('#txt-answer-box', country);
    await page.keyboard.press('Enter');
    console.log(`Pays trouvé : ${country}`);
  } catch (error) {
    console.log('Erreur pour mettre le pays trouvé:', error);
  }
}

async function handleConsent(page) {
  await new Promise((resolve) => setTimeout(resolve, 5000));

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
      console.log('Bouton "Tout accepter" cliqué via shadow DOM');
    } else {
      console.log('Bouton introuvable même via shadow DOM');
    }
  } catch (error) {
    console.log('Erreur lors de la recherche du bouton :', error.message);
  }
}

async function pressStartButton() {
  try {
    await page.waitForSelector('#start-button', { timeout: 5000 });
    await page.click('#start-button');
    console.log('Bouton start clické ');
  } catch (error) {
    console.log('Bouton start non-trouvé.');
  }
}

async function showGuessOnScreen(username, country) {
  if (!playerExists(username)) {
    joueurs.push({ pseudo: username, score: 0 });
  } else {
    let indice = getPlayerIndex(username);
    joueurs[indice].score += 1;
  }

  const player = joueurs.find((p) => p.pseudo === username);

  try {
    await page.evaluate(
      (username, country, score) => {
        const displayArea = document.createElement('div');
        displayArea.innerHTML = `<div style="font-size: 20px; color: white; background-color: rgba(0,0,0,0.5); padding: 10px; margin: 5px; border-radius: 5px; position: fixed; top: 10px; left: 10px; z-index: 9999;">
                                      <strong>@${username}</strong> found: <em>${country}</em> (Score: <strong>${score}</strong>)
                                  </div>`;

        document.body.appendChild(displayArea);

        setTimeout(() => displayArea.remove(), 10000);
      },
      username,
      country,
      player.score
    );

    console.log(`Affichage, @${username} a deviné ${country} score: ${player.score}`);
  } catch (error) {
    console.log('Erreur', error);
  }
}

function isValidCountry(msg) {
  return countries.some((country) => msg.toLowerCase() === country.toLowerCase());
}

async function leaderboardDisplay(players) {
  const topPlayers = players.sort((a, b) => b.score - a.score).slice(0, 10);

  try {
    await page.evaluate((topPlayers) => {
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.top = '10px';
      container.style.right = '10px';
      container.style.zIndex = '9999';
      container.style.backgroundColor = 'rgba(0,0,0,0.7)';
      container.style.padding = '10px';
      container.style.borderRadius = '8px';
      container.style.color = 'white';
      container.style.fontFamily = 'Arial, sans-serif';
      container.style.maxWidth = '250px';

      const title = document.createElement('div');
      title.innerHTML = '<strong>Leaderboard</strong>';
      title.style.marginBottom = '10px';
      title.style.textAlign = 'center';
      container.appendChild(title);

      topPlayers.forEach((player, index) => {
        const entry = document.createElement('div');

        let fontSize;
        if (index === 0) fontSize = '24px';
        else if (index === 1) fontSize = '20px';
        else if (index === 2) fontSize = '18px';
        else fontSize = '16px';

        entry.style.fontSize = fontSize;
        entry.style.marginBottom = '5px';

        entry.innerHTML = `<strong>#${index + 1} ${player.username}</strong>: ${player.score} pts`;
        container.appendChild(entry);
      });

      const old = document.getElementById('leaderboard');
      if (old) old.remove();

      container.id = 'leaderboard';
      document.body.appendChild(container);
    }, topPlayers);
  } catch (error) {
    console.log('Erreur leaderboard:', error);
  }
}

async function restart() {
  await page.waitForSelector('#retake-quiz', { timeout: 10000 });
  await leaderboardDisplay(players);
  await page.click('#start-button');
}

async function connectToLiveChatWithRetry(username, retries = 5, delay = 3000) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      const connection = new WebcastPushConnection(username);
      connection.on('chat', async (data) => {
        const msg = data.comment.trim();

        if (isValidCountry(msg) && !guessedCountries.has(msg)) {
          guessedCountries.add(msg);
          console.log(`@${data.uniqueId} guessed: ${msg}`);
          await enterCountryIntoQuiz(msg);

          const score = guessedCountries.size;
          await showGuessOnScreen(data.uniqueId, msg, score);
        }
      });

      await connection.connect();
      console.log(`Connecté sur le stream de : ${username}`);
      await pressStartButton();
      return;
    } catch (error) {
      console.log(`essai n'${attempt + 1} raté: ${error.message}`);
      attempt++;
      if (attempt < retries) {
        console.log(`Prochain essay dans ${delay / 1000} secondes...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.log('Connection échouée');
        throw error;
      }
    }
  }
}

(async () => {
  try {
    await openPage();
    const username = 'shadowkirutiktok';
    await connectToLiveChatWithRetry(username);
    await page.evaluate(() => {
      window.scrollBy(0, 500);
    });
  } catch (error) {
    console.error('Connection failed:', error);
    process.exit(1);
  }
})();
