export const config = { maxDuration: 30 };

const PLAYERS_URL = 'https://play.fifa.com/json/fantasy/players.json';
const SQUADS_URL  = 'https://play.fifa.com/json/fantasy/squads.json';
const ROUNDS_URL  = 'https://play.fifa.com/json/fantasy/rounds.json';
const ESPN_LEADERS_URL = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world/seasons/2026/types/1/leaders?lang=en&region=us';
const HEADERS     = { 'User-Agent': 'Mozilla/5.0' };

// Goal/assist leaderboards — ESPN's free, no-key World Cup stats feed.
// Each leader only carries an athlete $ref; fetch each athlete for name + country.
async function fetchTopStats() {
  try {
    const leadersRes = await fetch(ESPN_LEADERS_URL, { headers: HEADERS }).then(r => r.json());
    const categories = leadersRes.categories || [];

    const buildLeaders = async (categoryName, unitLabel) => {
      const cat = categories.find(c => c.name === categoryName);
      const top = (cat?.leaders || []).slice(0, 5);
      return Promise.all(top.map(async l => {
        const athlete = await fetch(l.athlete.$ref, { headers: HEADERS }).then(r => r.json());
        return {
          name:  athlete.shortName || athlete.displayName || 'Unknown',
          squad: athlete.flag?.alt || '',
          label: `${l.value} ${unitLabel}`,
        };
      }));
    };

    const [topGoals, topAssists] = await Promise.all([
      buildLeaders('goalsLeaders', 'goals'),
      buildLeaders('assistsLeaders', 'assists'),
    ]);
    return { topGoals, topAssists };
  } catch (_) { return { topGoals: [], topAssists: [] }; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  try {
    const [playersRaw, squadsRaw, roundsRaw, topStats] = await Promise.all([
      fetch(PLAYERS_URL, { headers: HEADERS }).then(r => r.json()),
      fetch(SQUADS_URL,  { headers: HEADERS }).then(r => r.json()),
      fetch(ROUNDS_URL,  { headers: HEADERS }).then(r => r.json()),
      fetchTopStats(),
    ]);

    const playersList = Array.isArray(playersRaw)
      ? playersRaw
      : (playersRaw.players || playersRaw.data || []);

    const squadsList = Array.isArray(squadsRaw)
      ? squadsRaw
      : (squadsRaw.squads || squadsRaw.teams || squadsRaw.data || []);

    const squadMap = {};
    for (const s of squadsList) {
      const id = s.id ?? s.squadId ?? s.teamId;
      if (id != null) squadMap[id] = {
        name:       s.name || s.teamName || s.squadName || String(id),
        abbr:       s.abbreviation || s.abbr || s.code || '',
        eliminated: !!(s.isEliminated || s.eliminated),
      };
    }

    const roundsList = Array.isArray(roundsRaw)
      ? roundsRaw
      : (roundsRaw.rounds || roundsRaw.data || []);

    const now = Date.now();
    const activeRound = roundsList.find(r => {
      const start = r.startDate || r.start || r.lockDate;
      const end   = r.endDate   || r.end;
      return start && end && new Date(start) <= now && now <= new Date(end);
    }) || roundsList.find(r => {
      const start = r.startDate || r.start || r.lockDate;
      return start && new Date(start) > now;
    }) || roundsList[0];

    const roundName = activeRound
      ? (activeRound.name || activeRound.roundName || activeRound.label || `Round ${activeRound.id}`)
      : 'Round 1';

    const withPoints = playersList
      .map(p => {
        const squadId = p.squadId ?? p.teamId ?? p.squad?.id;
        const squad   = squadMap[squadId] || { name: '', abbr: '', eliminated: false };
        const pts     = Number(p.stats?.totalPoints ?? p.totalPoints ?? p.points ?? p.score ?? 0);
        const price   = Number(p.value ?? p.price ?? p.cost ?? 0);
        const name    = p.name || p.webName || p.displayName || p.lastName || `Player ${p.id}`;
        return { name, squad, pts, price };
      })
      .filter(p => !p.squad.eliminated);

    const preTournament = withPoints.every(p => p.pts === 0);

    const topScorers = preTournament
      ? [...withPoints]
          .sort((a, b) => b.price - a.price)
          .slice(0, 5)
          .map(p => ({ name: p.name, squad: p.squad.abbr || p.squad.name, label: `$${p.price}m` }))
      : [...withPoints]
          .sort((a, b) => b.pts - a.pts)
          .slice(0, 5)
          .map(p => ({ name: p.name, squad: p.squad.abbr || p.squad.name, label: `${p.pts} pts` }));

    const bestValue = preTournament ? [] : [...withPoints]
      .filter(p => p.price > 0)
      .map(p => ({ ...p, ratio: p.pts / p.price }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 5)
      .map(p => ({
        name:  p.name,
        squad: p.squad.abbr || p.squad.name,
        price: p.price,
        pts:   p.pts,
        ratio: Math.round(p.ratio * 10) / 10,
      }));

    res.json({ roundName, preTournament, topScorers, bestValue, ...topStats });
  } catch (err) {
    res.status(500).json({ error: String(err), roundName: '', topScorers: [], bestValue: [], topGoals: [], topAssists: [] });
  }
}
