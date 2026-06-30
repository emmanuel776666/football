require("dotenv").config();

const axios = require("axios");
const cron = require("node-cron");
const express = require("express");

const app = express();

const API_KEY = process.env.API_KEY;
const PAGE_ID = process.env.PAGE_ID;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

const LEAGUES = "1-39";

let isCheckingLive = false;
let previousScores = {};
let postedKickOff = {};
let postedHalfTime = {};
let postedFullTime = {};
let goalPosts = {};
let playerGoals = {};

let requestsRemaining = 100;
let hasLiveMatches = false;
let pausedUntilMidnight = false;
let pausedUntil = null; // Date object — bot sleeps until this time

function getInterval() {
  if (pausedUntilMidnight) return null;
  if (requestsRemaining < 5)  return null;
  if (requestsRemaining < 10) return 45 * 60000;
  if (requestsRemaining < 20) return 30 * 60000;
  if (requestsRemaining < 40) return hasLiveMatches ? 8 * 60000 : 25 * 60000;
  return hasLiveMatches ? 3 * 60000 : 20 * 60000;
}

function scheduleNext() {
  // sleeping until a specific time
  if (pausedUntil && new Date() < pausedUntil) {
    const ms = pausedUntil - new Date();
    const mins = Math.round(ms / 60000);
    console.log(`sleeping for ${mins} min — resumes at ${pausedUntil.toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos" })} WAT`);
    setTimeout(() => {
      pausedUntil = null;
      run();
    }, ms);
    return;
  }

  const ms = getInterval();
  if (ms === null) {
    console.log(`quota too low (${requestsRemaining} left) — paused until midnight`);
    pausedUntilMidnight = true;
    return;
  }
  const mins = Math.round(ms / 60000);
  console.log(`next check in ${mins} min (${requestsRemaining} requests left, live: ${hasLiveMatches})`);
  setTimeout(run, ms);
}

async function run() {
  if (isCheckingLive) {
    scheduleNext();
    return;
  }
  isCheckingLive = true;
  try {
    await checkMatches();
  } finally {
    isCheckingLive = false;
    scheduleNext();
  }
}

// reset at midnight so the bot resumes at full quota each day
cron.schedule("0 0 * * *", () => {
  console.log("midnight reset — resuming normal operation");
  pausedUntilMidnight = false;
  requestsRemaining = 100;
  previousScores = {};
  postedKickOff = {};
  postedHalfTime = {};
  postedFullTime = {};
  goalPosts = {};
  playerGoals = {};
  run();
});

// post today's fixtures every morning at 8 AM WAT (7 UTC)
cron.schedule("0 7 * * *", () => {
  postDailyFixtures();
});

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function kickoffMsg(home, away, league) {
  const opener = rand([
    `We are UNDERWAY! ${home} vs ${away} is live! 🟢`,
    `And we are OFF! ${home} take on ${away} — let's gooo ⚽`,
    `The referee blows the whistle and it's GAME ON! ${home} vs ${away} 🔔`,
    `Here we go! ${home} vs ${away} has just kicked off 👀`,
    `Football is BACK! ${home} and ${away} are underway right now 🏟️`,
    `It's started! ${home} vs ${away} — who's backing who? Drop it below 👇`,
    `Kick off! ${home} host ${away} and we are live ⚽🔥`,
    `The wait is over — ${home} vs ${away} is LIVE! 🚀`,
  ]);
  return `${opener}\n\n📍 ${league}\n⏱️ 0 - 0 | Kick Off\n\n🔔 Follow us for live goal alerts & updates!`;
}

