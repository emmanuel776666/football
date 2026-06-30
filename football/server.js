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

const LEAGUES = "1-39";

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
// RANDOM HELPERS
// =======================

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function kickOffIntros(home, away) {
  return pick([
    `🔔 IT'S GAME TIME! The whistle has blown!\n\n${home} ⚔️ ${away} — We are LIVE! 🟢`,
    `🚀 AND WE ARE OFF! Brace yourselves folks!\n\n${home} vs ${away} — 0-0 | KICK OFF!`,
    `🏟️ The stadium is ELECTRIC! Both teams are ready!\n\n${home} 🆚 ${away} — Let the battle begin! ⚡`,
    `👟 The first whistle is blown! Football is HERE!\n\n${home} vs ${away} — 0-0 | LET'S GO! 🔥`,
    `🎯 KICK OFF ALERT! Don't miss a single moment!\n\n${home} ⚔️ ${away} — 0-0 | LIVE NOW! 📺`,
  ]);
}

function goalIntros(scorer, goalMinute, goalLabel) {
  return pick([
    `🚨 GOOOAL! What a moment! ${scorer} (${goalMinute})${goalLabel} 🔥`,
    `⚽ IT'S IN THE NET! ${scorer} makes it happen! (${goalMinute})${goalLabel} 😱`,
    `💥 SCREAMER! ${scorer} finds the back of the net! (${goalMinute})${goalLabel}`,
    `🎉 GET IN! ${scorer} with the GOAL! (${goalMinute})${goalLabel} 🙌`,
    `🔥 UNSTOPPABLE! ${scorer} scores! (${goalMinute})${goalLabel} 💪`,
  ]);
}

function htCaptions(home, homeGoals, away, awayGoals) {
  const diff = homeGoals - awayGoals;
  if (diff > 0) return `${home} heading into the break in control 💪 Can ${away} bounce back in the second half? 🤔`;
  if (diff < 0) return `${away} lead at the break! ${home} need to find a way back 😤 Second half drama incoming? 🔥`;
  return `All square at the break! ⚖️ Anyone's game in the second half — don't go anywhere! 👀`;
}

function ftCaptions(home, homeGoals, away, awayGoals) {
  const diff = homeGoals - awayGoals;
  if (diff > 0) return `${home} take all 3 points! 🏆 Another massive result! 🔥`;
  if (diff < 0) return `${away} win it! What a result away from home! 🎉`;
  return `They share the spoils! A point each — drama until the very end! ⚖️`;
}

const HASHTAGS = `#Football #LiveScores #GoalAlert #MatchLoop #LiveFootball #FBLive #Goals #FootballUpdates`;

// =======================
// POST PHOTO TO FACEBOOK
// =======================

