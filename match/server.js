require("dotenv").config();

const axios = require("axios");
const cron = require("node-cron");
const express = require("express");
const path = require("path");

const app = express();

const API_KEY = process.env.API_KEY;
const PAGE_ID = process.env.PAGE_ID;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID_2 = process.env.PAGE_ID_2;
const PAGE_ACCESS_TOKEN_2 = process.env.PAGE_ACCESS_TOKEN_2;

let previousScores = {};
let postedHalfTime = {};
let postedKickOff = {};
let postedFullTime = {};
let isCheckingLive = false;

async function getLiveMatches() {
  try {
    const response = await axios.get("https://api.football-data.org/v4/matches", {
      headers: { "X-Auth-Token": API_KEY },
    });

    const requestsLeft = response.headers["x-requests-available"] || "N/A";
    const resetTime = response.headers["x-requestcounter-reset"] || "N/A";
    console.log(`requests left: ${requestsLeft} | resets in: ${resetTime}s`);

    const matches = response.data.matches;
    if (!matches.length) return;

    for (const match of matches) {
      const fixtureId = match.id;
      const status = match.status;

      if (!["LIVE", "IN_PLAY", "PAUSED", "FINISHED"].includes(status)) continue;

      const home = match.homeTeam.name;
      const away = match.awayTeam.name;
      const homeGoals = match.score.fullTime.home ?? match.score.halfTime.home ?? 0;
      const awayGoals = match.score.fullTime.away ?? match.score.halfTime.away ?? 0;
      const currentScore = `${homeGoals}-${awayGoals}`;

      let minute = "";
      if (match.goals && match.goals.length > 0) {
        const latest = match.goals[match.goals.length - 1];
        if (latest.minute) {
          minute = latest.injuryTime
            ? `${latest.minute}+${latest.injuryTime}'`
            : `${latest.minute}'`;
        }
      }

      if (previousScores[fixtureId] === undefined) previousScores[fixtureId] = currentScore;

      if (["LIVE", "IN_PLAY"].includes(status) && !postedKickOff[fixtureId]) {
        const msg =
          `🚩Kick Off! ${home} 0-0 ${away}\n\n` +
          `📢 Follow for live goals and match updates. ⚽🔥`;
        await postToFacebook(msg);
        postedKickOff[fixtureId] = true;
      }

      if (status === "PAUSED" && !postedHalfTime[fixtureId]) {
        await postToFacebook(`🚩HT: ${home} ${homeGoals}-${awayGoals} ${away}`);
        postedHalfTime[fixtureId] = true;
      }

      if (status === "FINISHED" && !postedFullTime[fixtureId]) {
        await postToFacebook(`🏁FT: ${home} ${homeGoals}-${awayGoals} ${away}`);
        postedFullTime[fixtureId] = true;
      }

      if (previousScores[fixtureId] !== currentScore) {
        const oldTotal = previousScores[fixtureId].split("-").reduce((a, b) => Number(a) + Number(b), 0);
        const newTotal = currentScore.split("-").reduce((a, b) => Number(a) + Number(b), 0);

        if (newTotal < oldTotal) {
          previousScores[fixtureId] = currentScore;
          continue;
        }

        if (newTotal > oldTotal) {
          await postToFacebook(`🚩Live: ${home} ${homeGoals}-${awayGoals} ${away}\n\n⚽ GOAL! ${minute}`);
        }

        previousScores[fixtureId] = currentScore;
      }
    }
  } catch (error) {
    console.log(error.message);
  }
}

async function postToFacebook(message) {
  try {
    const res = await axios.post(
      `https://graph.facebook.com/${PAGE_ID}/feed`,
      null,
      { params: { message, access_token: PAGE_ACCESS_TOKEN } }
    );
    return res.data.id;
  } catch (err) {
    console.log(err.message);
  }
}

async function postToBothPages(message) {
  try {
    await axios.post(`https://graph.facebook.com/${PAGE_ID}/feed`, null, {
      params: { message, access_token: PAGE_ACCESS_TOKEN },
    });
    await axios.post(`https://graph.facebook.com/${PAGE_ID_2}/feed`, null, {
      params: { message, access_token: PAGE_ACCESS_TOKEN_2 },
    });
    console.log("posted to both pages");
  } catch (err) {
    console.log(err.message);
  }
}

async function postTodayFixtures() {
  try {
    const response = await axios.get("https://api.football-data.org/v4/matches", {
      headers: { "X-Auth-Token": API_KEY },
    });

    const matches = response.data.matches;
    const now = new Date();

    const upcoming = matches.filter(m => {
      const ko = new Date(m.utcDate);
      return ko > now && ["SCHEDULED", "TIMED"].includes(m.status);
    });

    if (!upcoming.length) return;

    const flags = {
      WC: "🌍", CL: "🇪🇺", BL1: "🇩🇪", DED: "🇳🇱", BSA: "🇧🇷",
      PD: "🇪🇸", FL1: "🇫🇷", PPL: "🇵🇹", EC: "🇪🇺", SA: "🇮🇹",
    };

    let msg = `Today's fixtures 📋\n\n`;
    for (const m of upcoming) {
      const flag = flags[m.competition.code] || "⚽";
      const time = new Date(m.utcDate).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Africa/Lagos",
      });
      msg += `${flag} ${m.homeTeam.name} vs ${m.awayTeam.name} (${time})\n`;
    }
    msg += `\n🔔 Follow for live goals and updates`;

    await postToBothPages(msg);
  } catch (err) {
    console.log(err.message);
  }
}

cron.schedule("*/6 * * * * *", async () => {
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

const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("running");
});

app.get("/privacy-policy", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "privacy-policy-url.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`port ${PORT}`);
});