function goalMsg(home, hg, away, ag, scorer, minute, assist, label, league) {
  const scoringTeam = hg > ag ? home : away;
  const opener = rand([
    `GOAAAAL! ${scorer} scores for ${scoringTeam}! 🚨🚨🚨`,
    `⚽ IT'S IN THE NET! ${scorer} with the finish! What a moment!`,
    `GOAL! ${scorer} makes it count for ${scoringTeam}! GET IN! 🔥`,
    `${scorer} SCORES! ${scoringTeam} are in front! 😤⚽`,
    `And it's a GOAL! ${scorer} finds the back of the net! 🎯`,
    `GET IN THERE! ${scorer} puts ${scoringTeam} ahead! Pure class 👏`,
    `YESSS! ${scorer} with the goal! ${scoringTeam} will take that! ⚽💥`,
    `What a finish from ${scorer}! ${scoringTeam} score! The crowd goes wild 🏟️🔥`,
  ]);
  const labelLine = label === "Hat-trick"
    ? `\n🎩🎩🎩 HAT-TRICK for ${scorer}!! Absolutely unbelievable!!`
    : label === "Brace"
    ? `\n🔁 Brace for ${scorer}! Two goals and counting!`
    : "";
  const assistLine = assist ? `\n👟 Assist: ${assist}` : "";
  return (
    `${opener} (${minute}')\n\n` +
    `${home} ${hg} – ${ag} ${away}${assistLine}${labelLine}\n\n` +
    `📍 ${league}\n🔔 Follow for more live updates!`
  );
}

function htMsg(home, hg, away, ag, league) {
  const diff = hg - ag;
  let comment;
  if (diff > 1)
    comment = rand([
      `${home} have been brilliant in that first half. ${away} will need something special after the break.`,
      `Dominant from ${home}. ${away} have a mountain to climb in the second half.`,
      `That was all ${home} in the first 45. ${away} have serious work to do.`,
    ]);
  else if (diff === 1)
    comment = rand([
      `${home} just about shade the first half but this is far from over. Expect a reaction from ${away}.`,
      `Tight game. ${home} lead but ${away} are still very much in this.`,
      `One goal in it at the break. ${away} will be looking to level things up quickly.`,
    ]);
  else if (diff === 0)
    comment = rand([
      `Level pegging at the break! Both teams still have everything to play for.`,
      `Nothing to separate them yet. The second half could be very interesting 👀`,
      `Goalless at half time — but this game has plenty more to give. Stay with us!`,
      `Both sides cancel each other out in a tight first half. Second 45 incoming! 🍊`,
    ]);
  else if (diff === -1)
    comment = rand([
      `${away} lead at the break. ${home} need to come out fighting after the restart.`,
      `${home} trail at half time. Can they turn this around? It's happened before... 🔄`,
      `${away} in front going into the second half. ${home} fans will be hoping for a response.`,
    ]);
  else
    comment = rand([
      `${away} have been the better team by far. ${home} really need to wake up in the second half.`,
      `Heavy first half for ${home}. ${away} are in total control right now.`,
    ]);
  return `🟡 HALF TIME\n\n${home} ${hg} – ${ag} ${away}\n\n${comment}\n\n📍 ${league}\n🔔 Back shortly for second half updates!`;
}

function ftMsg(home, hg, away, ag, league, isAet) {
  const suffix = isAet ? " (AET)" : "";
  const diff = hg - ag;
  let comment;
  if (diff > 1)
    comment = rand([
      `Comfortable win for ${home} in the end. Absolutely no complaints there.`,
      `${home} were excellent tonight. ${away} couldn't live with them.`,
      `Dominant display from ${home}. Three points and a clean sheet? Job done! 💪`,
    ]);
  else if (diff === 1)
    comment = rand([
      `${home} hold on for three points! They'll be delighted with that result.`,
      `Narrow win but ${home} will take it. Every goal counts in this game!`,
      `${home} grind out a vital win. Not pretty but the points are what matter 🏆`,
      `One goal was enough! ${home} pick up a crucial three points tonight.`,
    ]);
  else if (diff === 0)
    comment = rand([
      `A point each and probably fair on the night. Honours even! 🤝`,
      `They couldn't be separated. Both sets of fans will have mixed feelings about this one.`,
      `It ends all square. One point apiece — was a draw the right result? 🤔`,
    ]);
  else if (diff === -1)
    comment = rand([
      `${away} take all three points. Well deserved on the night.`,
      `${home} fall short in the end. ${away} will be celebrating tonight! 🎉`,
      `${away} nick it. Tough result for ${home} to take but that's football.`,
    ]);
  else
    comment = rand([
      `${away} run out comfortable winners. ${home} will want to forget this one quickly.`,
      `Heavy defeat for ${home}. ${away} were simply too good tonight.`,
    ]);
  return `🏁 FULL TIME${suffix}\n\n${home} ${hg} – ${ag} ${away}\n\n${comment}\n\n📍 ${league}\n\nWhat did you think of that one? Drop your thoughts below 👇`;
}

