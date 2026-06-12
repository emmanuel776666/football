require("dotenv").config();

const axios = require("axios");
const cron = require("node-cron");
const express = require("express");

const app = express();

const API_KEY = process.env.API_KEY;
const PAGE_ID = process.env.PAGE_ID;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// =======================
// LEAGUES
// =======================

const LEAGUES = "1";

// =======================
// ACTIVE HOURS (5PM - 11PM)
// =======================

const START_HOUR = 17;
const END_HOUR = 23;

// =======================
// MEMORY
// =======================
let isCheckingLive = false;
let previousScores = {};
let postedHalfTime = {};
let goalPosts = {};

let postedKickOff = {};
let postedFullTime = {};
let playerGoals = {};

// =======================
// RATE LIMIT INFO
// =======================

let lastRequestInfo = {
  remaining: null,
  reset: null
};

// =======================
// MAIN FUNCTION
// =======================

async function getLiveMatches() {

  try {

    const currentHour = new Date().getHours();

    // ONLY RUN BETWEEN 5PM - 11PM
    if (currentHour < START_HOUR || currentHour > END_HOUR) {
      console.log("⛔ Outside active hours (5PM–11PM)");
      return;
    }

    // FETCH MATCHES
    const response = await axios.get(
      `https://v3.football.api-sports.io/fixtures?live=${LEAGUES}`,
      {
        headers: {
          "x-apisports-key": API_KEY
        }
      }
    );

    // =======================
    // RATE LIMIT LOG (ONLY ADDITION)
    // =======================

    const requestsLeft =
      response.headers["x-ratelimit-requests-remaining"] ||
      response.headers["x-requests-available"] ||
      "N/A";

    const resetTime =
      response.headers["x-ratelimit-requests-reset"] ||
      response.headers["x-requestcounter-reset"] ||
      "N/A";

    lastRequestInfo.remaining = requestsLeft;
    lastRequestInfo.reset = resetTime;

    console.log(`📊 Requests Left: ${requestsLeft}`);
    console.log(`⏳ Reset Time: ${resetTime}`);

    const matches = response.data.response;

    if (!matches.length) {
      console.log("No live matches");
      return;
    }

    for (const match of matches) {

      const fixtureId = match.fixture.id;

      const home = match.teams.home.name;
      const away = match.teams.away.name;

      const homeGoals = match.goals.home ?? 0;
      const awayGoals = match.goals.away ?? 0;

      const currentScore = `${homeGoals}-${awayGoals}`;

      const elapsed = match.fixture.status.elapsed ?? "";
      const statusShort = match.fixture.status.short;

      // FIRST TIME
      if (!previousScores[fixtureId]) {
        previousScores[fixtureId] = currentScore;
      }

      // KICK OFF
      if (
        statusShort === "1H" &&
        elapsed <= 1 &&
        !postedKickOff[fixtureId]
      ) {

        const kickOffMessage =
`🚩Kick Off: ${home} 0-0 ${away}`;

        await postToFacebook(kickOffMessage);

        postedKickOff[fixtureId] = true;
      }

      // HALF TIME
      if (
        statusShort === "HT" &&
        !postedHalfTime[fixtureId]
      ) {

        const halfTimeMessage =
`🚩:${home} ${homeGoals}-${awayGoals} ${away} [HT]`;

        await postToFacebook(halfTimeMessage);

        postedHalfTime[fixtureId] = true;
      }

      // FULL TIME
      if (
        (statusShort === "FT" || statusShort === "AET") &&
        !postedFullTime[fixtureId]
      ) {

        const fullTimeMessage =
`🚩:${home} ${homeGoals}-${awayGoals} ${away} [FT]`;

        await postToFacebook(fullTimeMessage);

        postedFullTime[fixtureId] = true;
      }

      // SCORE CHANGE (UNCHANGED LOGIC)
      if (previousScores[fixtureId] !== currentScore) {

        const oldScore = previousScores[fixtureId];

        const oldTotal =
          oldScore.split("-")
            .reduce((a, b) => Number(a) + Number(b), 0);

        const newTotal =
          currentScore.split("-")
            .reduce((a, b) => Number(a) + Number(b), 0);

        // GOAL CANCELLED
        if (newTotal < oldTotal) {

          const postId = goalPosts[fixtureId];

          if (postId) {

            let cancelledScorer = "Unknown Player";
            let cancelledMinute = elapsed;

            const events = match.events || [];

            const cancelledGoal = [...events]
              .reverse()
              .find(event =>
                event.type === "Var" ||
                event.detail === "Goal Disallowed"
              );

            if (cancelledGoal) {

              if (cancelledGoal.player?.name) {
                cancelledScorer = cancelledGoal.player.name;
              }

              if (cancelledGoal.time?.elapsed) {
                cancelledMinute = cancelledGoal.time.elapsed;
              }

            }

            const cancelMessage =
`❌ GOAL CANCELLED (VAR) ${cancelledScorer} ${cancelledMinute}'

🎌Live: ${home} ${homeGoals}-${awayGoals} ${away}`;

            await editFacebookPost(postId, cancelMessage);
          }

        }

        // NEW GOAL
        else if (currentScore !== "0-0") {

          let scorer = "Unknown Player";
          let assist = "No Assist";
          let goalLabel = "";
          let goalMinute = `${elapsed}'`;

          const events = match.events || [];

          const latestGoal = [...events]
            .reverse()
            .find(event => event.type === "Goal");

          if (latestGoal) {

            if (latestGoal.player?.name) {
              scorer = latestGoal.player.name;
            }

            if (latestGoal.assist?.name) {
              assist = latestGoal.assist.name;
            }

            if (latestGoal.time?.extra) {
              goalMinute =
`${latestGoal.time.elapsed}+${latestGoal.time.extra}'`;
            }

            if (latestGoal.player?.name) {

              const playerName = latestGoal.player.name;

              if (!playerGoals[fixtureId]) {
                playerGoals[fixtureId] = {};
              }

              if (!playerGoals[fixtureId][playerName]) {
                playerGoals[fixtureId][playerName] = 0;
              }

              playerGoals[fixtureId][playerName]++;

              const totalGoals =
                playerGoals[fixtureId][playerName];

              if (totalGoals === 2) goalLabel = " (brace)";
              else if (totalGoals === 3) goalLabel = " (hat trick)";
            }
          }

          const message =
`🚩Live: ${home} ${homeGoals}-${awayGoals} ${away}

⚽ GOAL! ${scorer} (${goalMinute})${goalLabel}

🎯 Assist: ${assist}`;

          const postId = await postToFacebook(message);

          goalPosts[fixtureId] = postId;
        }

        previousScores[fixtureId] = currentScore;
      }
    }

  } catch (error) {
    if (error.response) {
      console.log(error.response.data);
    } else {
      console.log(error.message);
    }
  }
}

// =======================
// FACEBOOK POST
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
// EDIT POST
// =======================

async function editFacebookPost(postId, message) {

  try {

    await axios.post(
      `https://graph.facebook.com/${postId}`,
      null,
      {
        params: {
          message,
          access_token: PAGE_ACCESS_TOKEN
        }
      }
    );

  } catch (error) {
    console.log(error.message);
  }
}

// =======================
// CRON (3 MINUTES ONLY)
// =======================

cron.schedule("*/3 * * * *", async () => {

  const currentHour = new Date().getHours();

  // ACTIVE HOURS (5PM - 11PM)
  if (currentHour < 17 || currentHour > 23) {
    console.log("⛔ Outside active hours (5PM–11PM)");
    return;
  }

  if (isCheckingLive) return;

  isCheckingLive = true;

  try {
    await getLiveMatches();
  } finally {
    isCheckingLive = false;
  }

});
// =======================
// START DELAY
// =======================

setTimeout(() => {
  const hour = new Date().getHours();

  if (hour >= 17 && hour <= 23) {
    getLiveMatches();
    console.log("Football bot running...");
  }
}, 120000);

// =======================
// SERVER
// =======================

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Football bot is running...");
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
