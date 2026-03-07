import axios from 'axios'

const extractQuotedText = (quotedMsg = {}) => {
    if (quotedMsg?.conversation) return quotedMsg.conversation
    if (quotedMsg?.extendedTextMessage?.text) return quotedMsg.extendedTextMessage.text
    if (quotedMsg?.imageMessage?.caption) return quotedMsg.imageMessage.caption
    if (quotedMsg?.videoMessage?.caption) return quotedMsg.videoMessage.caption
    return ''
}

const doTranslate = async (text, to) => {
    const { data } = await axios.get('https://translate.googleapis.com/translate_a/single', {
        params: {
            client: 'gtx',
            sl: 'auto',
            tl: to,
            dt: 't',
            q: text
        },
        timeout: 30000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    })

    const result = Array.isArray(data?.[0])
        ? data[0].map((x) => x?.[0] || '').join('').trim()
        : ''

    if (!result) throw new Error('Translate kosong')
    return result
}

export default {
    name: 'translate',
    aliases: ['tr'],
    description: 'Terjemahkan teks ke bahasa tujuan',
    execute: async ({ sock, msg, text, args, quotedMsg, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const defaultLang = 'id'

        if (!text && !quotedMsg) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} id good night`
            }, { quoted: msg })
        }

        let language = ''
        let sourceText = ''

        if (quotedMsg) {
            language = args[0] ? String(args[0]).toLowerCase() : defaultLang
            sourceText = args.length > 1
                ? args.slice(1).join(' ').trim()
                : extractQuotedText(quotedMsg).trim()
        } else {
            if (args.length < 2) {
                return sock.sendMessage(jid, {
                    text: `Contoh penggunaan:\n- ${prefix + command} id good night`
                }, { quoted: msg })
            }
            language = args[0]
            sourceText = args.slice(1).join(' ').trim()
        }

        if (!sourceText) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} id good night`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            let translated = ''
            try {
                translated = await doTranslate(sourceText, String(language).toLowerCase())
            } catch {
                translated = await doTranslate(sourceText, defaultLang)
            }

            await sock.sendMessage(jid, { text: translated }, { quoted: msg })
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
