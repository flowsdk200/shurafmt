import axios from 'axios'

const fmtCount = (value) => {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(Math.floor(n))
}

const formatResults = (items = []) => items
    .map((item, index) => {
        const pkg = item?.package || {}
        const name = String(pkg.name || 'unknown')
        const version = String(pkg.version || '-')
        const desc = String(pkg.description || '-').trim()
        const publisher = String(pkg.publisher?.username || pkg.publisher || '-')
        const keywords = Array.isArray(pkg.keywords) ? pkg.keywords.slice(0, 4).join(', ') : '-'
        const links = pkg.links || {}
        const url = String(pkg.links?.npm || links.repository || `https://www.npmjs.com/package/${name}`)
        const score = Number(item?.score?.final || 0)
        const scoreText = score > 0 ? ` • score ${Math.round(score * 100)}%` : ''
        const maintainers = Array.isArray(pkg.maintainers)
            ? pkg.maintainers.map((m) => m.username || m).slice(0, 3).join(', ')
            : '-'

        return (
            `${index + 1}. ${name} @${version}${scoreText}\n` +
            `× Desc: ${desc}\n` +
            `× Publisher: ${publisher}\n` +
            `× Maintainers: ${maintainers}\n` +
            `× Keywords: ${keywords}\n` +
            `× Link: ${url}`
        )
    })
    .join('\n\n')

const normalizeQuery = (text = '') => String(text || '').trim().replace(/\\s+/g, ' ')

export default {
  name: 'npm',
  aliases: ['npmsearch'],
  description: 'Cari package dari registry npm',
  execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
    const jid = msg.key.remoteJid
    const q = normalizeQuery(text)

    if (!q) {
      return sock.sendMessage(jid, {
        text: `Contoh penggunaan:\n- ${prefix + command} axios`
      }, { quoted: msg })
    }

    await react('⏳')

    try {
      const url = `https://registry.npmjs.org/-/v1/search`
      const { data } = await axios.get(url, {
        params: {
          text: q,
          size: 15
        },
        timeout: 120000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json'
        }
      })

      const items = Array.isArray(data?.objects) ? data.objects : []
      if (!items.length) {
        await react('❌')
        return sock.sendMessage(jid, {
          text: `❌ Tidak ditemukan hasil npm untuk: ${q}`
        }, { quoted: msg })
      }

      const body = formatResults(items)
      const total = fmtCount(data?.total || items.length)
      const caption = `\`\`\`${body}\`\`\``

      await sock.sendMessage(jid, { text: caption }, { quoted: msg })
      useLimit()
      await react('✅')
    } catch (err) {
      await react('❌')
      await sock.sendMessage(jid, {
        text: `❌ Error: ${err.message}`
      }, { quoted: msg })
    }
  }
}
