import axios from 'axios'

const asCode = (text) => `\`\`\`${String(text).slice(0, 50000)}\`\`\``

const getFileName = (res, targetUrl, fallbackExt = '') => {
    const cd = String(res?.headers?.['content-disposition'] || '')
    const match = cd.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
    const fromHeader = decodeURIComponent((match?.[1] || match?.[2] || '').trim())
    if (fromHeader) return fromHeader

    const finalUrl = res?.request?.res?.responseUrl || targetUrl.toString()
    const last = String(finalUrl).split('/').pop()?.split('?')[0] || ''
    if (last) return decodeURIComponent(last)

    return `file${fallbackExt}`
}

export default {
    name: 'get',
    aliases: [],
    description: 'GET request URL',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg })
        const q = String(text || '').trim()

        if (!q) {
            return reply(`Contoh penggunaan\n${prefix + command} https://api.aladhan.com/v1/timingsByCity?city=Yogyakarta&country=Indonesia&method=20`)
        }

        let target
        try {
            target = new URL(q)
        } catch {
            return
        }

        await react('⏳')

        try {
            const res = await axios.get(target.toString(), {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Accept-Encoding': 'gzip, deflate, br',
                    Referer: `${target.origin}/`,
                    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                    'sec-fetch-dest': 'document',
                    'sec-fetch-mode': 'navigate',
                    'sec-fetch-site': 'none',
                    'sec-fetch-user': '?1',
                    'upgrade-insecure-requests': '1'
                },
                responseType: 'arraybuffer',
                timeout: 60000,
                validateStatus: false
            })

            const type = String(res.headers['content-type'] || 'text/plain').toLowerCase().split(';')[0]
            const buf = Buffer.from(res.data)

            if (type.includes('image/')) {
                await sock.sendMessage(jid, { image: buf }, { quoted: msg })
            } else if (type.includes('video/')) {
                await sock.sendMessage(jid, { video: buf, mimetype: type }, { quoted: msg })
            } else if (type.includes('audio/')) {
                await sock.sendMessage(jid, { audio: buf, mimetype: type, ptt: false }, { quoted: msg })
            } else if (type.includes('application/pdf')) {
                await sock.sendMessage(jid, {
                    document: buf,
                    mimetype: type,
                    fileName: getFileName(res, target, '.pdf')
                }, { quoted: msg })
            } else if (
                type.includes('application/octet-stream') ||
                type.includes('application/zip') ||
                type.includes('application/x-') ||
                type.includes('application/vnd')
            ) {
                await sock.sendMessage(jid, {
                    document: buf,
                    mimetype: type,
                    fileName: getFileName(res, target)
                }, { quoted: msg })
            } else if (type.includes('application/json')) {
                const s = buf.toString('utf8')
                try {
                    await reply(asCode(JSON.stringify(JSON.parse(s), null, 2)))
                } catch {
                    await reply(asCode(s))
                }
            } else {
                await reply(asCode(buf.toString('utf8')))
            }
            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await reply(`❌ Error: ${err.message}`)
        }
    }
}
