require("dotenv").config();

const axios = require("axios");
const cron = require("node-cron");
const express = require("express");

const app = express();

const API_KEY = process.env.API_KEY;
const PAGE_ID = process.env.PAGE_ID;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

const LEAGUES = "1-39";

// track what we've already posted
let isCheckingLive = false;
let previousScores = {};
let postedKickOff = {};
let postedHalfTime = {};
let postedFullTime = {};
let goalPosts = {};
let playerGoals = {};
let requestsRemaining = 100;

// ─── HUMAN-SOUNDING MESSAGES ────────────────────────────────────────────────

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function kickoffMsg(home, away, league) {
  const intros = [
    `We're underway! ${home} vs ${away} has just kicked off 🔔`,
    `It's started! ${home} take on ${away} — let's see what happens 👀`,
    `The ref blows the whistle and we are OFF! ${home} vs ${away} is live 🟢`,
    `Game on! ${home} vs ${away} is underway right now 🏃`,
    `Here we go! ${home} face ${away} — should be a good one tonight ⚽`,
  ];
  return `${rand(intros)}\n\n📍 ${league}\n⏱ 0-0 | KO\n\n🔔 Follow for live updates`;
}

function goalMsg(home, hg, away, ag, scorer, minute, assist, label, league) {
  const shouts = [
    `GOAL! ${scorer} puts it in the back of the net`,
    `That's a goal! ${scorer} finds the target`,
    `GET IN! ${scorer} scores for ${hg > ag ? home : away}`,
    `${scorer} with the finish — it's a goal!`,
    `And it's in! ${scorer} breaks the deadlock`,
  ];

  const labelLine = label ? `\n🎩 ${label}` : "";
  const assistLine = assist ? `\nAssist: ${assist} 👟` : "";

  return (
    `⚽ ${rand(shouts)} (${minute}')${labelLine}\n\n` +
    `${home} ${hg} - ${ag} ${away}${assistLine}\n\n` +
    `📍 ${league}\n🔔 Follow for more updates`
  );
}

function htMsg(home, hg, away, ag, league) {
  const diff = hg - ag;
  let comment;
  if (diff > 1)
    comment = rand([
      `${home} well in control here. Second half to come.`,
      `Dominant first half from ${home}. Can ${away} respond?`,
    ]);
  else if (diff === 1)
    comment = rand([
      `${home} edging it but nothing is settled yet.`,
      `Tight game. ${home} shade it so far but ${away} still in this.`,
    ]);
  else if (diff === 0)
    comment = rand([
      `Level at the break. Both teams will fancy their chances.`,
      `Goalless at half time. Second half could be interesting.`,
      `Honours even so far. Plenty still to play for.`,
    ]);
  else if (diff === -1)
    comment = rand([
      `${away} in front at the break. ${home} need a reaction.`,
      `${home} behind going into the second half. Comeback on?`,
    ]);
  else
    comment = rand([
      `${away} comfortable here. Tough evening for ${home}.`,
      `${home} well off the pace in the first half.`,
    ]);

  return (
    `🟡 HALF TIME\n\n${home} ${hg} - ${ag} ${away}\n\n` +
    `${comment}\n\n📍 ${league}\n🔔 Follow for second half updates`
  );
}

function ftMsg(home, hg, away, ag, league, isAet) {
  const suffix = isAet ? " (AET)" : "";
  const diff = hg - ag;
  let comment;
  if (diff > 1)
    comment = rand([
      `Comfortable win for ${home} in the end.`,
      `${home} deserved that. Solid performance.`,
    ]);
  else if (diff === 1)
    comment = rand([
      `${home} just about edge it. Three points in the bag.`,
      `Narrow win for ${home} but they'll take it.`,
    ]);
  else if (diff === 0)
    comment = rand([
      `A point each. Probably fair on the night.`,
      `They couldn't be separated. One point apiece.`,
    ]);
  else if (diff === -1)
    comment = rand([
      `${away} nick it. Well done to them tonight.`,
      `${home} fall short. ${away} take the three points.`,
    ]);
  else
    comment = rand([
      `${away} run out comfortable winners tonight.`,
      `Heavy defeat for ${home}. Tough night.`,
    ]);

  return (
    `🏁 FULL TIME${suffix}\n\n${home} ${hg} - ${ag} ${away}\n\n` +
    `${comment}\n\n📍 ${league}`
  );
}