function varMsg(home, hg, away, ag, scorer, minute, league) {
  const opener = rand([
    `VAR CHECK — and the goal is DISALLOWED! 😤`,
    `VAR steps in! ${scorer}'s goal has been ruled out! 🖥️`,
    `No goal! VAR overturns it! ${scorer} will NOT be pleased 😩`,
    `VAR ruins the party! Goal ruled out after a check 📺`,
  ]);
  return (
    `${opener}\n\n` +
    `${scorer}'s effort at ${minute}' has been disallowed after a VAR review.\n\n` +
    `${home} ${hg} – ${ag} ${away}\n\n📍 ${league}`
  );
}

async function postPhoto(imageUrl, caption) {
  try {
    const res = await axios.post(
      `https://graph.facebook.com/${PAGE_ID}/photos`,
      null,
      { params: { url: imageUrl, caption, access_token: PAGE_ACCESS_TOKEN } }
    );
    console.log(`posted with photo | ${res.data.id}`);
    return res.data.id;
  } catch (err) {
    console.log("photo failed, trying text:", err.message);
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
    console.log(`text post sent | ${res.data.id}`);
    return res.data.id;
  } catch (err) {
    console.log("text post failed:", err.message);
  }
}

async function editPost(postId, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/${postId}`,
      null,
      { params: { message, access_token: PAGE_ACCESS_TOKEN } }
    );
    console.log(`post edited | ${postId}`);
  } catch (err) {
    console.log("edit failed:", err.message);
  }
}

async function postDailyFixtures() {
  try {
    const res = await axios.get(
      `https://v3.football.api-sports.io/fixtures?live=${LEAGUES}&next=20`,
      { headers: { "x-apisports-key": API_KEY } }
    );

    const remaining = res.headers["x-ratelimit-requests-remaining"] || res.headers["x-requests-available"];
    if (remaining !== undefined) requestsRemaining = Number(remaining);

    const fixtures = res.data.response;
    if (!fixtures || !fixtures.length) return;

    const now = new Date();
    const upcoming = fixtures.filter(f => new Date(f.fixture.date) > now);
    if (!upcoming.length) return;

    let msg = `Here are today's fixtures 📋\n\n`;
    for (const f of upcoming) {
      const time = new Date(f.fixture.date).toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos",
      });
      msg += `${f.teams.home.name} vs ${f.teams.away.name} — ${time}\n`;
    }
    msg += `\nAll times WAT 🕐\n🔔 Follow for live scores and goal alerts`;

    await postText(msg);
    console.log("daily fixtures posted");
  } catch (err) {
    console.log("fixtures failed:", err.message);
  }
}

