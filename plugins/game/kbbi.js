import kbbiSession from '../../src/game/kbbiSession.js'
import { normalizeKbbiWord, validateKbbiWord } from '../../src/game/kbbiValidator.js'
import kbbiDb from '../../src/database/kbbi.js'
import { getTargetJid } from '../../src/utils/group.js'
import { normalizeJid } from '../../src/utils/jid.js'

const LOBBY_TIMEOUT_MS = 10 * 60 * 1000
const TURN_TIMEOUT_SEC = 25
const SUDDEN_TIMEOUT_SEC = 12
const MAX_STRIKE = 3

const MODE_SET = new Set(['klasik', 'peringkat'])
const SEED_WORDS = [
    'rumah', 'bunga', 'meja', 'buku', 'jalan', 'kopi', 'hujan', 'angin', 'tanah', 'laut',
    'sinar', 'pohon', 'kertas', 'sawah', 'hutan', 'gajah', 'jarak', 'sabun', 'taman', 'kursi'
]

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const now = () => Date.now()

const formatDuration = (ms = 0) => {
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000))
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}m ${s}s`
}

const toUser = (jid) => String(normalizeJid(jid) || jid || '').split('@')[0].split(':')[0]
const mentionTag = (jid) => `@${toUser(jid)}`
const modeLabel = (mode) => {
    if (mode === 'klasik') return 'KLASIK'
    if (mode === 'peringkat') return 'RANK'
    return String(mode || '').toUpperCase()
}

const normalizeModeToken = (token) => {
    const t = String(token || '').toLowerCase().trim()
    if (!t) return ''
    if (t === 'klasik') return 'klasik'
    if (t === 'rank') return 'peringkat'
    if (t === 'peringkat') return 'peringkat'
    return ''
}
const isModeToken = (token) => Boolean(normalizeModeToken(token))
const parseMode = (tokens = []) => {
    for (const token of tokens) {
        const normalized = normalizeModeToken(token)
        if (MODE_SET.has(normalized)) return normalized
    }
    return 'klasik'
}

const getPrefixFromWord = (word, n) => {
    const raw = normalizeKbbiWord(word)
    if (!raw) return ''
    return raw.slice(-Math.max(1, Number(n) || 1))
}

const pickSeedWord = () => SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)]

const getOtherPlayer = (session, jid) => session.players.find((x) => x !== jid) || ''

const buildHelp = (prefix, command) =>
    `Format duel KBBI:\n` +
    `- ${prefix + command} duel/tantang @user\n` +
    `- ${prefix + command} duel/tantang @user (klasik/rank)\n` +
    `- ${prefix + command} acc/tolak/stop\n` +
    `- ${prefix + command} statistik @user\n` +
    `- ${prefix + command} top`

const resetRoundState = (session) => {
    session.usedWords = new Set()
    session.strikes = Object.fromEntries(session.players.map((p) => [p, 0]))
    session.combo = Object.fromEntries(session.players.map((p) => [p, 0]))
    session.prefixLen = 1
    session.turnTimeoutSec = TURN_TIMEOUT_SEC
}

const getTurnTimeoutSec = (session) => (session.prefixLen >= 2 ? SUDDEN_TIMEOUT_SEC : TURN_TIMEOUT_SEC)

const setNextTurnTimer = (session, onTimeout) => {
    const timeoutSec = getTurnTimeoutSec(session)
    session.turnTimeoutSec = timeoutSec
    session.turnStartedAt = now()
    kbbiSession.setTurnTimer(session, timeoutSec * 1000, onTimeout)
}

const withLock = async (session, task) => {
    if (session.locked) return false
    session.locked = true
    try {
        await task()
    } finally {
        session.locked = false
    }
    return true
}

const startRound = async (session, sock, onTimeout) => {
    resetRoundState(session)
    session.round += 1
    session.status = 'bermain'
    if (!session.startedAt) session.startedAt = now()

    let seed = pickSeedWord()
    const checked = await validateKbbiWord(seed)
    if (!checked.ok) seed = 'rumah'

    session.usedWords.add(normalizeKbbiWord(seed))
    session.requiredPrefix = getPrefixFromWord(seed, 1)
    session.turn = session.players[Math.floor(Math.random() * session.players.length)]

    const lines = [
        `KBBI DUEL ${modeLabel(session.mode)} RONDE ${session.round}/${session.totalRounds}`,
        `• Kata awal: ${seed}`,
        `• Awalan berikutnya: ${session.requiredPrefix}`,
        `• Giliran: ${mentionTag(session.turn)}`,
        `• Batas jawab: ${getTurnTimeoutSec(session)} detik`
    ]

    await sock.sendMessage(session.chatId, {
        text: lines.join('\n'),
        mentions: [session.turn]
    })

    setNextTurnTimer(session, onTimeout)
}

const endMatch = async (session, sock, winner, reason) => {
    kbbiSession.clearTurnTimer(session)
    kbbiSession.clearLobbyTimer(session)
    session.status = 'selesai'
    const loser = getOtherPlayer(session, winner)
    const durationMs = now() - session.startedAt

    const matchDoc = {
        sessionId: session.id,
        chatId: session.chatId,
        mode: session.mode,
        players: session.players,
        winner,
        loser,
        reason,
        durationMs,
        totalWords: Number(session.totalMoves || 0),
        roundWins: session.roundWins,
        wordCounts: session.wordCounts,
        strikes: session.strikes
    }

    let rankedChange = null
    try {
        await kbbiDb.recordMatch(matchDoc)
        await kbbiDb.applyMatchStats(matchDoc)
        if (session.mode === 'peringkat') {
            rankedChange = await kbbiDb.applyRankedResult({
                winner,
                loser
            })
        }
    } catch {}

    const summary = [
        `KBBI DUEL ${modeLabel(session.mode)} SELESAI`,
        `• Menang: ${mentionTag(winner)}`,
        `• Kalah: ${mentionTag(loser)}`,
        `• Durasi: ${formatDuration(durationMs)}`,
        `• Total: ${session.totalMoves} kata`
    ]

    if (rankedChange) {
        summary.push(
            `• ELO ${mentionTag(winner)}: ${rankedChange.winner.before} ➠ ${rankedChange.winner.after} (${rankedChange.winner.delta})`,
            `• ELO ${mentionTag(loser)}: ${rankedChange.loser.before} ➠ ${rankedChange.loser.after} (${rankedChange.loser.delta})`
        )
    }

    summary.push('', reason)

    await sock.sendMessage(session.chatId, {
        text: summary.join('\n'),
        mentions: [winner, loser]
    })

    kbbiSession.remove(session)
}

const endRoundOrMatch = async (session, sock, winner, reason, onTimeout) => {
    session.roundWins[winner] = Number(session.roundWins[winner] || 0) + 1
    const targetWin = 1

    if (session.roundWins[winner] >= targetWin || session.round >= session.totalRounds) {
        await endMatch(session, sock, winner, reason)
        return
    }

    const info = [
        `RONDE ${session.round} SELESAI`,
        `• Pemenang ronde: ${mentionTag(winner)}`,
        `• Skor: ${session.players.map((p) => `${toUser(p)} ${session.roundWins[p] || 0}`).join(' | ')}`,
        `Ronde berikutnya dimulai...\n`
    ]

    await sock.sendMessage(session.chatId, {
        text: info.join('\n'),
        mentions: [winner]
    })

    await startRound(session, sock, onTimeout)
}

const failTurn = async (session, sock, target, reason, onTimeout) => {
    session.strikes[target] = Number(session.strikes[target] || 0) + 1
    session.combo[target] = 0

    if (session.strikes[target] >= MAX_STRIKE) {
        const winner = getOtherPlayer(session, target)
        await endRoundOrMatch(session, sock, winner, `${mentionTag(target)} melakukan 3 kesalahan. ${reason}`, onTimeout)
        return
    }

    session.turn = getOtherPlayer(session, target)
    const lines = [
        `❌ Salah: ${reason}`,
        `• Kesalahan ${mentionTag(target)}: ${session.strikes[target]}/${MAX_STRIKE}`,
        `• Awalan: ${session.requiredPrefix}`,
        `• Giliran: ${mentionTag(session.turn)}`,
        `• Batas jawab: ${getTurnTimeoutSec(session)} detik`
    ]

    await sock.sendMessage(session.chatId, {
        text: lines.join('\n'),
        mentions: [target, session.turn]
    })

    setNextTurnTimer(session, onTimeout)
}

const processAnswer = async (session, sock, sender, rawWord, onTimeout) => {
    const word = normalizeKbbiWord(rawWord)
    const minLen = 4

    if (!word) {
        await failTurn(session, sock, sender, 'kata kosong/tidak dikenali', onTimeout)
        return
    }

    if (word.length < minLen) {
        await failTurn(session, sock, sender, `panjang kata minimal ${minLen} huruf`, onTimeout)
        return
    }

    if (!word.startsWith(session.requiredPrefix)) {
        await failTurn(session, sock, sender, `harus diawali "${session.requiredPrefix}"`, onTimeout)
        return
    }

    if (session.usedWords.has(word)) {
        await failTurn(session, sock, sender, 'kata sudah pernah dipakai', onTimeout)
        return
    }

    const checked = await validateKbbiWord(word)
    if (!checked.ok) {
        await failTurn(session, sock, sender, checked.reason || 'kata tidak ditemukan di KBBI', onTimeout)
        return
    }

    kbbiSession.clearTurnTimer(session)

    const responseMs = now() - session.turnStartedAt
    session.wordCounts[sender] = Number(session.wordCounts[sender] || 0) + 1
    session.totalMoves = Number(session.totalMoves || 0) + 1
    session.usedWords.add(word)

    if (responseMs <= 5000) session.combo[sender] = Number(session.combo[sender] || 0) + 1
    else session.combo[sender] = 0

    if (session.totalMoves >= 30 && session.prefixLen === 1) {
        session.prefixLen = 2
    }

    session.requiredPrefix = getPrefixFromWord(word, session.prefixLen)
    session.turn = getOtherPlayer(session, sender)

    const rows = [
        `✅ ${mentionTag(sender)}: ${word}`,
        `• Kombo: ${session.combo[sender] || 0}`,
        `• Awalan berikutnya: ${session.requiredPrefix}`,
        `• Giliran: ${mentionTag(session.turn)}`,
        `• Batas jawab: ${getTurnTimeoutSec(session)} detik`
    ]
    if (session.prefixLen >= 2) {
        rows.push(`• Mode cepat: AKTIF (awalan 2 huruf, batas waktu ${SUDDEN_TIMEOUT_SEC} detik)`)
    }

    await sock.sendMessage(session.chatId, {
        text: rows.join('\n'),
        mentions: [sender, session.turn]
    })

    setNextTurnTimer(session, onTimeout)
}

const parseSubCommand = (args = []) => {
    const raw = String(args[0] || '').toLowerCase().trim()
    const map = {
        buat: 'buat',
        duel: 'buat',
        tantang: 'buat',
        terima: 'terima',
        acc: 'terima',
        gas: 'terima',
        tolak: 'tolak',
        berhenti: 'berhenti',
        stop: 'berhenti',
        statistik: 'statistik',
        stats: 'statistik',
        stat: 'statistik',
        top: 'top',
        papanatas: 'top'
    }
    return map[raw] || raw
}

export default {
    name: 'kbbi',
    aliases: ['duelkbbi'],
    description: 'Game duel kata KBBI 1v1',
    groupOnly: true,

    execute: async ({
        sock, msg, args, text, prefix, command, sender, react, useLimit
    }) => {
        const chatId = msg.key.remoteJid
        const senderId = normalizeJid(sender)
        const sub = parseSubCommand(args)
        const session = kbbiSession.getByChat(chatId)

        const onTimeout = async (sessionId) => {
            const current = kbbiSession.getById(sessionId)
            if (!current || current.status !== 'bermain') return
            await withLock(current, async () => {
                if (current.status !== 'bermain') return
                await failTurn(current, sock, current.turn, 'waktu habis', onTimeout)
            })
        }

        const cancelLobby = async (current, reason) => {
            kbbiSession.clearLobbyTimer(current)
            await sock.sendMessage(chatId, { text: `❌ Lobby dibatalkan. ${reason}` })
            kbbiSession.remove(current)
        }

        if (!sub) {
            return sock.sendMessage(chatId, { text: buildHelp(prefix, command) }, { quoted: msg })
        }

        if (sub === 'buat') {
            if (session) {
                return sock.sendMessage(chatId, { text: '❌ Masih ada sesi KBBI aktif di grup ini.' }, { quoted: msg })
            }

            if (kbbiSession.getByUser(senderId)) {
                return sock.sendMessage(chatId, { text: '❌ Kamu masih terdaftar di sesi KBBI lain.' }, { quoted: msg })
            }

            const mode = parseMode(args.slice(1))
            const targetText = args.slice(1).filter((x) => !isModeToken(x)).join(' ')
            const target = normalizeJid(getTargetJid(msg, targetText))
            const botJid = normalizeJid(sock?.user?.id || '')
            const botLid = normalizeJid(sock?.user?.lid || '')
            if (!target || target === senderId) {
                return sock.sendMessage(chatId, {
                    text: `❌ Lawan tidak ditemukan.\n\nContoh: ${prefix + command} duel @pengguna rank`
                }, { quoted: msg })
            }
            if (target === botJid || (botLid && target === botLid)) {
                return sock.sendMessage(chatId, {
                    text: '❌ Tidak bisa menantang bot. pilih lawan pengguna lain.'
                }, { quoted: msg })
            }

            if (kbbiSession.getByUser(target)) {
                return sock.sendMessage(chatId, { text: '❌ Lawan masih ada di sesi KBBI lain.' }, { quoted: msg })
            }

            const totalRounds = 1
            const created = kbbiSession.createLobby({
                chatId,
                creator: senderId,
                opponent: target,
                mode,
                totalRounds
            })

            kbbiSession.setLobbyTimer(created, LOBBY_TIMEOUT_MS, async (sessionId) => {
                const row = kbbiSession.getById(sessionId)
                if (!row || row.status !== 'lobi') return
                await cancelLobby(row, 'tidak diterima dalam 10 menit')
            })

            useLimit()
            await react('✅')

            return sock.sendMessage(chatId, {
                text:
                    `LOBBY KBBI DUEL ${modeLabel(mode)}\n` +
                    `• Pembuat: ${mentionTag(senderId)}\n` +
                    `• Lawan: ${mentionTag(target)}\n\n` +
                    `${mentionTag(target)} ketik ${prefix + command} acc atau ${prefix + command} gas untuk mulai. batas waktu 10 menit`,
                mentions: [senderId, target]
            }, { quoted: msg })
        }

        if (!session && !['statistik', 'top'].includes(sub)) {
            return sock.sendMessage(chatId, { text: '❌ Tidak ada sesi KBBI aktif.' }, { quoted: msg })
        }

        if (sub === 'terima') {
            if (session.status !== 'lobi') {
                return sock.sendMessage(chatId, { text: '❌ Sesi tidak dalam status lobi.' }, { quoted: msg })
            }
            if (senderId !== session.opponent) {
                return sock.sendMessage(chatId, { text: '❌ Hanya lawan yang bisa menerima.' }, { quoted: msg })
            }

            kbbiSession.clearLobbyTimer(session)
            await react('⏳')
            await startRound(session, sock, onTimeout)
            useLimit()
            await react('✅')
            return
        }

        if (sub === 'tolak') {
            if (session.status !== 'lobi') {
                return sock.sendMessage(chatId, { text: '❌ Sesi tidak dalam status lobi.' }, { quoted: msg })
            }
            if (senderId !== session.opponent && senderId !== session.creator) {
                return sock.sendMessage(chatId, { text: '❌ Hanya pembuat/lawan yang bisa menolak.' }, { quoted: msg })
            }
            await react('✅')
            return cancelLobby(session, 'ditolak oleh pemain')
        }

        if (sub === 'berhenti') {
            if (!session.players.includes(senderId)) {
                return sock.sendMessage(chatId, { text: '❌ Hanya pemain yang bisa menghentikan sesi.' }, { quoted: msg })
            }
            kbbiSession.remove(session)
            await react('✅')
            return sock.sendMessage(chatId, { text: '🛑 Sesi KBBI dihentikan.' }, { quoted: msg })
        }

        if (sub === 'statistik') {
            const statArg = text.replace(/^(statistik|stats|stat)\s*/i, '').trim()
            const target = normalizeJid(getTargetJid(msg, statArg) || senderId)
            const summary = await kbbiDb.getUserSummary(target)
            return sock.sendMessage(chatId, {
                text:
                    `\`\`\`STATISTIK KBBI\n` +
                    `• Pengguna: ${mentionTag(target)}\n` +
                    `• Total pertandingan: ${summary.played}\n` +
                    `• Menang: ${summary.wins}\n` +
                    `• Kalah: ${summary.losses}\n` +
                    `• Rasio menang: ${summary.winRate}%\n` +
                    `• Kemenangan beruntun: ${summary.currentWinStreak}\n` +
                    `• Rekor kemenangan beruntun: ${summary.bestWinStreak}\n` +
                    `• Total kata: ${summary.totalWords}\n` +
                    `• Total kesalahan: ${summary.totalStrikes}\n` +
                    `• ELO: ${summary.elo}\n` +
                    `• Tingkat: ${summary.tier}\`\`\``,
                mentions: [target]
            }, { quoted: msg })
        }

        if (sub === 'top') {
            const top = await kbbiDb.getTopRanked(10)
            if (!top.length) {
                return sock.sendMessage(chatId, { text: '❌ TOP masih kosong.' }, { quoted: msg })
            }
            const mentions = top.map((row) => normalizeJid(row.jid)).filter(Boolean)
            const body = top.map((row) =>
                `${row.rank}. ${mentionTag(row.jid)}\n` +
                `• ELO: ${row.elo}\n` +
                `• Tingkat: ${row.tier}\n` +
                `• Menang/kalah: ${row.wins}/${row.losses}`
            ).join('\n\n')
            return sock.sendMessage(chatId, {
                text: `\`\`\`KBBI TOP 10\n\n${body}\`\`\``,
                mentions
            }, { quoted: msg })
        }

        return sock.sendMessage(chatId, { text: buildHelp(prefix, command) }, { quoted: msg })
    },

    onMessage: async ({ sock, msg, isGroup, sender, body, config }) => {
        if (!isGroup) return
        const text = cleanText(body)
        if (!text) return
        if ((config?.prefixes || []).some((p) => text.startsWith(p))) return

        const chatId = msg.key.remoteJid
        const senderId = normalizeJid(sender)
        const session = kbbiSession.getByChat(chatId)
        if (!session || session.status !== 'bermain') return
        if (!session.players.includes(senderId)) return
        if (session.turn !== senderId) return

        const onTimeout = async (sessionId) => {
            const current = kbbiSession.getById(sessionId)
            if (!current || current.status !== 'bermain') return
            await withLock(current, async () => {
                if (current.status !== 'bermain') return
                await failTurn(current, sock, current.turn, 'waktu habis', onTimeout)
            })
        }

        await withLock(session, async () => {
            if (session.status !== 'bermain') return
            await processAnswer(session, sock, senderId, text, onTimeout)
        })
    }
}
