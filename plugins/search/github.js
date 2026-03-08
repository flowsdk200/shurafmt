import axios from 'axios'

const fmtCount = (value) => {
    const n = Number(value || 0)
    if (!Number.isFinite(n) || n <= 0) return '0'
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
    return String(Math.floor(n))
}

const formatDate = (raw = '') => {
    try {
        const d = new Date(String(raw))
        return d.toLocaleString('id-ID', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'Asia/Jakarta'
        })
    } catch {
        return '-'
    }
}

const formatResults = (items = []) => items
    .map((repo, index) => {
        const name = String(repo.full_name || `${repo.owner?.login || '-'} / ${repo.name || '-'}`)
        const desc = String(repo.description || '-').trim()
        const language = repo.language || '-'
        const stars = fmtCount(repo.stargazers_count || 0)
        const forks = fmtCount(repo.forks_count || 0)
        const watchers = fmtCount(repo.watchers_count || 0)
        const openIssues = fmtCount(repo.open_issues_count || 0)
        const updated = formatDate(repo.updated_at || '')
        const homepage = repo.homepage ? `\n • Homepage: ${repo.homepage}` : ''
        return (
            `${index + 1}. ${name}\n` +
            `• Desc: ${desc}\n` +
            `• Stars: ${stars}\n` +
            `• Forks: ${forks}\n` +
            `• Watchers: ${watchers}\n` +
            `• Issues: ${openIssues}\n` +
            `• Language: ${language}\n` +
            `• Updated: ${updated}\n` +
            `• Link: ${repo.html_url || '-'}${homepage}`
        )
    })
    .join('\n\n')

export default {
    name: 'github',
    aliases: ['githubsearch', 'ghsearch'],
    description: 'Cari repository di github',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim().replace(/\\s+/g, ' ')
        const limit = 10

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} react-native`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const { data } = await axios.get('https://api.github.com/search/repositories', {
                params: {
                    q,
                    per_page: limit,
                    sort: 'stars',
                    order: 'desc'
                },
                timeout: 120000,
                headers: {
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            })

            const items = Array.isArray(data?.items) ? data.items : []
            if (!items.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan repo github untuk: ${q}`
                }, { quoted: msg })
            }

            const total = fmtCount(data?.total_count || items.length)
            const body = formatResults(items.slice(0, limit))

            await sock.sendMessage(jid, {
                text: `\`\`\`${body}\`\`\``
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            const status = err?.response?.status
            const msgErr = status === 403
                ? '⚠️ Kena rate limit. coba lagi nanti'
                : `❌ Error: ${err?.message}`

            await sock.sendMessage(jid, {
                text: msgErr
            }, { quoted: msg })
        }
    }
}
