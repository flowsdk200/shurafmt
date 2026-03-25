import axios from 'axios'
import { searchTikTok } from '../../scrape/tiktoksearch.js'

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

const formatCaption = ({ title = '-', author = {} }) => {
    const authorLine = author?.username ? `@${author.username}` : (author?.nickname || '-')
    return `\`Author: ${authorLine}\`\n\n${String(title || '-').trim() || '-'}`
}

export default {
    name: 'tiktoksearch',
    aliases: ['ttsearch'],
    description: 'Cari video TikTok',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `❌ Masukkan kata pencarian tiktok.`
            }, { quoted: msg })
        }

        if (/https?:\/\/(vm\.|vt\.|www\.|m\.)?tiktok\.com\/[^\s]+/i.test(q)) {
            return sock.sendMessage(jid, {
                text: `❌ Command ${prefix + command} khusus pencarian tiktok, bukan link.\n\nContoh:\n${prefix + command} anime`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const results = await searchTikTok(q, 20)
            if (!results.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ada hasil untuk: ${q}`
                }, { quoted: msg })
            }

            const valid = results.filter((item) => item.videoUrl)
            if (!valid.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Tidak ada video yang bisa diunduh dari hasil pencarian.'
                }, { quoted: msg })
            }

            const item = valid[Math.floor(Math.random() * valid.length)]
            const caption = formatCaption({
                title: item.title,
                author: item.author
            })

            const video = await fetchBuffer(item.videoUrl)
            await sock.sendMessage(jid, {
                video,
                caption,
                mimetype: 'video/mp4'
            }, { quoted: msg })

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
