import { gotScraping } from 'got-scraping'

const BASE_URL = 'https://www.shorturl.at/'
const SUBMIT_URL = 'https://www.shorturl.at/shortener.php'
const REQUEST_TIMEOUT = 30000

const cleanText = (v) => String(v || '').replace(/\s+/g, ' ').trim()

const stripHtml = (html) => cleanText(String(html || '').replace(/<[^>]*>/g, ' '))

const parseShortUrl = (html) => {
    const s = String(html || '')
    const m1 = s.match(/id=["']shortenurl["'][^>]*value=["']([^"']+)["']/i)
    if (m1?.[1]) return cleanText(m1[1])

    const m2 = s.match(/(https?:\/\/(?:www\.)?shorturl\.at\/[A-Za-z0-9]+)/i)
    if (m2?.[1]) return cleanText(m2[1])

    return ''
}

const parseErrorMessage = (html) => {
    const s = String(html || '')
    const title = (s.match(/<title>([^<]+)<\/title>/i) || [])[1] || ''

    if (/shortened url error/i.test(title)) {
        return 'URL ditolak oleh shorturl.at (domain/path tidak diizinkan atau limit rate aktif).'
    }

    return ''
}

export default {
    name: 'shorturl',
    aliases: ['sat', 'shortat'],
    description: 'Shorten URL via ShortURL.at',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg })
        const input = cleanText(text)

        if (!input) {
            return reply(`Contoh penggunaan:\n- ${prefix + command} https://wa.me/6285226344606`)
        }

        let target
        try {
            target = new URL(input)
        } catch {
            return reply('❌ URL tidak valid.')
        }

        await react('⏳')

        try {
            await gotScraping({
                url: BASE_URL,
                timeout: { request: REQUEST_TIMEOUT }
            })

            const submitRes = await gotScraping({
                url: SUBMIT_URL,
                method: 'POST',
                form: { u: target.toString() },
                headers: { referer: BASE_URL },
                timeout: { request: REQUEST_TIMEOUT }
            })

            const html = String(submitRes.body || '')
            const shortUrl = parseShortUrl(html)

            if (!shortUrl) {
                const errMsg = parseErrorMessage(html) || 'Gagal mengambil short URL'
                throw new Error(errMsg)
            }

            await reply(
                '```SHORTLINK\n\n' +
                '× Source: ShortURL.at\n' +
                `× Original: ${target.toString()}\n` +
                `× Short: ${shortUrl}` +
                '```'
            )

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await reply(`❌ Gagal shortlink: ${err.message}`)
        }
    }
}
