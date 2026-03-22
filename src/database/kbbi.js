import logger from '../utils/logger.js'
import { getCollection } from './mongo.js'

const now = () => new Date()

const tierFromElo = (elo) => {
    const n = Number(elo || 1000)
    if (n >= 1400) return 'platinum'
    if (n >= 1200) return 'emas'
    if (n >= 1000) return 'perak'
    return 'perunggu'
}

class KbbiDatabase {
    constructor() {
        this._matches = null
        this._stats = null
        this._ranked = null
        this._initialized = false
    }

    async init() {
        if (this._initialized) return

        this._matches = await getCollection('kbbi_matches')
        this._stats = await getCollection('kbbi_stats')
        this._ranked = await getCollection('kbbi_ranked')

        await Promise.all([
            this._matches.createIndex({ sessionId: 1 }, { unique: true }),
            this._matches.createIndex({ chatId: 1, createdAt: -1 }),
            this._matches.createIndex({ winner: 1, createdAt: -1 }),
            this._stats.createIndex({ jid: 1 }, { unique: true }),
            this._ranked.createIndex({ jid: 1 }, { unique: true }),
            this._ranked.createIndex({ elo: -1 })
        ])

        this._initialized = true
        logger.ready('Basis data KBBI siap')
    }

    async _ensure() {
        if (!this._initialized) await this.init()
    }

    async recordMatch(match) {
        await this._ensure()
        const doc = {
            ...match,
            createdAt: now()
        }
        await this._matches.insertOne(doc)
        return doc
    }

    async _applyUserStats({
        jid,
        isWin,
        mode,
        durationMs,
        wordCount,
        strikeCount
    }) {
        await this._ensure()
        const current = await this._stats.findOne({ jid }) || {}
        const streak = isWin ? (Number(current.currentWinStreak || 0) + 1) : 0
        const bestStreak = Math.max(Number(current.bestWinStreak || 0), streak)

        const patch = {
            jid,
            updatedAt: now(),
            currentWinStreak: streak,
            bestWinStreak: bestStreak
        }

        await this._stats.updateOne(
            { jid },
            {
                $set: patch,
                $setOnInsert: { createdAt: now() },
                $inc: {
                    played: 1,
                    wins: isWin ? 1 : 0,
                    losses: isWin ? 0 : 1,
                    rankedPlayed: mode === 'peringkat' ? 1 : 0,
                    totalDurationMs: Math.max(0, Number(durationMs) || 0),
                    totalWords: Math.max(0, Number(wordCount) || 0),
                    totalStrikes: Math.max(0, Number(strikeCount) || 0)
                }
            },
            { upsert: true }
        )
    }

    async applyMatchStats({
        winner,
        loser,
        mode,
        durationMs,
        wordCounts = {},
        strikes = {}
    }) {
        // Pastikan pengguna selalu punya baris dasar ELO (1000),
        // supaya .kbbi papanatas tidak kosong walau pertandingan non-peringkat.
        await Promise.all([
            this._getRanked(winner),
            this._getRanked(loser)
        ])

        await this._applyUserStats({
            jid: winner,
            isWin: true,
            mode,
            durationMs,
            wordCount: wordCounts[winner] || 0,
            strikeCount: strikes[winner] || 0
        })

        await this._applyUserStats({
            jid: loser,
            isWin: false,
            mode,
            durationMs,
            wordCount: wordCounts[loser] || 0,
            strikeCount: strikes[loser] || 0
        })
    }

    async _getRanked(jid) {
        await this._ensure()
        const row = await this._ranked.findOne({ jid })
        if (row) return row

        const base = {
            jid,
            elo: 1000,
            wins: 0,
            losses: 0,
            createdAt: now(),
            updatedAt: now()
        }
        await this._ranked.insertOne(base)
        return base
    }

