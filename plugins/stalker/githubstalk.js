import axios from 'axios'

const API_BASE = 'https://api.github.com'
const REQUEST_TIMEOUT = 30000
const REQUIRED_FIELDS = [
    'login',
    'id',
    'type',
    'avatar_url',
    'html_url',
    'public_repos',
    'public_gists',
    'followers',
    'following',
    'created_at',
    'updated_at'
]

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const toCompactNumber = (value) => {
    const n = Number(value || 0)
    if (!Number.isFinite(n)) return '0'
    const abs = Math.abs(n)
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
    return String(Math.floor(n))
}

const toSafe = (value, fallback = '[none]') => {
    if (value === null || value === undefined) return fallback
    const text = cleanText(value)
    return text || fallback
}

const toBool = (value) => (value === true ? 'Yes' : 'No')

const toDate = (value) => {
    const raw = cleanText(value)
    if (!raw) return '[none]'
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return raw
    return d.toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Jakarta'
    })
}

const normalizeUsername = (input) => {
    const raw = cleanText(input)
    if (!raw) return ''

    let username = raw
    if (/^https?:\/\//i.test(raw)) {
        try {
            const url = new URL(raw)
            if (!/(^|\.)github\.com$/i.test(url.hostname)) return ''
            const first = url.pathname.split('/').filter(Boolean)[0] || ''
            username = first
        } catch {
            return ''
        }
    }

    username = username.replace(/^@+/, '')
    username = username.split(/[/?#]/)[0]
    username = cleanText(username).replace(/\s+/g, '')
    if (!/^[A-Za-z0-9-]{1,39}$/.test(username)) return ''
    return username
}

const assertStrictProfile = (profile = {}) => {
    for (const field of REQUIRED_FIELDS) {
        const value = profile[field]
        const invalid =
            value === null ||
            value === undefined ||
            (typeof value === 'string' && !value.trim()) ||
            (typeof value === 'number' && !Number.isFinite(value))
        if (invalid) throw new Error(`Metadata tidak lengkap: ${field}`)
    }
}

const requestGithub = async (path, params = {}) => {
    const { data, status } = await axios.get(`${API_BASE}${path}`, {
        params,
        timeout: REQUEST_TIMEOUT,
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        validateStatus: () => true
    })

    if (status === 404) throw new Error('User/organisasi tidak ditemukan')
    if (status !== 200) throw new Error(`GitHub API HTTP ${status}`)
    return data
}

const fetchGithubProfile = async (username) => {
    const profile = await requestGithub(`/users/${encodeURIComponent(username)}`)
    assertStrictProfile(profile)

    const repos = await requestGithub(`/users/${encodeURIComponent(username)}/repos`, {
        per_page: 100,
        sort: 'updated',
        direction: 'desc'
    })

    const repoRows = Array.isArray(repos) ? repos : []
    const latestRepo = repoRows[0] || null
    const topRepo = repoRows
        .slice()
        .sort((a, b) => Number(b?.stargazers_count || 0) - Number(a?.stargazers_count || 0))[0] || null

    return { profile, latestRepo, topRepo }
}

const buildCaption = ({ profile, latestRepo, topRepo }) => {
    const login = toSafe(profile.login)
    const name = toSafe(profile.name)
    const id = toSafe(profile.id)
    const nodeId = toSafe(profile.node_id)
    const type = toSafe(profile.type)
    const company = toSafe(profile.company)
    const blog = toSafe(profile.blog)
    const location = toSafe(profile.location)
    const email = toSafe(profile.email)
    const twitter = toSafe(profile.twitter_username)
    const bio = toSafe(profile.bio)
    const repos = toCompactNumber(profile.public_repos)
    const gists = toCompactNumber(profile.public_gists)
    const followers = toCompactNumber(profile.followers)
    const following = toCompactNumber(profile.following)
    const created = toDate(profile.created_at)
    const updated = toDate(profile.updated_at)
    const siteAdmin = toBool(profile.site_admin)
    const hireable = profile.hireable === null ? '[none]' : toBool(profile.hireable)
    const profileUrl = toSafe(profile.html_url)

    const latestName = toSafe(latestRepo?.name)
    const latestStar = latestRepo ? toCompactNumber(latestRepo?.stargazers_count || 0) : '[none]'
    const latestFork = latestRepo ? toCompactNumber(latestRepo?.forks_count || 0) : '[none]'
    const latestLang = toSafe(latestRepo?.language)
    const latestUpdated = latestRepo ? toDate(latestRepo?.updated_at) : '[none]'

    const topName = toSafe(topRepo?.name)
    const topStar = topRepo ? toCompactNumber(topRepo?.stargazers_count || 0) : '[none]'
    const topFork = topRepo ? toCompactNumber(topRepo?.forks_count || 0) : '[none]'

    return (
        `GITHUB STALK ${name.toUpperCase()}\n\n` +
        `\`\`\`• Username: ${login}\n` +
        `• ID: ${id}\n` +
        `• Node ID: ${nodeId}\n` +
        `• Type: ${type}\n` +
        `• Site Admin: ${siteAdmin}\n` +
        `• Hireable: ${hireable}\n` +
        `• Company: ${company}\n` +
        `• Blog: ${blog}\n` +
        `• Location: ${location}\n` +
        `• Email: ${email}\n` +
        `• Twitter: ${twitter}\n` +
        `• Bio: ${bio}\n` +
        `• Public Repos: ${repos}\n` +
        `• Public Gists: ${gists}\n` +
        `• Followers: ${followers}\n` +
        `• Following: ${following}\n` +
        `• Created: ${created}\n` +
        `• Updated: ${updated}\n` +
        `• Latest Repo: ${latestName}\n` +
        `• Latest Repo Stars: ${latestStar}\n` +
        `• Latest Repo Forks: ${latestFork}\n` +
        `• Latest Repo Lang: ${latestLang}\n` +
        `• Latest Repo Updated: ${latestUpdated}\n` +
        `• Top Repo: ${topName}\n` +
        `• Top Repo Stars: ${topStar}\n` +
        `• Top Repo Forks: ${topFork}\n` +
        `• Link: ${profileUrl}\`\`\``
    )
}

export default {
    name: 'githubstalk',
    aliases: ['ghstalk', 'gstalk', 'stalkgithub', 'ghprofile'],
    description: 'Stalk metadata lengkap user/organisasi github',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const username = normalizeUsername(text)

        if (!username) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} anthropics`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const data = await fetchGithubProfile(username)
            const caption = buildCaption(data)
            const avatar = toSafe(data?.profile?.avatar_url, '')

            if (!avatar) throw new Error('❌ Metadata gk lengkap: avatar_url')

            await sock.sendMessage(jid, {
                image: { url: avatar },
                caption
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message}`
            }, { quoted: msg })
        }
    }
}
