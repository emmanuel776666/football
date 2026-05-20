require("dotenv").config();

const axios = require("axios");
const cron = require("node-cron");
const express = require("express");

const app = express();

const API_KEY = process.env.API_KEY;
const PAGE_ID = process.env.PAGE_ID;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// =======================
// MEMORY
// =======================

let previousScores = {};
let postedHalfTime = {};
let postedKickOff = {};
let postedFullTime = {};
let goalPosts = {};

// =======================
// MAIN FUNCTION
// =======================

async function getLiveMatches() {

  try {

    // =======================
    // FETCH LIVE MATCHES ONLY
    // =======================

    const response = await axios.get(
      "https://api.football-data.org/v4/matches?status=LIVE",
      {
        headers: {
          "X-Auth-Token": API_KEY
        }
      }
    );

    // =======================
    // RATE LIMIT HEADERS
    // =======================

    const requestsLeft =
      response.headers["x-requestsavailable"];

    const resetTime =
      response.headers["x-requestcounter-reset"];

    console.log(`Requests Left: ${requestsLeft}`);
    console.log(`Counter Reset In: ${resetTime} seconds`);

    // =======================
    // MATCHES
    // =======================

    const matches = response.data.matches;

    if (!matches.length) {
      console.log("No live matches");
      return;
    }

    // =======================
    // LOOP MATCHES
    // =======================

    for (const match of matches) {

      const fixtureId = match.id;

      const home = match.homeTeam.name;
      const away = match.awayTeam.name;

      // =======================
      // LIVE SCORE
      // =======================

      const homeGoals =
        match.score.fullTime.home ??
        match.score.halfTime.home ??
        0;

      const awayGoals =
        match.score.fullTime.away ??
        match.score.halfTime.away ??
        0;

      const currentScore =
        `${homeGoals}-${awayGoals}`;

      const status = match.status;

      // =======================
      // MATCH MINUTE
      // =======================

      const minute =
        match.minute
          ? `${match.minute}'`
          : "";

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
        status === "LIVE" &&
        !postedKickOff[fixtureId]
      ) {

        const kickOffMessage =
`🏳️ Kick Off: ${home} 0-0 ${away}`;

        await postToFacebook(kickOffMessage);

        postedKickOff[fixtureId] = true;

        console.log(
          `Kick Off Posted: ${home} vs ${away}`
        );
      }

      // =======================
      // HALF TIME
      // =======================

      if (
        status === "PAUSED" &&
        !postedHalfTime[fixtureId]
      ) {

        const halfTimeMessage =
`${home} ${homeGoals}-${awayGoals} ${away} [HT]`;

        await postToFacebook(halfTimeMessage);

        postedHalfTime[fixtureId] = true;

        console.log(
          `Half Time Posted: ${home} vs ${away}`
        );
      }

      // =======================
      // FULL TIME
      // =======================

      if (
        status === "FINISHED" &&
        !postedFullTime[fixtureId]
      ) {

        const fullTimeMessage =
`${home} ${homeGoals}-${awayGoals} ${away} [FT]`;

        await postToFacebook(fullTimeMessage);

        postedFullTime[fixtureId] = true;

        console.log(
          `Full Time Posted: ${home} vs ${away}`
        );
      }

      // =======================
      // SCORE CHANGE
      // =======================

      if (
        previousScores[fixtureId] !== currentScore
      ) {

        const oldScore =
          previousScores[fixtureId];

        const oldTotal =
          oldScore
            .split("-")
            .reduce(
              (a, b) => Number(a) + Number(b),
              0
            );

        const newTotal =
          currentScore
            .split("-")
            .reduce(
              (a, b) => Number(a) + Number(b),
              0
            );

        // =======================
        // GOAL CANCELLED (VAR)
        // =======================

        if (newTotal < oldTotal) {

          const postId =
            goalPosts[fixtureId];

          if (postId) {

            const cancelMessage =
`❌ GOAL CANCELLED (VAR) ${minute}

🏳️ Live: ${home} ${homeGoals}-${awayGoals} ${away}`;

            await editFacebookPost(
              postId,
              cancelMessage
            );

            console.log(
              `Goal Cancelled: ${home} vs ${away}`
            );
          }

        }

        // =======================
        // NEW GOAL
        // =======================

        else {

          const message =
`🏳️ Live: ${home} ${homeGoals}-${awayGoals} ${away}

⚽ GOAL! ${minute}`;

          const postId =
            await postToFacebook(message);

          goalPosts[fixtureId] = postId;

          console.log(
            `Goal Posted: ${home} ${currentScore} ${away}`
          );
        }

        // =======================
        // SAVE SCORE
        // =======================

        previousScores[fixtureId] =
          currentScore;
      }

    }

  } catch (error) {

    if (error.response) {

      console.log(error.response.data);

      console.log(error.response.headers);

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

async function editFacebookPost(
  postId,
  message
) {

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

    if (!matches.length) {
      console.log("No fixtures today");
      return;
    }

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
      "ELC": "🏴",
      "PPL": "🇵🇹",
      "EC": "🇪🇺",
      "SA": "🇮🇹",
      "PL": "🏴"
    };

    let message =
`🏳️ Today’s games:

`;

    // =======================
    // LOOP FIXTURES
    // =======================

    for (const match of matches) {

      const home =
        match.homeTeam.name;

      const away =
        match.awayTeam.name;

      const competitionCode =
        match.competition.code;

      const flag =
        countryFlags[competitionCode] || "⚽";

      const matchTime =
        new Date(match.utcDate)
          .toLocaleTimeString(
            "en-GB",
            {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Africa/Lagos"
            }
          );

      message +=
`${flag} ${home} - ${away} (${matchTime})
`;

    }

    await postToFacebook(message);

    console.log("Today's fixtures posted");

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

cron.schedule("*/1 * * * *", () => {

  console.log("Checking live matches...");

  getLiveMatches();

});

// =======================
// POST FIXTURES EVERY DAY
// 8AM
// =======================

cron.schedule("0 8 * * *", () => {

  console.log(
    "Posting today's fixtures..."
  );

  postTodayFixtures();

});

// =======================
// START BOT
// =======================

setTimeout(() => {

  getLiveMatches();

  console.log(
    "Football bot running..."
  );

}, 60000);

// =======================
// EXPRESS SERVER
// =======================

const PORT =
  process.env.PORT || 3000;

app.get("/", (req, res) => {

  res.send(
    "Football bot is running..."
  );

});

app.listen(PORT, () => {

  console.log(
    "Server running on port " + PORT
  );

});