    async applyRankedResult({ winner, loser, winnerBonus = 0, loserPenalty = 0 }) {
        await this._ensure()
        const w = await this._getRanked(winner)
        const l = await this._getRanked(loser)

        const winnerDelta = 25 + Math.max(0, Number(winnerBonus) || 0)
        const loserDelta = 20 + Math.max(0, Number(loserPenalty) || 0)

        const nextW = Number(w.elo || 1000) + winnerDelta
        const nextL = Math.max(0, Number(l.elo || 1000) - loserDelta)

        await Promise.all([
            this._ranked.updateOne(
                { jid: winner },
                {
                    $set: { elo: nextW, updatedAt: now() },
                    $inc: { wins: 1 }
                },
                { upsert: true }
            ),
            this._ranked.updateOne(
                { jid: loser },
                {
                    $set: { elo: nextL, updatedAt: now() },
                    $inc: { losses: 1 }
                },
                { upsert: true }
            )
        ])

        return {
            winner: { before: Number(w.elo || 1000), after: nextW, delta: +winnerDelta },
            loser: { before: Number(l.elo || 1000), after: nextL, delta: -loserDelta }
        }
    }

    async getUserSummary(jid) {
        await this._ensure()
        const [stats, ranked] = await Promise.all([
            this._stats.findOne({ jid }),
            this._getRanked(jid)
        ])

        const played = Number(stats?.played || 0)
        const wins = Number(stats?.wins || 0)
        const losses = Number(stats?.losses || 0)
        const winRate = played > 0 ? ((wins / played) * 100).toFixed(1) : '0.0'

        return {
            jid,
            played,
            wins,
            losses,
            winRate,
            currentWinStreak: Number(stats?.currentWinStreak || 0),
            bestWinStreak: Number(stats?.bestWinStreak || 0),
            rankedPlayed: Number(stats?.rankedPlayed || 0),
            totalWords: Number(stats?.totalWords || 0),
            totalStrikes: Number(stats?.totalStrikes || 0),
            elo: Number(ranked?.elo || 1000),
            tier: tierFromElo(Number(ranked?.elo || 1000))
        }
    }

    async getTopRanked(limit = 10) {
        await this._ensure()
        const max = Math.max(1, Math.min(20, Number(limit) || 10))
        const [rankedRows, statsRows] = await Promise.all([
            this._ranked.find({}, { projection: { _id: 0 } }).toArray(),
            this._stats.find({}, { projection: { _id: 0, jid: 1, wins: 1, losses: 1, played: 1 } }).toArray()
        ])

        const statsMap = new Map(
            statsRows.map((s) => [
                s.jid,
                {
                    wins: Number(s.wins || 0),
                    losses: Number(s.losses || 0),
                    played: Number(s.played || 0)
                }
            ])
        )

        const merged = new Map()

        for (const r of rankedRows) {
            const st = statsMap.get(r.jid) || { wins: 0, losses: 0, played: 0 }
            merged.set(r.jid, {
                jid: r.jid,
                elo: Number(r.elo || 1000),
                wins: st.wins,
                losses: st.losses,
                played: st.played
            })
        }

        for (const s of statsRows) {
            if (merged.has(s.jid)) continue
            merged.set(s.jid, {
                jid: s.jid,
                elo: 1000,
                wins: Number(s.wins || 0),
                losses: Number(s.losses || 0),
                played: Number(s.played || 0)
            })
        }

        const rows = Array.from(merged.values())
            .sort((a, b) =>
                (b.elo - a.elo) ||
                (b.wins - a.wins) ||
                (a.losses - b.losses) ||
                (b.played - a.played) ||
                String(a.jid).localeCompare(String(b.jid))
            )
            .slice(0, max)

        return rows.map((r, idx) => ({
            rank: idx + 1,
            jid: r.jid,
            elo: Number(r.elo || 1000),
            tier: tierFromElo(Number(r.elo || 1000)),
            wins: Number(r.wins || 0),
            losses: Number(r.losses || 0)
        }))
    }
}

const kbbiDb = new KbbiDatabase()
export default kbbiDb
