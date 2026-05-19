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

// Premier League = 39
// La Liga = 140
// Serie A = 135
// Saudi Pro League = 307

// Change anytime
const LEAGUES = "2-39";

// =======================
// ACTIVE HOURS
// =======================

// remember 15 is 4pm and 19 is 8pm
const START_HOUR = 18;
const END_HOUR = 22;

// =======================
// MEMORY
// =======================

let previousScores = {};
let postedHalfTime = {};
let goalPosts = {};

let postedKickOff = {};
let postedFullTime = {};
let playerGoals = {};

// =======================
// MAIN FUNCTION
// =======================

async function getLiveMatches() {

  try {

    const currentHour = new Date().getHours();

    // Run only during selected hours
    if (currentHour < START_HOUR || currentHour > END_HOUR) {
      console.log("Outside active hours");
      return;
    }

    // Fetch live matches
    const response = await axios.get(
      `https://v3.football.api-sports.io/fixtures?live=${LEAGUES}`,
      {
        headers: {
          "x-apisports-key": API_KEY
        }
      }
    );

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

      // =======================
      // FIRST TIME
      // =======================

      if (!previousScores[fixtureId]) {
        previousScores[fixtureId] = currentScore;
      }

      // =======================
      // KICK OFF
      // =======================

      if (
        statusShort === "1H" &&
        elapsed <= 1 &&
        !postedKickOff[fixtureId]
      ) {

        const kickOffMessage =
`🏳️Kick Off: ${home} 0-0 ${away}`;

        await postToFacebook(kickOffMessage);

        postedKickOff[fixtureId] = true;

        console.log(`Kick Off Posted: ${home} vs ${away}`);
      }

      // =======================
      // HALF TIME
      // =======================

      if (
        statusShort === "HT" &&
        !postedHalfTime[fixtureId]
      ) {

        const halfTimeMessage =
`${home} ${homeGoals}-${awayGoals} ${away} [HT]`;

        await postToFacebook(halfTimeMessage);

        postedHalfTime[fixtureId] = true;

        console.log(`Half Time Posted: ${home} vs ${away}`);
      }

      // =======================
      // FULL TIME
      // =======================

      if (
        (statusShort === "FT" || statusShort === "AET") &&
        !postedFullTime[fixtureId]
      ) {

        const fullTimeMessage =
`${home} ${homeGoals}-${awayGoals} ${away} [FT]`;

        await postToFacebook(fullTimeMessage);

        postedFullTime[fixtureId] = true;

        console.log(`Full Time Posted: ${home} vs ${away}`);
      }

      // =======================
      // SCORE CHANGE
      // =======================

      if (previousScores[fixtureId] !== currentScore) {

        const oldScore = previousScores[fixtureId];

        const oldTotal =
          oldScore.split("-")
            .reduce((a, b) => Number(a) + Number(b), 0);

        const newTotal =
          currentScore.split("-")
            .reduce((a, b) => Number(a) + Number(b), 0);

        // =======================
        // GOAL CANCELLED
        // =======================

        if (newTotal < oldTotal) {

          const postId = goalPosts[fixtureId];

          if (postId) {

            let cancelledScorer = "Unknown Player";
            let cancelledMinute = elapsed;

            const events = match.events || [];

            // Find VAR/disallowed event
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

🏳️Live: ${home} ${homeGoals}-${awayGoals} ${away}`;

            await editFacebookPost(postId, cancelMessage);

            console.log(`Goal Cancelled: ${home} vs ${away}`);
          }

        }

        // =======================
        // NEW GOAL
        // =======================

        else if (currentScore !== "0-0") {

          let scorer = "Unknown Player";
          let assist = "No Assist";
          let goalLabel = "";
          let goalMinute = `${elapsed}'`;

          const events = match.events || [];

          // Latest goal event
          const latestGoal = [...events]
            .reverse()
            .find(event => event.type === "Goal");

          if (latestGoal) {

            // Goal scorer
            if (latestGoal.player?.name) {
              scorer = latestGoal.player.name;
            }

            // Assist
            if (latestGoal.assist?.name) {
              assist = latestGoal.assist.name;
            }

            // Extra time minute
            if (latestGoal.time?.extra) {

              goalMinute =
`${latestGoal.time.elapsed}+${latestGoal.time.extra}'`;

            }

            // Track player goals
            if (latestGoal.player?.name) {

              const playerName =
                latestGoal.player.name;

              if (!playerGoals[fixtureId]) {
                playerGoals[fixtureId] = {};
              }

              if (!playerGoals[fixtureId][playerName]) {
                playerGoals[fixtureId][playerName] = 0;
              }

              playerGoals[fixtureId][playerName]++;

              const totalGoals =
                playerGoals[fixtureId][playerName];

              if (totalGoals === 2) {
                goalLabel = " (brace)";
              }

              else if (totalGoals === 3) {
                goalLabel = " (hat trick)";
              }

            }

          }

          const message =
`🏳️Live: ${home} ${homeGoals}-${awayGoals} ${away}

⚽ GOAL! ${scorer} (${goalMinute})${goalLabel}

🎯 Assist: ${assist}`;

          // Post to Facebook
          const postId = await postToFacebook(message);

          // Save post ID
          goalPosts[fixtureId] = postId;

          console.log(`Goal Posted: ${home} ${currentScore} ${away}`);
        }

        // Save latest score
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
// CREATE FACEBOOK POST
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

    console.log("Posted to Facebook");

    return response.data.id;

  } catch (error) {

    if (error.response) {
      console.log(error.response.data);
    } else {
      console.log(error.message);
    }

  }

}

// =======================
// EDIT FACEBOOK POST
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

    console.log("Facebook Post Edited");

  } catch (error) {

    if (error.response) {
      console.log(error.response.data);
    } else {
      console.log(error.message);
    }

  }

}

// =======================
// RUN EVERY 5 MINUTES
// =======================

cron.schedule("*/5 * * * *", () => {

  console.log("Checking live matches...");

  getLiveMatches();

});

// Start after 2 minutes
setTimeout(() => {

  getLiveMatches();

  console.log("Football bot running...");

}, 120000);

// =======================
// EXPRESS SERVER
// =======================

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Football bot is running...");
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
