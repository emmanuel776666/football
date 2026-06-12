require("dotenv").config();

const axios = require("axios");
const cron = require("node-cron");
const express = require("express");

const app = express();

const API_KEY = process.env.API_KEY;
const PAGE_ID = process.env.PAGE_ID;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// =======================
// NEW SECOND PAGE
// =======================

const PAGE_ID_2 = process.env.PAGE_ID_2;
const PAGE_ACCESS_TOKEN_2 = process.env.PAGE_ACCESS_TOKEN_2;

// =======================
// MEMORY
// =======================

let previousScores = {};
let postedHalfTime = {};
let postedKickOff = {};
let postedFullTime = {};


let isCheckingLive = false;

// =======================
// MAIN FUNCTION
// =======================

async function getLiveMatches() {

  try {

    const response = await axios.get(
      "https://api.football-data.org/v4/matches",
      {
        headers: {
          "X-Auth-Token": API_KEY
        }
      }
    );

    const requestsLeft =
      response.headers["x-requests-available"] || "Not provided";

    const resetTime =
      response.headers["x-requestcounter-reset"] || "Unknown";

    console.log(`Requests Left: ${requestsLeft}`);
    console.log(`Counter Reset In: ${resetTime} seconds`);

    const matches = response.data.matches;

    if (!matches.length) return;

    for (const match of matches) {

      const fixtureId = match.id;
      const status = match.status;

      if (!["LIVE", "IN_PLAY", "PAUSED", "FINISHED"].includes(status)) {
        continue;
      }

      const home = match.homeTeam.name;
      const away = match.awayTeam.name;

      const homeGoals =
        match.score.fullTime.home ??
        match.score.halfTime.home ??
        0;

      const awayGoals =
        match.score.fullTime.away ??
        match.score.halfTime.away ??
        0;

      const currentScore = `${homeGoals}-${awayGoals}`;

      let minute = "";

      if (match.goals && match.goals.length > 0) {

        const latestGoal = match.goals[match.goals.length - 1];

        if (latestGoal.minute) {

          minute = `${latestGoal.minute}'`;

          if (latestGoal.injuryTime) {
            minute = `${latestGoal.minute}+${latestGoal.injuryTime}'`;
          }

        }

      }

      if (previousScores[fixtureId] === undefined) {
        previousScores[fixtureId] = currentScore;
      }

      if (
        ["LIVE", "IN_PLAY"].includes(status) &&
        !postedKickOff[fixtureId]
      ) {

        const kickOffMessage =
`🏳️ Kick Off!
${home} 0-0 ${away}`;

        await postToFacebook(kickOffMessage);

        postedKickOff[fixtureId] = true;
      }

      if (status === "PAUSED" && !postedHalfTime[fixtureId]) {

        const halfTimeMessage =
`${home} ${homeGoals}-${awayGoals} ${away} 'HT'`;

        await postToFacebook(halfTimeMessage);

        postedHalfTime[fixtureId] = true;
      }

      if (status === "FINISHED" && !postedFullTime[fixtureId]) {

        const fullTimeMessage =
`🏁:${home} ${homeGoals}-${awayGoals} ${away} 'FT'`;

        await postToFacebook(fullTimeMessage);

        postedFullTime[fixtureId] = true;
      } 
      
if (previousScores[fixtureId] !== currentScore) {

  const message =
`🚩 Live: ${home} ${homeGoals}-${awayGoals} ${away}

⚽ GOAL! ⏱ ${minute}`;

  await postToFacebook(message);

  previousScores[fixtureId] = currentScore;
}
      

// =======================
// POST TO ONE PAGE
// =======================

async function postToFacebook(message) {

  try {

    const response = await axios.post(
      `https://graph.facebook.com/${PAGE_ID}/feed`,
      null,
      {
        params: {
          message,
          access_token: PAGE_ACCESS_TOKEN
        }
      }
    );

    return response.data.id;

  } catch (error) {
    console.log(error.message);
  }

}

// =======================
// POST TO BOTH PAGES (NEW)
// =======================

async function postToFacebookBothPages(message) {

  try {

    await axios.post(
      `https://graph.facebook.com/${PAGE_ID}/feed`,
      null,
      {
        params: {
          message,
          access_token: PAGE_ACCESS_TOKEN
        }
      }
    );

    await axios.post(
      `https://graph.facebook.com/${PAGE_ID_2}/feed`,
      null,
      {
        params: {
          message,
          access_token: PAGE_ACCESS_TOKEN_2
        }
      }
    );

    console.log("Posted to BOTH pages (feature)");

  } catch (error) {
    console.log(error.message);
  }

}


// =======================
// TODAY FIXTURES
// =======================

async function postTodayFixtures() {

  try {

    const response = await axios.get(
      "https://api.football-data.org/v4/matches",
      {
        headers: {
          "X-Auth-Token": API_KEY
        }
      }
    );

    const matches = response.data.matches;

    const now = new Date();

    const validMatches = matches.filter(match => {
      const kickoff = new Date(match.utcDate);
      return kickoff > now && ["SCHEDULED", "TIMED"].includes(match.status);
    });

    if (!validMatches.length) return;

    // =======================
    // FLAGS
    // =======================

    const countryFlags = {
  "WC": "🌍",
  "CL": "🇪🇺",
  "BL1": "🇩🇪",
  "DED": "🇳🇱",
  "BSA": "🇧🇷",
  "PD": "🇪🇸",
  "FL1": "🇫🇷",
  "ELC": "\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F",
  "PPL": "🇵🇹",
  "EC": "🇪🇺",
  "SA": "🇮🇹",
  "PL": "\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F"
};


    let message = `🏳️ Today’s games:\n\n`;

    for (const match of validMatches) {

      const home = match.homeTeam.name;
      const away = match.awayTeam.name;

      const flag = countryFlags[match.competition.code] || "⚽";

      const matchTime = new Date(match.utcDate).toLocaleTimeString(
        "en-GB",
        {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Africa/Lagos"
        }
      );

      message += `${flag} ${home} vs ${away} (${matchTime})\n`;
    }

    // ✅ ONLY CHANGE HERE
    await postToFacebookBothPages(message);

  } catch (error) {
    console.log(error.message);
  }

}

// =======================
// CRON JOBS (UNCHANGED)
// =======================

cron.schedule("*/7 * * * * *", async () => {
  if (isCheckingLive) return;

  isCheckingLive = true;

  try {
    await getLiveMatches();
  } finally {
    isCheckingLive = false;
  }
});

cron.schedule("0 6 * * *", () => {
  postTodayFixtures();
});

setTimeout(() => {
  getLiveMatches();
}, 60000);

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Football bot is running...");
});

app.listen(PORT);
