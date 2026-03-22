import axios from 'axios'

const asCode = (text) => `\`\`\`${String(text).slice(0, 50000)}\`\`\``

const getExt = (value = '') => {
    const clean = String(value || '').split('?')[0].split('#')[0]
    const m = clean.match(/(\.[a-z0-9]{1,10})$/i)
    return m ? m[1].toLowerCase() : ''
}

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

const inferMediaType = (buf, res, targetUrl, declaredType = '') => {
    const type = String(declaredType || '').toLowerCase().split(';')[0]
    if (type && type !== 'application/octet-stream') return type

    const fileName = getFileName(res, targetUrl)
    const ext = getExt(fileName) || getExt(targetUrl.toString())
    const hex = buf.subarray(0, 16).toString('hex')
    const ascii = buf.subarray(0, 16).toString('ascii')

    if (ascii.startsWith('OggS')) {
        if (ext === '.ogv') return 'video/ogg'
        return 'audio/ogg'
    }

    if (ascii.startsWith('ID3') || hex.startsWith('fffb') || hex.startsWith('fff3') || hex.startsWith('fff2')) {
        return 'audio/mpeg'
    }

    if (ascii.startsWith('fLaC')) return 'audio/flac'
    if (ascii.startsWith('RIFF') && buf.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav'
    if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
        if (['.m4a', '.aac'].includes(ext)) return 'audio/mp4'
        return 'video/mp4'
    }
    if (hex.startsWith('1a45dfa3') || ext === '.webm') {
        if (['.weba'].includes(ext)) return 'audio/webm'
        return 'video/webm'
    }

    const byExt = {
        '.oga': 'audio/ogg',
        '.ogg': 'audio/ogg',
        '.opus': 'audio/ogg',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.flac': 'audio/flac',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',
        '.mp4': 'video/mp4',
        '.m4v': 'video/mp4',
        '.mov': 'video/quicktime',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm',
        '.ogv': 'video/ogg'
    }

    return byExt[ext] || type || 'application/octet-stream'
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
            return reply(`Contoh penggunaan:\n- ${prefix + command} https://api.aladhan.com/v1/timingsByCity?city=Yogyakarta&country=Indonesia&method=20`)
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
            const mediaType = inferMediaType(buf, res, target, type)

            if (mediaType.includes('image/')) {
                await sock.sendMessage(jid, { image: buf }, { quoted: msg })
            } else if (mediaType.includes('video/')) {
                await sock.sendMessage(jid, { video: buf, mimetype: mediaType }, { quoted: msg })
            } else if (mediaType.includes('audio/')) {
                await sock.sendMessage(jid, { audio: buf, mimetype: mediaType, ptt: false }, { quoted: msg })
            } else if (mediaType.includes('application/pdf')) {
                await sock.sendMessage(jid, {
                    document: buf,
                    mimetype: mediaType,
                    fileName: getFileName(res, target, '.pdf')
                }, { quoted: msg })
            } else if (
                mediaType.includes('application/octet-stream') ||
                mediaType.includes('application/zip') ||
                mediaType.includes('application/x-') ||
                mediaType.includes('application/vnd')
            ) {
                await sock.sendMessage(jid, {
                    document: buf,
                    mimetype: mediaType,
                    fileName: getFileName(res, target)
                }, { quoted: msg })
            } else if (mediaType.includes('application/json')) {
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