function varMsg(home, hg, away, ag, scorer, minute, league) {
  return (
    `VAR — Goal ruled out!\n\n` +
    `${scorer}'s goal has been disallowed after a VAR check (${minute}')\n\n` +
    `${home} ${hg} - ${ag} ${away}\n\n📍 ${league}`
  );
}

// ─── FACEBOOK HELPERS ────────────────────────────────────────────────────────

async function postPhoto(imageUrl, caption) {
  try {
    const res = await axios.post(
      `https://graph.facebook.com/${PAGE_ID}/photos`,
      null,
      { params: { url: imageUrl, caption, access_token: PAGE_ACCESS_TOKEN } }
    );
    console.log(`📸 Posted with photo | ID: ${res.data.id}`);
    return res.data.id;
  } catch (err) {
    console.log("Photo post failed, trying text post:", err.message);
    return postText(caption);
  }
}

async function postText(message) {
  try {
    const res = await axios.post(
      `https://graph.facebook.com/${PAGE_ID}/feed`,
      null,
      { params: { message, access_token: PAGE_ACCESS_TOKEN } }
    );
    console.log(`📝 Text post sent | ID: ${res.data.id}`);
    return res.data.id;
  } catch (err) {
    console.log("Text post failed:", err.message);
  }
}

async function editPost(postId, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/${postId}`,
      null,
      { params: { message, access_token: PAGE_ACCESS_TOKEN } }
    );
    console.log(`✏️ Post edited | ID: ${postId}`);
  } catch (err) {
    console.log("Edit post failed:", err.message);
  }
}

// ─── DAILY FIXTURES ──────────────────────────────────────────────────────────

async function postDailyFixtures() {
  try {
    const res = await axios.get(
      `https://v3.football.api-sports.io/fixtures?live=${LEAGUES}&next=20`,
      { headers: { "x-apisports-key": API_KEY } }
    );

    const fixtures = res.data.response;
    if (!fixtures || !fixtures.length) {
      console.log("No upcoming fixtures to post");
      return;
    }

    const now = new Date();
    const upcoming = fixtures.filter(f => {
      const ko = new Date(f.fixture.date);
      return ko > now;
    });

    if (!upcoming.length) return;

    let lines = `Here are today's fixtures coming up 📋\n\n`;
    for (const f of upcoming) {
      const ko = new Date(f.fixture.date);
      const time = ko.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Africa/Lagos"
      });
      lines += `${f.teams.home.name} vs ${f.teams.away.name} — ${time}\n`;
    }
    lines += `\nAll times WAT 🕐\n🔔 Follow for live scores and goal alerts`;

    await postText(lines);
    console.log("📅 Daily fixtures posted");
  } catch (err) {
    console.log("Fixtures post failed:", err.message);
  }
}

// ─── MAIN LIVE MATCH LOOP ────────────────────────────────────────────────────

