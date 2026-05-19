require("dotenv").config();

const axios = require("axios");
const cron = require("node-cron");

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
const LEAGUES = "2-39-140-135-307-179-94-78-45-924";

// =======================
// ACTIVE HOURS
// =======================

// 4PM to 11PM
// Change anytime

const START_HOUR = 13;
const END_HOUR = 23;

// =======================
// MEMORY
// =======================

let previousScores = {};
let postedHalfTime = {};
let goalPosts = {};

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

          }

          const message =
`🏳️Live: ${home} ${homeGoals}-${awayGoals} ${away}

⚽ GOAL! ${scorer} ${elapsed}'

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
// RUN EVERY 1 MINUTE
// =======================

cron.schedule("*/5 * * * *", () => {

  console.log("Checking live matches...");

  getLiveMatches();

});

// Start immediately
getLiveMatches();

console.log("Football bot running...");