async function checkMatches() {
  try {
    const res = await axios.get(
      `https://v3.football.api-sports.io/fixtures?live=${LEAGUES}`,
      { headers: { "x-apisports-key": API_KEY } }
    );

    const remaining = res.headers["x-ratelimit-requests-remaining"] || res.headers["x-requests-available"];
    if (remaining !== undefined) requestsRemaining = Number(remaining);

    console.log(`requests left: ${requestsRemaining}`);

    const matches = res.data.response;
    hasLiveMatches = matches.length > 0;

    if (!matches.length) {
      console.log("no live matches");
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

      if (status === "1H" && elapsed <= 1 && !postedKickOff[id]) {
        await postPhoto(leagueLogo, kickoffMsg(home, away, league));
        postedKickOff[id] = true;
      }

      if (status === "HT" && !postedHalfTime[id]) {
        await postPhoto(leagueLogo, htMsg(home, hg, away, ag, league));
        postedHalfTime[id] = true;
      }

      if ((status === "FT" || status === "AET") && !postedFullTime[id]) {
        await postPhoto(leagueLogo, ftMsg(home, hg, away, ag, league, status === "AET"));
        postedFullTime[id] = true;
      }

      if (previousScores[id] !== score) {
        const oldTotal = previousScores[id].split("-").reduce((a, b) => Number(a) + Number(b), 0);
        const newTotal = score.split("-").reduce((a, b) => Number(a) + Number(b), 0);

        if (newTotal < oldTotal) {
          const postId = goalPosts[id];
          if (postId) {
            let scorer = "Unknown";
            let minute = elapsed;
            const varEvent = [...(match.events || [])].reverse().find(
              e => e.type === "Var" || e.detail === "Goal Disallowed"
            );
            if (varEvent) {
              if (varEvent.player?.name) scorer = varEvent.player.name;
              if (varEvent.time?.elapsed) minute = varEvent.time.elapsed;
            }
            await editPost(postId, varMsg(home, hg, away, ag, scorer, minute, league));
          }
        } else if (newTotal > oldTotal) {
          let scorer = "Unknown";
          let assist = null;
          let minute = `${elapsed}`;
          let label = "";
          let scoringLogo = leagueLogo;

          const goal = [...(match.events || [])].reverse().find(e => e.type === "Goal");
          if (goal) {
            if (goal.player?.name) scorer = goal.player.name;
            if (goal.assist?.name) assist = goal.assist.name;
            if (goal.time?.extra) minute = `${goal.time.elapsed}+${goal.time.extra}`;
            else if (goal.time?.elapsed) minute = `${goal.time.elapsed}`;

            const prevHome = Number(previousScores[id].split("-")[0]);
            scoringLogo = hg > prevHome ? homeLogo : awayLogo;

            if (goal.player?.name) {
              if (!playerGoals[id]) playerGoals[id] = {};
              playerGoals[id][scorer] = (playerGoals[id][scorer] || 0) + 1;
              const tally = playerGoals[id][scorer];
              if (tally === 2) label = "Brace";
              else if (tally === 3) label = "Hat-trick";
            }
          }

          const postId = await postPhoto(
            scoringLogo,
            goalMsg(home, hg, away, ag, scorer, minute, assist, label, league)
          );
          goalPosts[id] = postId;
          console.log(`goal: ${scorer} | ${home} ${hg}-${ag} ${away}`);
        }

        previousScores[id] = score;
      }
    }
  } catch (err) {
    console.log(err.response ? err.response.data : err.message);
  }
}

// set sleep until 6 PM WAT (17:00 UTC) today on startup
function sleepUntil5pmWAT() {
  const now = new Date();
  const target = new Date();
  target.setUTCHours(17, 0, 0, 0); // 17:00 UTC = 18:00 WAT
  if (target <= now) return null;   // already past 5 PM — run normally
  return target;
}

// keep Render awake — ping self every 10 minutes
const SELF_URL = process.env.RENDER_URL || "https://football-iq5r.onrender.com";
setInterval(() => {
  axios.get(SELF_URL).catch(() => {});
}, 10 * 60 * 1000);

console.log("bot started");
pausedUntil = sleepUntil5pmWAT();
if (pausedUntil) {
  console.log(`bot sleeping until 5 PM WAT — ${pausedUntil.toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos" })}`);
}
run();

const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("running");
});

