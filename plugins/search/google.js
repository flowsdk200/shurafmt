import axios from 'axios'

const fetchBuffer = async (url) => {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    })
    if (res.status !== 200) return null
    return Buffer.from(res.data)
}

export default {
    name: 'google',
    aliases: ['gimage', 'gis'],
    description: 'Cari gambar dari google',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} kuntilanak`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const { data } = await axios.get('https://api.baguss.xyz/api/search/gimage', {
                params: { q },
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            })

            const items = Array.isArray(data?.result) ? data.result : []
            const seen = new Set()
            const candidates = []
            for (const item of items) {
                const url = String(item?.url || '').trim()
                if (!url || seen.has(url)) continue
                seen.add(url)
                candidates.push({ url })
                if (candidates.length >= 40) break
            }

            if (!candidates.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ada hasil gambar untuk: ${q}`
                }, { quoted: msg })
            }

            const buffers = []
            for (const item of candidates) {
                if (buffers.length >= 10) break
                try {
                    const buf = await fetchBuffer(item.url)
                    if (buf) buffers.push(buf)
                } catch {}
            }

            if (!buffers.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Semua gambar hasil pencarian gagal diambil. coba query lain.'
                }, { quoted: msg })
            }

            const album = buffers.map((buf, i) => ({
                image: buf,
                ...(i === 0 ? { caption: `\`\`\`HASIL GOOGLE IMAGE: ${q.toUpperCase()} (${buffers.length})\`\`\`` } : {})
            }))

            await sock.sendMessage(jid, { albumMessage: album }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal mencari gambar: ${err.message}`
            }, { quoted: msg })
        }
    }
}
