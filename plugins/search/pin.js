import axios from 'axios'
import { searchPinterest } from '../../scrape/pinterest.js'

const fetchBuffer = async (url) => {
    const { data } = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    })
    return Buffer.from(data)
}

export default {
    name: 'pin',
    aliases: ['pinterest', 'pinsearch'],
    description: 'Cari gambar pinterest',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} anime wallpaper`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const rows = await searchPinterest(q, 50)
            if (!rows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ada hasil untuk: ${q}`
                }, { quoted: msg })
            }

            const uniqueRows = []
            const seen = new Set()
            for (const row of rows) {
                const url = String(row?.image || '')
                if (!url || seen.has(url)) continue
                seen.add(url)
                uniqueRows.push(row)
                if (uniqueRows.length >= 5) break
            }

            const uniqueUrls = uniqueRows.map((x) => x.image)
            const buffers = []
            for (const url of uniqueUrls) {
                try {
                    const buf = await fetchBuffer(url)
                    if (buf?.length) buffers.push(buf)
                } catch {}
            }

            if (!buffers.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Semua gambar gagal diambil. coba query lain.'
                }, { quoted: msg })
            }

            const metaLines = uniqueRows.map((x, i) => (
                `(${i + 1}) ${x.title || '(no title)'}\n` +
                `× Author: ${x.author?.name || '-'}${x.author?.username ? ` (@${x.author.username})` : ''}`
            ))

            const caption = (`\`\`\`${metaLines.join('\n\n')}\`\`\``)

            const albumItems = buffers.map((buf, i) => ({
                image: buf,
                ...(i === 0 ? { caption } : {})
            }))

            await sock.sendMessage(jid, { albumMessage: albumItems }, { quoted: msg })

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