async function checkMatches() {
  try {
    // back off if rate limit is dangerously low
    if (requestsRemaining !== null && requestsRemaining < 5) {
      console.log(`⚠️ Rate limit low (${requestsRemaining} left) — skipping this cycle`);
      return;
    }

    const res = await axios.get(
      `https://v3.football.api-sports.io/fixtures?live=${LEAGUES}`,
      { headers: { "x-apisports-key": API_KEY } }
    );

    // track remaining requests
    const remaining =
      res.headers["x-ratelimit-requests-remaining"] ||
      res.headers["x-requests-available"];
    if (remaining !== undefined) requestsRemaining = Number(remaining);

    console.log(`📊 Requests left: ${requestsRemaining}`);

    const matches = res.data.response;
    if (!matches.length) {
      console.log("No live matches right now");
      return;
    }

    for (const match of matches) {
      const id = match.fixture.id;
      const home = match.teams.home.name;
      const away = match.teams.away.name;
      const homeLogo = match.teams.home.logo;
      const awayLogo = match.teams.away.logo;
      const leagueLogo = match.league.logo;
      const league = `${match.league.name} — ${match.league.country}`;
      const hg = match.goals.home ?? 0;
      const ag = match.goals.away ?? 0;
      const score = `${hg}-${ag}`;
      const elapsed = match.fixture.status.elapsed ?? "";
      const status = match.fixture.status.short;

      if (!previousScores[id]) previousScores[id] = score;

      // KICK OFF
      if (status === "1H" && elapsed <= 1 && !postedKickOff[id]) {
        const caption = kickoffMsg(home, away, league);
        await postPhoto(leagueLogo, caption);
        postedKickOff[id] = true;
      }

      // HALF TIME
      if (status === "HT" && !postedHalfTime[id]) {
        const caption = htMsg(home, hg, away, ag, league);
        await postPhoto(leagueLogo, caption);
        postedHalfTime[id] = true;
      }

      // FULL TIME
      if ((status === "FT" || status === "AET") && !postedFullTime[id]) {
        const caption = ftMsg(home, hg, away, ag, league, status === "AET");
        await postPhoto(leagueLogo, caption);
        postedFullTime[id] = true;
      }

      // SCORE CHANGE
      if (previousScores[id] !== score) {
        const oldTotal = previousScores[id].split("-").reduce((a, b) => Number(a) + Number(b), 0);
        const newTotal = score.split("-").reduce((a, b) => Number(a) + Number(b), 0);

        // VAR — goal cancelled
        if (newTotal < oldTotal) {
          const postId = goalPosts[id];
          if (postId) {
            let scorer = "Unknown";
            let minute = elapsed;
            const events = match.events || [];
            const varEvent = [...events].reverse().find(e =>
              e.type === "Var" || e.detail === "Goal Disallowed"
            );
            if (varEvent) {
              if (varEvent.player?.name) scorer = varEvent.player.name;
              if (varEvent.time?.elapsed) minute = varEvent.time.elapsed;
            }
            await editPost(postId, varMsg(home, hg, away, ag, scorer, minute, league));
          }
        }

        // NEW GOAL
        else if (newTotal > oldTotal) {
          let scorer = "Unknown";
          let assist = null;
          let minute = `${elapsed}`;
          let label = "";
          let scoringLogo = leagueLogo;

          const events = match.events || [];
          const goal = [...events].reverse().find(e => e.type === "Goal");

          if (goal) {
            if (goal.player?.name) scorer = goal.player.name;
            if (goal.assist?.name) assist = goal.assist.name;
            if (goal.time?.extra) minute = `${goal.time.elapsed}+${goal.time.extra}`;
            else if (goal.time?.elapsed) minute = `${goal.time.elapsed}`;

            // figure out which team scored for logo
            const prevHome = Number(previousScores[id].split("-")[0]);
            if (hg > prevHome) scoringLogo = homeLogo;
            else scoringLogo = awayLogo;

            // brace / hat trick tracking
            if (goal.player?.name) {
              if (!playerGoals[id]) playerGoals[id] = {};
              playerGoals[id][scorer] = (playerGoals[id][scorer] || 0) + 1;
              const tally = playerGoals[id][scorer];
              if (tally === 2) label = "Brace";
              else if (tally === 3) label = "Hat-trick";
            }
          }

          const caption = goalMsg(home, hg, away, ag, scorer, minute, assist, label, league);
          const postId = await postPhoto(scoringLogo, caption);
          goalPosts[id] = postId;
          console.log(`⚽ Goal: ${scorer} | ${home} ${hg}-${ag} ${away}`);
        }

        previousScores[id] = score;
      }
    }
  } catch (err) {
    if (err.response) {
      console.log("API error:", err.response.data);
    } else {
      console.log("Error:", err.message);
    }
  }
}

// ─── SCHEDULES ────────────────────────────────────────────────────────────────

// check live matches every 3 minutes
cron.schedule("*/3 * * * *", async () => {
  if (isCheckingLive) return;
  isCheckingLive = true;
  try {
    await checkMatches();
  } finally {
    isCheckingLive = false;
  }
});

// post today's fixtures every day at 8 AM (WAT)
cron.schedule("0 7 * * *", () => {
  postDailyFixtures();
});

// run immediately on startup
console.log("⚽ Bot started");
checkMatches();

// ─── SERVER ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("Bot is running");
});

app.get("/test", async (req, res) => {
  const msg =
    `Test post from the page 👋\n\n` +
    `The bot is live and connected. Goal alerts, kick-off and full-time updates are all running automatically.\n\n` +
    `🔔 Follow the page so you don't miss a thing`;

  const img = "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Association_football_pitches_around_the_world.jpg/640px-Association_football_pitches_around_the_world.jpg";
  const postId = await postPhoto(img, msg);
  res.send(postId ? `Done — post ID: ${postId}` : "Failed — check your token and page ID");
});

app.get("/fixtures", async (req, res) => {
  await postDailyFixtures();
  res.send("Fixtures posted");
});

app.get("/status", (req, res) => {
  res.json({
    status: "running",
    requestsRemaining,
    matchesTracked: Object.keys(previousScores).length,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Running on port ${PORT}`);
});