async function postPhotoToFacebook(imageUrl, caption) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/${PAGE_ID}/photos`,
      null,
      {
        params: {
          url: imageUrl,
          caption,
          access_token: PAGE_ACCESS_TOKEN
        }
      }
    );
    console.log(`📸 Photo post sent: ${response.data.id}`);
    return response.data.id;
  } catch (error) {
    console.log("Photo post failed, falling back to text post:", error.message);
    return postToFacebook(caption);
  }
}

// =======================
// FACEBOOK TEXT POST
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
// MAIN FUNCTION
// =======================

async function getLiveMatches() {

  try {

    const response = await axios.get(
      `https://v3.football.api-sports.io/fixtures?live=${LEAGUES}`,
      {
        headers: {
          "x-apisports-key": API_KEY
        }
      }
    );

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
      const homeLogo = match.teams.home.logo;
      const awayLogo = match.teams.away.logo;
      const leagueLogo = match.league.logo;
      const leagueName = match.league.name;
      const leagueCountry = match.league.country;

      const homeGoals = match.goals.home ?? 0;
      const awayGoals = match.goals.away ?? 0;
      const currentScore = `${homeGoals}-${awayGoals}`;

      const elapsed = match.fixture.status.elapsed ?? "";
      const statusShort = match.fixture.status.short;

      if (!previousScores[fixtureId]) {
        previousScores[fixtureId] = currentScore;
      }

      // =======================
      // KICK OFF
      // =======================
      if (statusShort === "1H" && elapsed <= 1 && !postedKickOff[fixtureId]) {

        const caption =
`${kickOffIntros(home, away)}

🏆 ${leagueName} | ${leagueCountry}
⏱️ Minute: 0' | Score: 0 - 0

📢 Follow for live goals & updates!
${HASHTAGS}`;

        await postPhotoToFacebook(leagueLogo, caption);
        postedKickOff[fixtureId] = true;
        console.log(`🟢 Kick-off posted: ${home} vs ${away}`);
      }

      // =======================
      // HALF TIME
      // =======================
      if (statusShort === "HT" && !postedHalfTime[fixtureId]) {

        const caption =
`🔔 HALF TIME!

🏟️ ${home} ${homeGoals} - ${awayGoals} ${away}

${htCaptions(home, homeGoals, away, awayGoals)}

🏆 ${leagueName} | ${leagueCountry}
${HASHTAGS}`;

        await postPhotoToFacebook(leagueLogo, caption);
        postedHalfTime[fixtureId] = true;
        console.log(`🟡 Half-time posted: ${home} ${homeGoals}-${awayGoals} ${away}`);
      }

      // =======================
      // FULL TIME
      // =======================
      if ((statusShort === "FT" || statusShort === "AET") && !postedFullTime[fixtureId]) {

        const aet = statusShort === "AET" ? " (AET)" : "";

        const caption =
`🏁 FULL TIME${aet}!

🏟️ ${home} ${homeGoals} - ${awayGoals} ${away}

${ftCaptions(home, homeGoals, away, awayGoals)}

🏆 ${leagueName} | ${leagueCountry}
📢 Follow for more live updates!
${HASHTAGS}`;

        await postPhotoToFacebook(leagueLogo, caption);
        postedFullTime[fixtureId] = true;
        console.log(`🔴 Full-time posted: ${home} ${homeGoals}-${awayGoals} ${away}`);
      }

      // =======================
      // SCORE CHANGE
      // =======================
      if (previousScores[fixtureId] !== currentScore) {

        const oldScore = previousScores[fixtureId];
        const oldTotal = oldScore.split("-").reduce((a, b) => Number(a) + Number(b), 0);
        const newTotal = currentScore.split("-").reduce((a, b) => Number(a) + Number(b), 0);

        // GOAL CANCELLED (VAR)
        if (newTotal < oldTotal) {

          const postId = goalPosts[fixtureId];

          if (postId) {

            let cancelledScorer = "Unknown Player";
            let cancelledMinute = elapsed;
            const events = match.events || [];
            const cancelledGoal = [...events].reverse().find(e =>
              e.type === "Var" || e.detail === "Goal Disallowed"
            );

            if (cancelledGoal) {
              if (cancelledGoal.player?.name) cancelledScorer = cancelledGoal.player.name;
              if (cancelledGoal.time?.elapsed) cancelledMinute = cancelledGoal.time.elapsed;
            }

            const cancelMessage =
`❌ GOAL RULED OUT! VAR steps in! 📺

🧐 ${cancelledScorer}'s goal is DISALLOWED (${cancelledMinute}')

🔴 VAR Review Complete — No Goal!
🏟️ ${home} ${homeGoals} - ${awayGoals} ${away} | ⏱️ ${elapsed}'

🏆 ${leagueName}
${HASHTAGS}`;

            await editFacebookPost(postId, cancelMessage);
            console.log(`❌ VAR cancellation posted`);
          }

        }

        // NEW GOAL
        else if (currentScore !== "0-0") {

          let scorer = "Unknown Player";
          let assist = null;
          let goalLabel = "";
          let goalMinute = `${elapsed}'`;
          let scoringTeamLogo = leagueLogo;

          const events = match.events || [];
          const latestGoal = [...events].reverse().find(e => e.type === "Goal");

          if (latestGoal) {
            if (latestGoal.player?.name) scorer = latestGoal.player.name;
            if (latestGoal.assist?.name) assist = latestGoal.assist.name;
            if (latestGoal.time?.extra) {
              goalMinute = `${latestGoal.time.elapsed}+${latestGoal.time.extra}'`;
            }

            if (latestGoal.player?.name) {
              const playerName = latestGoal.player.name;
              if (!playerGoals[fixtureId]) playerGoals[fixtureId] = {};
              if (!playerGoals[fixtureId][playerName]) playerGoals[fixtureId][playerName] = 0;
              playerGoals[fixtureId][playerName]++;
              const totalGoals = playerGoals[fixtureId][playerName];
              if (totalGoals === 2) goalLabel = " 🎩 BRACE!";
              else if (totalGoals === 3) goalLabel = " 🎩🎩🎩 HAT TRICK!";
            }

            // Use scoring team's logo
            const newHome = currentScore.split("-")[0];
            const prevHome = oldScore.split("-")[0];
            if (Number(newHome) > Number(prevHome)) {
              scoringTeamLogo = homeLogo;
            } else {
              scoringTeamLogo = awayLogo;
            }
          }

          const assistLine = assist
            ? `🎯 Assist: ${assist}`
            : `🎯 Assist: None`;

          const caption =
`${goalIntros(scorer, goalMinute, goalLabel)}

🏟️ ${home} ${homeGoals} - ${awayGoals} ${away}
${assistLine}
⏱️ Minute: ${goalMinute}

🏆 ${leagueName} | ${leagueCountry}
📢 Follow for every goal & update!
${HASHTAGS}`;

          const postId = await postPhotoToFacebook(scoringTeamLogo, caption);
          goalPosts[fixtureId] = postId;
          console.log(`⚽ Goal posted: ${scorer} | ${home} ${homeGoals}-${awayGoals} ${away}`);
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
// CRON (EVERY 3 MINUTES)
// =======================

cron.schedule("*/3 * * * *", async () => {
  if (isCheckingLive) return;
  isCheckingLive = true;
  try {
    await getLiveMatches();
  } finally {
    isCheckingLive = false;
  }
});

// =======================
// RUN IMMEDIATELY ON START
// =======================

console.log("⚽ Football bot running 24/7...");
getLiveMatches();

// =======================
// SERVER
// =======================

const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("⚽ Football bot is live and running!");
});

app.get("/test", async (req, res) => {
  const testCaption =
`✅ BOT TEST POST!

⚽ Your football bot is LIVE and fully connected! 🎉
🚩 Ready to post kick-offs, goals, assists, half-time & full-time updates automatically to this page!

📢 Follow for live football updates!
#Football #LiveScores #GoalAlert #MatchLoop`;

  const testImage = "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Association_football_pitches_around_the_world.jpg/640px-Association_football_pitches_around_the_world.jpg";

  const postId = await postPhotoToFacebook(testImage, testCaption);
  if (postId) {
    res.send(`✅ Test post sent with image! Post ID: ${postId}`);
  } else {
    res.send("❌ Post failed — check PAGE_ID and PAGE_ACCESS_TOKEN.");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