app.get("/test", async (req, res) => {
  const msg =
    `Test post 👋\n\nThe bot is live. Goal alerts, kick-off and full-time updates are running.\n\n🔔 Follow the page so you don't miss a thing`;
  const img = "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Association_football_pitches_around_the_world.jpg/640px-Association_football_pitches_around_the_world.jpg";
  const postId = await postPhoto(img, msg);
  res.send(postId ? `done — ${postId}` : "failed — check token and page id");
});

app.get("/fixtures", async (req, res) => {
  await postDailyFixtures();
  res.send("fixtures posted");
});

app.get("/manu", async (req, res) => {
  const caption =
    `🔴 MANCHESTER UNITED 🔴\n\n` +
    `There's only ONE club that gives you this feeling. Win, lose or draw — the Red Devils never leave your heart ❤️\n\n` +
    `Old Trafford roars. The badge means everything. This shirt carries history that no other club can touch 🏆\n\n` +
    `20 league titles. 3 European Cups. Sir Alex. Cantona. Ronaldo. Rooney. Legends don't retire — they live forever in the stands.\n\n` +
    `United we stand 💪🔴\n\n` +
    `#MUFC #ManchesterUnited #RedDevils #OldTrafford #GloryGlory`;
  const img = "https://i.imgur.com/9Y9A7uB.jpeg";
  const postId = await postPhoto(img, caption);
  res.send(postId ? `done — ${postId}` : "failed");
});

app.get("/status", (req, res) => {
  res.json({
    running: true,
    requestsRemaining,
    hasLiveMatches,
    pausedUntilMidnight,
    sleepingUntil: pausedUntil ? pausedUntil.toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos" }) + " WAT" : null,
    matchesTracked: Object.keys(previousScores).length,
    nextInterval: pausedUntil ? "sleeping" : getInterval() ? `${Math.round(getInterval() / 60000)} min` : "paused",
  });
});

app.get("/wake", (req, res) => {
  pausedUntil = null;
  pausedUntilMidnight = false;
  run();
  res.send("bot resumed");
});

app.get("/comeback", async (req, res) => {
  const messages = [
    `Sorry for going quiet on you all! 🙏 We had a little technical hiccup but we are BACK and fully live now!\n\nAll goal alerts, kick-off and full-time updates are running again. You won't miss a single thing from here on 💪\n\n⚽ Drop a comment below if there's a match you want us to cover!\n🔔 Make sure you're following the page so you never miss a goal alert!`,
    `We're back! 🔔 Apologies for the silence — we had some downtime but the bot is fully up and running again now.\n\nEvery goal, every kick-off, every final whistle — we've got you covered from here 💪⚽\n\nStay with us, the updates are coming! 🔥`,
    `Back online! 🟢 Sorry we went quiet for a bit — technical issues on our end but everything is sorted now.\n\nLive match updates are running again. Goals, half-time scores, full-time results — all of it ⚽\n\nTag a friend who needs live football updates! 👇🔔`,
  ];
  const msg = messages[Math.floor(Math.random() * messages.length)];
  const img = "https://i.imgur.com/9Y9A7uB.jpeg";
  const postId = await postPhoto(img, msg);
  // immediately trigger a live check after posting
  pausedUntil = null;
  pausedUntilMidnight = false;
  run();
  res.send(postId ? `comeback post sent — ${postId}` : "post failed — check token");
});

app.get("/check", async (req, res) => {
  pausedUntil = null;
  pausedUntilMidnight = false;
  run();
  res.send("live check triggered");
});

app.get("/sleep", (req, res) => {
  const hour = parseInt(req.query.hour || "17");
  const target = new Date();
  target.setUTCHours(hour - 1, 0, 0, 0); // convert WAT to UTC
  if (target <= new Date()) {
    res.send("that time has already passed today");
    return;
  }
  pausedUntil = target;
  scheduleNext();
  res.send(`sleeping until ${target.toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos" })} WAT`);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`port ${PORT}`);
});
